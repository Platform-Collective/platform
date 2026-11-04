// SPDX-License-Identifier: EPL-2.0

import type { ClientFactoryOptions } from '@hcengineering/client'
import { ClientConnectEvent } from '@hcengineering/core'
import login from '@hcengineering/login'
import { getResource, setMetadata, type Resource } from '@hcengineering/platform'
import { refreshClient, refreshCommunicationClient } from '@hcengineering/presentation'

import { connect, disconnect } from '../connect'

const mockAccountSelectWorkspace = jest.fn()
const mockGetAccountClient = jest.fn((_url?: string, _token?: string, _retryTimeoutMs?: number) => ({
  getSocialIds: async () => [{ _id: 'social-id', type: 'email', key: 'user@example.com' }],
  selectWorkspace: async (workspaceUrl: string) => await mockAccountSelectWorkspace(workspaceUrl)
}))
const mockLocation = { path: ['workbench', 'workspace'] }
jest.mock('@hcengineering/account-client', () => ({
  getClient: (url?: string, token?: string, retryTimeoutMs?: number) => mockGetAccountClient(url, token, retryTimeoutMs)
}))
jest.mock('@hcengineering/analytics', () => ({
  Analytics: { setUser: jest.fn(), setWorkspace: jest.fn(), handleEvent: jest.fn() }
}))
jest.mock('@hcengineering/client', () => ({ __esModule: true, default: { function: { GetClient: 'get-client' } } }))
jest.mock('@hcengineering/contact', () => ({ setCurrentEmployee: jest.fn() }))
jest.mock('@hcengineering/core', () => ({
  __esModule: true,
  default: { employee: { System: 'system' }, class: { Version: 'version' } },
  AccountRole: { Admin: 'admin' },
  ClientConnectEvent: { Connected: 0, Reconnected: 1, Upgraded: 2, Refresh: 3, Maintenance: 4 },
  SocialIdType: { EMAIL: 'email' },
  isWorkspaceCreating: () => false,
  pickPrimarySocialId: (ids: unknown[]) => ids[0],
  setCurrentAccount: jest.fn(),
  metricsToString: () => '',
  platformNow: () => Date.now(),
  versionToString: () => '1.0.0'
}))
jest.mock('@hcengineering/login', () => ({
  __esModule: true,
  default: {
    function: { SelectWorkspace: 'select-workspace', FetchWorkspace: 'fetch-workspace' },
    metadata: { TransactorOverride: 'override', AccountsUrl: 'accounts-url', LoginEndpoint: 'login-endpoint' }
  }
}))
jest.mock('@hcengineering/platform', () => {
  const metadata = new Map<string, unknown>()
  return {
    getResource: jest.fn(),
    getMetadata: (key: string) => metadata.get(key),
    setMetadata: (key: string, value: unknown) => metadata.set(key, value),
    setPlatformStatus: jest.fn(),
    broadcastEvent: jest.fn(),
    Severity: { INFO: 'info' },
    Status: jest.fn(),
    __esModule: true,
    default: { status: { SystemAccount: 'system-account', RegularAccount: 'regular-account' } }
  }
})
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: {
    metadata: Object.fromEntries(
      ['Token', 'WorkspaceUuid', 'WorkspaceName', 'Endpoint', 'WorkspaceDataId', 'ModelVersion', 'FrontVersion'].map(
        (key) => [key, key]
      )
    )
  },
  uiContext: {
    newChild: () => ({
      async with (_name: string, _params: unknown, fn: (ctx: unknown) => unknown): Promise<unknown> {
        return await fn(this)
      }
    })
  },
  refreshClient: jest.fn(),
  refreshCommunicationClient: jest.fn(),
  setPresentationCookie: jest.fn(),
  setClient: jest.fn(),
  setCommunicationClient: jest.fn()
}))
jest.mock('@hcengineering/ui', () => ({
  getCurrentLocation: () => ({ path: [...mockLocation.path] }),
  setMetadataLocalStorage: jest.fn()
}))
jest.mock('@hcengineering/workbench', () => ({ WorkbenchEvents: { Connect: 'connect' } }))
jest.mock('@hcengineering/view-resources', () => ({ allowGuestSignUpStore: { set: jest.fn() } }))
jest.mock('svelte/store', () => ({ writable: () => ({ set: jest.fn() }) }))
jest.mock('../plugin', () => ({ __esModule: true, default: { event: { NotifyConnection: 'connected' } } }))
jest.mock('../utils', () => ({}))

async function never<T> (): Promise<T> {
  return await new Promise<T>(() => {})
}
const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await sleep(0)
}

