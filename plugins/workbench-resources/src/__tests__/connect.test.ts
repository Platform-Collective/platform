// SPDX-License-Identifier: EPL-2.0

import type { ClientFactoryOptions } from '@hcengineering/client'
import { ClientConnectEvent } from '@hcengineering/core'
import login from '@hcengineering/login'
import { getResource, setMetadata, type Resource } from '@hcengineering/platform'
import { refreshClient, refreshCommunicationClient } from '@hcengineering/presentation'

import { connect, disconnect } from '../connect'

jest.mock('@hcengineering/account-client', () => ({
  getClient: () => ({ getSocialIds: async () => [{ _id: 'social-id', type: 'email', key: 'user@example.com' }] })
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
  getCurrentLocation: () => ({ path: ['workbench', 'workspace'] }),
  setMetadataLocalStorage: jest.fn()
}))
jest.mock('@hcengineering/workbench', () => ({ WorkbenchEvents: { Connect: 'connect' } }))
jest.mock('@hcengineering/view-resources', () => ({ allowGuestSignUpStore: { set: jest.fn() } }))
jest.mock('svelte/store', () => ({ writable: () => ({ set: jest.fn() }) }))
jest.mock('../plugin', () => ({ __esModule: true, default: { event: { NotifyConnection: 'connected' } } }))
jest.mock('../utils', () => ({}))

describe('workspace endpoint revalidation', () => {
  const loginInfo = {
    token: 'token',
    workspace: 'workspace-id',
    workspaceUrl: 'workspace',
    endpoint: 'wss://old-region',
    account: 'account',
    role: 'admin'
  }
  const selectWorkspace = jest.fn()
  const reload = jest.fn()
  let options: ClientFactoryOptions

  beforeEach(async () => {
    jest.clearAllMocks()
    setMetadata(login.metadata.TransactorOverride, undefined)
    Object.assign(globalThis, { location: { reload }, document: { title: '' } })
    jest.spyOn(console, 'log').mockImplementation(() => {})
    selectWorkspace.mockResolvedValue([{}, loginInfo, true])
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
    await disconnect()
    jest.restoreAllMocks()
  })

  it('does not reselect the workspace during the initial handshake', () => {
    expect(selectWorkspace).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it.each([ClientConnectEvent.Connected, ClientConnectEvent.Reconnected, ClientConnectEvent.Refresh])(
    'reloads after a region move when the old server successfully reconnects with event %s',
    async (event) => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1000)
      selectWorkspace.mockResolvedValue([{}, { ...loginInfo, endpoint: 'wss://new-region' }, true])

      await options.onConnect?.(event, 'session', undefined)

      expect(selectWorkspace).toHaveBeenLastCalledWith('workspace', 'token')
      expect(reload).toHaveBeenCalledTimes(1)
      expect(refreshClient).not.toHaveBeenCalled()
      expect(refreshCommunicationClient).not.toHaveBeenCalled()
    }
  )

  it.each([ClientConnectEvent.Connected, ClientConnectEvent.Reconnected, ClientConnectEvent.Refresh])(
    'continues normal handling for event %s when the endpoint is unchanged',
    async (event) => {
      await options.onConnect?.(event, 'session', undefined)

      expect(selectWorkspace).toHaveBeenCalledTimes(2)
      expect(reload).not.toHaveBeenCalled()
      expect(refreshCommunicationClient).toHaveBeenCalledTimes(1)
      expect(refreshClient).toHaveBeenCalledTimes(event === ClientConnectEvent.Reconnected ? 0 : 1)
    }
  )

  it('still detects endpoint changes on dial timeout', async () => {
    selectWorkspace.mockResolvedValue([{}, { ...loginInfo, endpoint: 'wss://new-region' }, true])

    await options.onDialTimeout?.()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('does not reload without login info (reachable: %s)', async (ok) => {
    selectWorkspace.mockResolvedValue([{}, undefined, ok])

    await options.onDialTimeout?.()
    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)

    expect(reload).not.toHaveBeenCalled()
  })

  it('respects an explicit transactor endpoint override', async () => {
    setMetadata(login.metadata.TransactorOverride, loginInfo.endpoint)
    selectWorkspace.mockResolvedValue([{}, { ...loginInfo, endpoint: 'wss://new-region' }, true])

    await options.onDialTimeout?.()
    await options.onConnect?.(ClientConnectEvent.Reconnected, 'session', undefined)

    expect(reload).not.toHaveBeenCalled()
  })
})
