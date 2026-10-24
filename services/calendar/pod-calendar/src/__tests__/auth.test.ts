// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import calendar from '@hcengineering/calendar'
import type { AccountUuid, WorkspaceUuid } from '@hcengineering/core'
import type { IntegrationClient } from '@hcengineering/integration-client'
import type { Request, Response } from 'express'
import { google } from 'googleapis'

import { AuthController } from '../auth'
import { encode64 } from '../base64'
import { getClient } from '../client'
import { ApiError } from '../error'
import { setSyncHistory } from '../kvsUtils'
import { main } from '../main'
import { createServer } from '../server'
import { IncomingSyncManager } from '../sync'
import { SCOPES, type Endpoint, type State } from '../types'
import { getGoogleClient } from '../utils'

jest.mock('@hcengineering/calendar', () => ({
  __esModule: true,
  default: {
    string: { NotAllPermissions: 'calendar:string:NotAllPermissions' },
    integrationType: { Calendar: 'calendar' }
  },
  calendarIntegrationKind: 'calendar'
}))
jest.mock('@hcengineering/contact', () => ({ __esModule: true, default: {} }))
jest.mock('@hcengineering/core', () => ({
  __esModule: true,
  default: { space: { Workspace: 'workspace' } },
  SocialIdType: { GOOGLE: 'google' },
  TxOperations: jest.fn((client) => client),
  newMetrics: jest.fn()
}))
jest.mock('@hcengineering/setting', () => ({
  __esModule: true,
  default: { class: { Integration: 'integration' } }
}))
jest.mock('googleapis', () => ({ google: { oauth2: jest.fn() } }))
jest.mock('../client', () => ({ getClient: jest.fn() }))
jest.mock('../kvsUtils', () => ({ setSyncHistory: jest.fn() }))
jest.mock('../sync', () => ({ IncomingSyncManager: { initSync: jest.fn() } }))
jest.mock('../utils', () => ({ getGoogleClient: jest.fn(), addUserByEmail: jest.fn(), getServiceToken: jest.fn() }))
jest.mock('../watch', () => ({ WatchController: { get: () => ({ startCheck: jest.fn() }) } }))
jest.mock('@hcengineering/analytics-service', () => ({}))
jest.mock('@hcengineering/integration-client', () => ({ getIntegrationClient: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({ setMetadata: jest.fn() }))
jest.mock('@hcengineering/server-client', () => ({
  __esModule: true,
  default: { metadata: {} },
  getAccountClient: jest.fn()
}))
jest.mock('@hcengineering/server-core', () => ({ initStatisticsContext: () => mockContext }))
jest.mock('@hcengineering/server-token', () => ({ __esModule: true, default: { metadata: {} } }))
jest.mock('../calendarController', () => ({
  CalendarController: { getCalendarController: () => ({ startAll: jest.fn() }) }
}))
jest.mock('../config', () => ({ __esModule: true, default: { GoogleEnabled: true } }))
jest.mock('../outcomingClient', () => ({}))
jest.mock('../pushHandler', () => ({ PushHandler: jest.fn() }))
jest.mock('../server', () => ({ createServer: jest.fn(), listen: jest.fn() }))

const mockGetGoogleClient = getGoogleClient as jest.Mock
const mockOAuth2 = google.oauth2 as jest.Mock
const mockGetClient = getClient as jest.Mock
const mockInitSync = jest.spyOn(IncomingSyncManager, 'initSync')

const mockContext = {
  with: jest.fn(async (_name, _data, fn) => await fn()),
  error: jest.fn(),
  info: jest.fn()
}
const state: State = {
  workspace: 'workspace' as WorkspaceUuid,
  accountUuid: 'account' as AccountUuid,
  redirectURL: 'https://huly.example/calendar?existing=value'
}
const auth = {
  getToken: jest.fn(),
  setCredentials: jest.fn(),
  refreshAccessToken: jest.fn().mockResolvedValue({ credentials: {} })
}
const accountClient = { addSocialIdToPerson: jest.fn().mockResolvedValue('person') }
const integrationClient = {
  connect: jest.fn(),
  integrate: jest.fn(),
  setSecret: jest.fn()
}
const client = {
  findAll: jest.fn().mockResolvedValue([]),
  createDoc: jest.fn()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetGoogleClient.mockReturnValue({ auth, google: {} })
  mockOAuth2.mockReturnValue({
    userinfo: { get: jest.fn().mockResolvedValue({ data: { email: 'user@example.com' } }) }
  })
  mockGetClient.mockResolvedValue(client)
  auth.getToken.mockResolvedValue({ tokens: { scope: SCOPES.join(' ') } })
})

async function authorize (): Promise<void> {
  await AuthController.createAndSync(
    mockContext as unknown as Parameters<typeof AuthController.createAndSync>[0],
    accountClient as unknown as AccountClient,
    integrationClient as unknown as IntegrationClient,
    state,
    'code'
  )
}

describe('Google Calendar authorization', () => {
  it.each(SCOPES)('rejects when consent omits %s', async (missingScope) => {
    auth.getToken.mockResolvedValue({ tokens: { scope: SCOPES.filter((scope) => scope !== missingScope).join(' ') } })

    const result = authorize()
    await expect(result).rejects.toBeInstanceOf(ApiError)
    await expect(result).rejects.toMatchObject({
      code: calendar.string.NotAllPermissions,
      message: 'Not all permissions were granted'
    })
    expect(accountClient.addSocialIdToPerson).not.toHaveBeenCalled()
    expect(integrationClient.connect).not.toHaveBeenCalled()
    expect(integrationClient.setSecret).not.toHaveBeenCalled()
    expect(getClient).not.toHaveBeenCalled()
    expect(setSyncHistory).not.toHaveBeenCalled()
    expect(mockInitSync).not.toHaveBeenCalled()
  })

  it('rejects when the token contains no scopes', async () => {
    auth.getToken.mockResolvedValue({ tokens: {} })
    await expect(authorize()).rejects.toBeInstanceOf(ApiError)
  })

  it('creates the integration and starts syncing after full consent', async () => {
    await expect(authorize()).resolves.toBeUndefined()
    expect(integrationClient.setSecret).toHaveBeenCalledTimes(1)
    expect(client.createDoc).toHaveBeenCalledWith('integration', 'workspace', {
      type: 'calendar',
      disabled: false,
      value: 'user@example.com'
    })
    expect(setSyncHistory).toHaveBeenCalledTimes(1)
    expect(mockInitSync).toHaveBeenCalledTimes(1)
  })
})

describe('Google Calendar callback', () => {
  let callback: Endpoint['handler']

  beforeAll(async () => {
    const on = jest.spyOn(process, 'on').mockReturnValue(process)
    try {
      await main()
      const endpoints = (createServer as jest.Mock).mock.calls[0][0] as Endpoint[]
      callback = endpoints.find((endpoint) => endpoint.endpoint === '/signin/code')!.handler
    } finally {
      on.mockRestore()
    }
  })

  async function callCallback (
    query: Request['query']
  ): Promise<{ redirect: jest.Mock, status: jest.Mock, send: jest.Mock }> {
    const res = { redirect: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() }
    await callback({ query } as unknown as Request, res as unknown as Response)
    return res
  }

  it('returns declined consent to the app as a permission error', async () => {
    auth.getToken.mockResolvedValue({ tokens: { scope: SCOPES.slice(1).join(' ') } })
    const res = await callCallback({ code: 'code', state: encode64(JSON.stringify(state)) })
    const redirect = new URL(res.redirect.mock.calls[0][0])
    expect(redirect.searchParams.get('integrationError')).toBe(calendar.string.NotAllPermissions)
    expect(redirect.searchParams.get('existing')).toBe('value')
  })

  it('returns other authorization failures to the app without leaving the request pending', async () => {
    auth.getToken.mockRejectedValueOnce(new Error('Authorization failed: invalid code'))
    const res = await callCallback({ code: 'invalid', state: encode64(JSON.stringify(state)) })
    const redirect = new URL(res.redirect.mock.calls[0][0])
    expect(redirect.searchParams.get('integrationError')).toBe('Authorization failed: invalid code')
  })

  it('keeps the successful return URL unchanged', async () => {
    jest.spyOn(AuthController, 'createAndSync').mockResolvedValueOnce()
    try {
      const res = await callCallback({ code: 'code', state: encode64(JSON.stringify(state)) })
      expect(res.redirect).toHaveBeenCalledWith(state.redirectURL)
    } finally {
      jest.restoreAllMocks()
    }
  })

  it('responds to malformed state instead of leaving the request pending', async () => {
    const res = await callCallback({ code: 'code', state: encode64('invalid json') })
    expect(res.redirect).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.send).toHaveBeenCalledTimes(1)
  })
})
