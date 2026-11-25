// SPDX-License-Identifier: EPL-2.0

import { type Integration } from '@hcengineering/account-client'
import { type IntegrationClient, request } from '@hcengineering/integration-client'
import { disconnect, disconnectAll } from '../api'

jest.mock(
  '@hcengineering/platform',
  () => {
    const metadata: Record<string, string> = {
      token: 'test-token',
      'accounts-url': 'https://accounts.test',
      'calendar-url': 'https://calendar.test'
    }
    return { getMetadata: (key: string) => metadata[key] }
  },
  { virtual: true }
)
jest.mock('@hcengineering/presentation', () => ({ metadata: { Token: 'token' } }), { virtual: true })
jest.mock('@hcengineering/login', () => ({ metadata: { AccountsUrl: 'accounts-url' } }), { virtual: true })
jest.mock('@hcengineering/calendar', () => ({ calendarIntegrationKind: 'calendar' }), { virtual: true })
jest.mock('../plugin', () => ({ metadata: { CalendarServiceURL: 'calendar-url' } }))
jest.mock('@hcengineering/integration-client', () => ({ getIntegrationClient: () => mockClient, request: jest.fn() }), {
  virtual: true
})

const mockClient: jest.Mocked<Pick<IntegrationClient, 'getConnection' | 'removeIntegration' | 'removeConnection'>> = {
  getConnection: jest.fn(),
  removeIntegration: jest.fn(),
  removeConnection: jest.fn()
}

let integration: Integration
let connection: Integration | null

beforeEach(() => {
  jest.resetAllMocks()
  integration = {
    socialId: 'social-id' as Integration['socialId'],
    kind: 'calendar' as Integration['kind'],
    workspaceUuid: 'workspace-id' as Integration['workspaceUuid'],
    data: {}
  }
  connection = { ...integration, workspaceUuid: null, data: { email: 'connection@example.com' } }
  mockClient.getConnection.mockImplementation(async () => connection)
  mockClient.removeIntegration.mockImplementation(async () => {
    connection = null
    return { connectionRemoved: true }
  })
  mockClient.removeConnection.mockImplementation(async () => {
    connection = null
  })
})

describe.each([
  { name: 'disconnect', action: disconnect },
  { name: 'disconnectAll', action: disconnectAll }
])('$name', ({ action }) => {
  it.each([undefined, {}])('signs out using the connection email when integration data is %p', async (data) => {
    integration.data = data

    await action(integration)

    expect(connection).toBeNull()
    expect(mockClient.getConnection).toHaveBeenCalledTimes(1)
    expect(mockClient.getConnection).toHaveBeenCalledWith(integration)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({
      baseUrl: 'https://calendar.test',
      path: '/signout?value=connection@example.com',
      method: 'GET',
      token: 'test-token'
    })
  })

  it('prefers the integration email over the connection email', async () => {
    integration.data = { email: 'integration@example.com' }

    await action(integration)

    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: '/signout?value=integration@example.com' }))
  })

  it('reports a missing email without sending a signout request', async () => {
    connection = null

    await expect(action(integration)).rejects.toThrow('Email is not defined in integration')

    expect(request).not.toHaveBeenCalled()
  })

  it('propagates signout request failures', async () => {
    integration.data = { email: 'integration@example.com' }
    jest.mocked(request).mockRejectedValue(new Error('Signout failed'))

    await expect(action(integration)).rejects.toThrow('Signout failed')
  })
})

it.each([{ connectionRemoved: false }, undefined])('does not sign out when removal returns %p', async (result) => {
  mockClient.removeIntegration.mockResolvedValue(result)

  await disconnect(integration)

  expect(mockClient.removeIntegration).toHaveBeenCalledWith(integration.socialId, integration.workspaceUuid)
  expect(request).not.toHaveBeenCalled()
})
