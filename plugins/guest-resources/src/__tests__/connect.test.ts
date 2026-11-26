// SPDX-License-Identifier: EPL-2.0

import core, { ClientConnectEvent, generateId, type Client, type Version } from '@hcengineering/core'
import { getResource, setMetadata } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import { getCurrentLocation } from '@hcengineering/ui'
import { connect } from '../connect'

jest.mock('@hcengineering/analytics', () => ({
  Analytics: {
    handleError: jest.fn(),
    handleEvent: jest.fn(),
    setUser: jest.fn(),
    setWorkspace: jest.fn()
  }
}))

jest.mock('@hcengineering/client', () => ({
  __esModule: true,
  default: { function: { GetClient: 'client.GetClient' } }
}))

jest.mock('@hcengineering/contact', () => ({ setCurrentEmployee: jest.fn() }))

jest.mock('@hcengineering/login', () => ({
  __esModule: true,
  default: {
    function: {
      ExchangeGuestToken: 'login.ExchangeGuestToken',
      SelectWorkspace: 'login.SelectWorkspace'
    }
  }
}))

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn(),
  setMetadata: jest.fn()
}))

jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: {
    metadata: {
      Token: 'presentation.Token',
      WorkspaceUuid: 'presentation.WorkspaceUuid',
      WorkspaceName: 'presentation.WorkspaceName',
      WorkspaceDataId: 'presentation.WorkspaceDataId',
      Endpoint: 'presentation.Endpoint',
      SessionId: 'presentation.SessionId',
      FrontVersion: 'presentation.FrontVersion',
      ModelVersion: 'presentation.ModelVersion',
      FrontUrl: 'presentation.FrontUrl'
    }
  },
  loadServerConfig: jest.fn(),
  refreshClient: jest.fn(),
  setClient: jest.fn(),
  setCommunicationClient: jest.fn(),
  setPresentationCookie: jest.fn(),
  upgradeDownloadProgress: { subscribe: jest.fn() }
}))

jest.mock('@hcengineering/ui', () => ({
  desktopPlatform: false,
  getCurrentLocation: jest.fn()
}))

jest.mock('@hcengineering/workbench', () => ({ logOut: jest.fn() }))

jest.mock('svelte/store', () => ({
  get: jest.fn(),
  writable: jest.fn(() => ({ set: jest.fn(), subscribe: jest.fn() }))
}))

interface ConnectOptions {
  onConnect: (event: ClientConnectEvent, lastTx: string | undefined, data: unknown) => Promise<void>
}

describe('guest connection session', () => {
  it('stores the connection session ID instead of the last transaction', async () => {
    const modelVersion: Version = {
      _id: generateId<Version>(),
      _class: core.class.Version,
      space: core.space.Model,
      modifiedBy: core.account.System,
      modifiedOn: 0,
      major: 1,
      minor: 0,
      patch: 0
    }
    const client = {
      close: jest.fn(),
      findOne: jest.fn().mockResolvedValue(modelVersion)
    } as unknown as Client
    let options: ConnectOptions | undefined
    const clientFactory = jest.fn(async (_token: string, _endpoint: string, connectOptions: ConnectOptions) => {
      options = connectOptions
      return client
    })
    const workspaceLoginInfo = {
      workspace: 'workspace-id',
      workspaceUrl: 'workspace',
      workspaceDataId: 'workspace-id',
      name: 'Workspace',
      endpoint: 'ws://localhost',
      account: 'guest-account',
      role: 'GUEST'
    }

    ;(getCurrentLocation as jest.Mock).mockReturnValue({ path: ['guest', 'workspace'], query: { token: 'token' } })
    ;(getResource as jest.Mock).mockImplementation(async (resource: string) => {
      if (resource === 'login.ExchangeGuestToken') return async (): Promise<string> => 'exchanged-token'
      if (resource === 'login.SelectWorkspace') {
        return async (): Promise<unknown[]> => [undefined, workspaceLoginInfo, true]
      }
      if (resource === 'client.GetClient') return clientFactory
      throw new Error(`Unexpected resource: ${resource}`)
    })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { title: '' } })

    await expect(connect('Guest')).resolves.toBe(client)
    expect(options).toBeDefined()
    await options?.onConnect(ClientConnectEvent.Connected, 'last-transaction', 'session-id')

    const { Analytics: analytics } = jest.requireMock<{
      Analytics: { handleError: jest.Mock }
    }>('@hcengineering/analytics')
    expect(setMetadata).toHaveBeenCalledWith(presentation.metadata.SessionId, 'session-id')
    expect(analytics.handleError).not.toHaveBeenCalled()
  })
})
