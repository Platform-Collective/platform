// SPDX-License-Identifier: EPL-2.0

import clientResources from '@hcengineering/client-resources'
import type { Client, MeasureContext, WorkspaceUuid } from '@hcengineering/core'
import { getTransactorEndpoint } from '@hcengineering/server-client'
import { createPlatformClient } from '../client'

jest.mock('@hcengineering/client-resources', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@hcengineering/server-client', () => ({ getTransactorEndpoint: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({ generateToken: jest.fn(() => 'workspace-token') }))
jest.mock('../config', () => ({ __esModule: true, default: { ServiceID: 'github' } }))

it('forwards dial timeouts to the workspace connection check', async () => {
  const connection = {} as unknown as Client
  const getClient = jest.fn().mockResolvedValue(connection)
  jest.mocked(clientResources).mockResolvedValue({ function: { GetClient: getClient } })
  jest.mocked(getTransactorEndpoint).mockResolvedValue('wss://old-region')
  const reconnect = jest.fn().mockResolvedValue(undefined)
  const onDialTimeout = jest.fn().mockResolvedValue(undefined)
  const ctx = {} as unknown as MeasureContext
  const workspace = '00000000-0000-0000-0000-000000000001' as WorkspaceUuid

  const result = await createPlatformClient(ctx, workspace, 30000, reconnect, onDialTimeout)

  expect(result).toEqual({ client: connection, endpoint: 'wss://old-region' })
  expect(getClient).toHaveBeenCalledWith('workspace-token', 'wss://old-region', {
    ctx,
    onConnect: reconnect,
    onDialTimeout,
    useGlobalRPCHandler: true
  })
  await getClient.mock.calls[0][2].onDialTimeout()
  expect(onDialTimeout).toHaveBeenCalledTimes(1)
})
