// SPDX-License-Identifier: EPL-2.0

import { getClient as getAccountClient } from '@hcengineering/account-client'
import client from '@hcengineering/client'
import login from '@hcengineering/login'
import { getResource } from '@hcengineering/platform'
import { decodeTokenPayload, purgeClient } from '@hcengineering/presentation'
import { addNotification, getCurrentLocation } from '@hcengineering/ui'
import { connect, disconnect } from '../connect'
import { clearOidcSessionExpiryWarning } from '../session-expiry'

interface MockContext {
  metrics: Record<string, unknown>
  with: <T>(
    name: string,
    options: Record<string, unknown>,
    operation: (context: MockContext) => Promise<T>
  ) => Promise<T>
}

interface TestClient {
  close: jest.Mock<Promise<void>, []>
  findOne: jest.Mock<Promise<undefined>, []>
}

interface MockStore<T> {
  set: (value: T) => void
  subscribe: (run: (value: T) => void) => () => void
}

function mockWritable<T> (initialValue: T): MockStore<T> {
  let value = initialValue
  return {
    set: (newValue: T): void => {
      value = newValue
    },
    subscribe: (run: (value: T) => void): (() => void) => {
      run(value)
      return () => {}
    }
  }
}

function mockCreateContext (): MockContext {
  const context: MockContext = {
    metrics: {},
    with: async <T> (
      _name: string,
      _options: Record<string, unknown>,
      operation: (context: MockContext) => Promise<T>
    ): Promise<T> => await operation(context)
  }
  return context
}

jest.mock('svelte/store', () => ({
  get: <T> (store: MockStore<T>): T => {
    let current!: T
    const unsubscribe = store.subscribe((value: T) => {
      current = value
    })
    unsubscribe()
    return current
  },
  writable: <T> (initialValue: T): MockStore<T> => mockWritable(initialValue)
}))
jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/analytics', () => ({
  Analytics: {
    handleError: jest.fn(),
    handleEvent: jest.fn(),
    setUser: jest.fn(),
    setWorkspace: jest.fn()
  }
}))
jest.mock('@hcengineering/client', () => ({ __esModule: true, default: { function: { GetClient: 'get-client' } } }))
jest.mock('@hcengineering/contact', () => ({
  __esModule: true,
  default: { class: { PersonSpace: 'person-space' } },
  ensureEmployee: jest.fn(),
  setCurrentEmployee: jest.fn(),
  setCurrentEmployeeSpace: jest.fn()
}))
jest.mock('@hcengineering/core', () => ({
  __esModule: true,
  default: { class: { Version: 'version' }, employee: { System: 'system' } },
  AccountRole: { Admin: 'ADMIN', ReadOnlyGuest: 'READONLYGUEST', DocGuest: 'DocGuest', Guest: 'GUEST' },
  ClientConnectEvent: { Connected: 'connected', Reconnected: 'reconnected', Refresh: 'refresh' },
  concatLink: (base: string, path: string): string => `${base}${path}`,
  isWorkspaceCreating: jest.fn(() => false),
  metricsToString: jest.fn(() => ''),
  pickPrimarySocialId: jest.fn(() => ({ _id: 'primary-social' })),
  platformNow: jest.fn(() => Date.now()),
  setCurrentAccount: jest.fn(),
  setCurrentEmployee: jest.fn(),
  SocialIdType: { EMAIL: 'email', GOOGLE: 'google', GITHUB: 'github' },
  versionToString: jest.fn(() => '')
}))
jest.mock('@hcengineering/login', () => ({
  __esModule: true,
  default: {
    function: { SelectWorkspace: 'select-workspace', FetchWorkspace: 'fetch-workspace' },
    metadata: { LoginEndpoint: 'login-endpoint', TransactorOverride: 'transactor-override' },
    string: {},
    status: {}
  },
  loginId: 'login'
}))
jest.mock('@hcengineering/platform', () => ({
  __esModule: true,
  default: { status: {} },
  broadcastEvent: jest.fn(async () => {}),
  getMetadata: jest.fn(),
  getResource: jest.fn(),
  OK: {},
  PlatformEvent: 'platform-event',
  setMetadata: jest.fn(),
  setPlatformStatus: jest.fn(async () => {}),
  Severity: { INFO: 'info' },
  Status: jest.fn(),
  translateCB: jest.fn(
    (
      key: string,
      _params: Record<string, unknown>,
      _language: string,
      callback: (translation: string) => void
    ): void => {
      callback(key)
    }
  )
}))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: {
    metadata: {
      Token: 'token',
      WorkspaceUuid: 'workspace-uuid',
      WorkspaceName: 'workspace-name',
      Endpoint: 'endpoint',
      WorkspaceDataId: 'workspace-data-id',
      SessionId: 'session-id',
      FrontVersion: 'front-version',
      FrontUrl: 'front-url',
      ModelVersion: 'model-version'
    }
  },
  decodeTokenPayload: jest.fn(),
  loadServerConfig: jest.fn(),
  purgeClient: jest.fn(async () => {}),
  purgeCommunicationClient: jest.fn(async () => {}),
  refreshClient: jest.fn(async () => {}),
  refreshCommunicationClient: jest.fn(async () => {}),
  setClient: jest.fn(async () => {}),
  setCommunicationClient: jest.fn(async () => {}),
  setPresentationCookie: jest.fn(),
  uiContext: { newChild: jest.fn(() => mockCreateContext()) },
  upgradeDownloadProgress: mockWritable(-1)
}))
jest.mock('@hcengineering/ui', () => ({
  addNotification: jest.fn(),
  desktopPlatform: false,
  getCurrentLocation: jest.fn(),
  locationStorageKeyId: 'location',
  navigate: jest.fn(),
  NotificationSeverity: { Warning: 'warning' },
  setMetadataLocalStorage: jest.fn(),
  themeStore: mockWritable({ language: 'en' })
}))
jest.mock('@hcengineering/view-resources', () => ({
  allowGuestSignUpStore: mockWritable(false),
  SimpleNotification: {}
}))
jest.mock('@hcengineering/workbench', () => ({ WorkbenchEvents: { Connect: 'connect' } }))
jest.mock('../plugin', () => ({
  __esModule: true,
  default: {
    event: { NotifyConnection: 'notify-connection' },
    string: { SessionExpiryWarning: 'expiry-warning', SessionExpiryWarningDescription: 'expiry-description' }
  }
}))
jest.mock('../utils', () => ({
  logOut: jest.fn(),
  workspaceCreating: mockWritable(undefined)
}))