describe('workspace endpoint revalidation', () => {
  const loginInfo = {
    token: 'token',
    workspace: 'workspace-id',
    workspaceUrl: 'workspace',
    endpoint: 'wss://old-region',
    account: 'account',
    role: 'admin'
  }
  const moved = { ...loginInfo, endpoint: 'wss://new-region' }
  const reconnectEvents = [ClientConnectEvent.Connected, ClientConnectEvent.Reconnected, ClientConnectEvent.Refresh]
  const selectWorkspace = jest.fn()
  const reload = jest.fn()
  let options: ClientFactoryOptions

  beforeEach(async () => {
    jest.clearAllMocks()
    mockLocation.path = ['workbench', 'workspace']
    setMetadata(login.metadata.TransactorOverride, undefined)
    setMetadata(login.metadata.AccountsUrl, 'https://accounts')
    Object.assign(globalThis, { location: { reload }, document: { title: '' } })
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    // No random delay unless a test asks for one.
    jest.spyOn(Math, 'random').mockReturnValue(0)
    selectWorkspace.mockResolvedValue([{}, loginInfo, true])
    mockAccountSelectWorkspace.mockResolvedValue(loginInfo)
    jest.mocked(getResource).mockImplementation(async <T> (resource: Resource<T>): Promise<T> => {
      let result: unknown
      switch (resource as string) {
        case 'select-workspace':
          result = selectWorkspace
          break
        case 'fetch-workspace':
          result = async () => [{}, { url: 'workspace', uuid: 'workspace-id' }, true]
          break
        case 'get-client':
          result = async (_token: string, _endpoint: string, opt: ClientFactoryOptions) => {
            options = opt
            // The initial handshake happens before the client factory resolves.
            await options.onConnect?.(ClientConnectEvent.Connected, 'session', undefined)
            return { close: jest.fn(), findOne: async () => undefined }
          }
          break
        default:
          throw new Error(`Unexpected resource: ${resource}`)
      }
      return result as T
    })
    await connect('Platform')
  })

  afterEach(async () => {
    jest.useRealTimers()
    await disconnect()
    jest.restoreAllMocks()
  })

  it('does not reselect the workspace during the initial handshake', async () => {
    await flush()
    expect(selectWorkspace).toHaveBeenCalledTimes(1)
    expect(mockAccountSelectWorkspace).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it.each(reconnectEvents)('does not wait for the account service before refreshing on event %s', async (event) => {
    selectWorkspace.mockReturnValue(never())
    mockAccountSelectWorkspace.mockReturnValue(never())

    const handled = options.onConnect?.(event, 'session', undefined)
    const result = await Promise.race([handled?.then(() => 'done'), sleep(200).then(() => 'blocked')])

    expect(result).toBe('done')
    expect(refreshCommunicationClient).toHaveBeenCalledTimes(1)
    expect(refreshClient).toHaveBeenCalledTimes(event === ClientConnectEvent.Reconnected ? 0 : 1)
    // Let the background check start here, so it cannot leak into the next test.
    await flush()
    expect(mockAccountSelectWorkspace).toHaveBeenCalledTimes(1)
  })

  it.each(reconnectEvents)(
    'reloads after a region move once the background check sees it (event %s)',
    async (event) => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1000)
      mockAccountSelectWorkspace.mockResolvedValue(moved)

      await options.onConnect?.(event, 'session', undefined)
      await flush()

      expect(mockGetAccountClient).toHaveBeenLastCalledWith('https://accounts', 'token', expect.any(Number))
      expect(mockAccountSelectWorkspace).toHaveBeenLastCalledWith('workspace')
      expect(reload).toHaveBeenCalledTimes(1)
    }
  )

  it.each(reconnectEvents)('continues normal handling for event %s when the endpoint is unchanged', async (event) => {
    await options.onConnect?.(event, 'session', undefined)
    await flush()

    expect(mockAccountSelectWorkspace).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
    expect(refreshCommunicationClient).toHaveBeenCalledTimes(1)
    expect(refreshClient).toHaveBeenCalledTimes(event === ClientConnectEvent.Reconnected ? 0 : 1)
  })

  it('never uses the navigating workspace selection on reconnect, so failures show no UI', async () => {
    mockAccountSelectWorkspace.mockRejectedValue(new Error('Unauthorized'))

    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)
    await flush()

    // Only the initial connect used the login resource, which can navigate and report errors.
    expect(selectWorkspace).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
    expect(refreshCommunicationClient).toHaveBeenCalledTimes(1)
  })

  it('runs one check at a time for bursts of reconnect events', async () => {
    mockAccountSelectWorkspace.mockReturnValue(never())

    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)
    await options.onConnect?.(ClientConnectEvent.Refresh, 'session', undefined)
    await flush()

    expect(mockAccountSelectWorkspace).toHaveBeenCalledTimes(1)
  })

  it('spreads checks over a random delay and gives up on a slow account service', async () => {
    jest.useFakeTimers()
    jest.mocked(Math.random).mockReturnValue(0.5)
    mockAccountSelectWorkspace.mockReturnValue(never())

    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)
    await jest.advanceTimersByTimeAsync(2_499)
    expect(mockAccountSelectWorkspace).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(mockAccountSelectWorkspace).toHaveBeenCalledTimes(1)

    // Still pending: a new reconnect does not start a second request.
    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)
    await jest.advanceTimersByTimeAsync(5_000)
    expect(mockAccountSelectWorkspace).toHaveBeenCalledTimes(1)

    // After the time limit the check is dropped without a reload and the next reconnect checks again.
    await jest.advanceTimersByTimeAsync(10_000)
    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)
    await jest.advanceTimersByTimeAsync(2_500)
    expect(mockAccountSelectWorkspace).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload when the user has left the workspace before the check finished', async () => {
    mockAccountSelectWorkspace.mockResolvedValue(moved)
    mockLocation.path = ['workbench', 'other-workspace']

    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)
    await flush()

    expect(reload).not.toHaveBeenCalled()
  })

  it('still detects endpoint changes on dial timeout', async () => {
    selectWorkspace.mockResolvedValue([{}, moved, true])

    await options.onDialTimeout?.()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('reloads on dial timeout without login info, as before (reachable: %s)', async (ok) => {
    selectWorkspace.mockResolvedValue([{}, null, ok])

    await options.onDialTimeout?.()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload on reconnect without login info', async () => {
    mockAccountSelectWorkspace.mockResolvedValue(null)

    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)
    await flush()

    expect(reload).not.toHaveBeenCalled()
  })

  it('respects an explicit transactor endpoint override', async () => {
    setMetadata(login.metadata.TransactorOverride, loginInfo.endpoint)
    selectWorkspace.mockResolvedValue([{}, moved, true])
    mockAccountSelectWorkspace.mockResolvedValue(moved)

    await options.onDialTimeout?.()
    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)
    await flush()

    expect(reload).not.toHaveBeenCalled()
  })
})