const clients: TestClient[] = []
const tokenPayloads: Record<string, { exp: number, extra: { authMethod: string } }> = {}
let currentToken = 'token-one'

const selectWorkspace = jest.fn(async () => [
  {},
  {
    token: currentToken,
    endpoint: 'wss://example.test',
    account: 'account',
    workspace: 'workspace',
    workspaceUrl: 'workspace',
    name: 'Workspace',
    role: 'ADMIN'
  },
  true
])
const fetchWorkspace = jest.fn(async () => [
  {},
  { dataId: 'data', mode: 'active', url: 'workspace', uuid: 'workspace', branding: 'brand' },
  true
])
const clientFactory = jest.fn(async (): Promise<TestClient> => {
  const testClient = { close: jest.fn(async () => {}), findOne: jest.fn(async () => undefined) }
  clients.push(testClient)
  return testClient
})

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

describe('OIDC warning connection lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    clients.length = 0
    currentToken = 'token-one'
    tokenPayloads['token-one'] = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      extra: { authMethod: 'oidc' }
    }
    tokenPayloads['token-two'] = {
      exp: Math.floor(Date.now() / 1000) + 7200,
      extra: { authMethod: 'oidc' }
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { title: '' } })
    jest.mocked(getCurrentLocation).mockReturnValue({ path: ['workbench', 'workspace'] })
    jest.mocked(getResource).mockImplementation(async (resource) => {
      if (resource === login.function.SelectWorkspace) return selectWorkspace as never
      if (resource === login.function.FetchWorkspace) return fetchWorkspace as never
      if (resource === client.function.GetClient) return clientFactory as never
      throw new Error(`Unexpected resource: ${resource}`)
    })
    jest.mocked(getAccountClient).mockReturnValue({
      getSocialIds: jest.fn(async () => [])
    } as unknown as ReturnType<typeof getAccountClient>)
    jest.mocked(decodeTokenPayload).mockImplementation((token: string) => tokenPayloads[token] ?? {})
    jest.mocked(purgeClient).mockResolvedValue()
  })

  afterEach(async () => {
    await disconnect()
    clearOidcSessionExpiryWarning()
    jest.useRealTimers()
    if (originalDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document')
    } else {
      Object.defineProperty(globalThis, 'document', originalDocument)
    }
  })

  test('cancels the scheduled warning through workbench disconnect', async () => {
    await connect('Platform')
    expect(jest.getTimerCount()).toBe(1)

    let finishClose: () => void = () => {}
    const closeGate = new Promise<void>((resolve) => {
      finishClose = resolve
    })
    clients[0].close.mockImplementationOnce(async () => {
      await closeGate
    })

    const teardown = disconnect()
    jest.advanceTimersByTime(55 * 60 * 1000)
    const warningsWhileDisconnectWasPending = jest.mocked(addNotification).mock.calls.length
    finishClose()
    await teardown

    expect(clients[0].close).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
    expect(warningsWhileDisconnectWasPending).toBe(0)
  })

  test('cancels the previous warning before a token replacement finishes', async () => {
    await connect('Platform')
    currentToken = 'token-two'

    let signalPurgeStarted: () => void = () => {}
    const purgeStarted = new Promise<void>((resolve) => {
      signalPurgeStarted = resolve
    })
    let finishPurge: () => void = () => {}
    const purgeGate = new Promise<void>((resolve) => {
      finishPurge = resolve
    })
    jest.mocked(purgeClient).mockImplementationOnce(async () => {
      signalPurgeStarted()
      await purgeGate
    })

    const replacement = connect('Platform')
    await purgeStarted
    jest.advanceTimersByTime(55 * 60 * 1000)
    const warningsWhileReplacementWasPending = jest.mocked(addNotification).mock.calls.length
    finishPurge()
    await replacement

    expect(warningsWhileReplacementWasPending).toBe(0)
    expect(jest.getTimerCount()).toBe(1)
  })
})
