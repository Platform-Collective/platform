// SPDX-License-Identifier: EPL-2.0

import client from '@hcengineering/client'
import clientResources from '@hcengineering/client-resources'
import {
  systemAccountUuid,
  type Client,
  type ClientConnectEvent,
  type MeasureContext,
  type WorkspaceUuid
} from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { getTransactorEndpoint } from '@hcengineering/server-client'
import { generateToken } from '@hcengineering/server-token'
import WebSocket from 'ws'
import type { Config } from './config'

/** Every account-service call of the pod gives up after this long. */
export const ACCOUNT_CLIENT_TIMEOUT_MS = 30 * 1000

/** The pod's System token, for one workspace or for none. */
export function systemToken (workspace?: WorkspaceUuid): string {
  return generateToken(systemAccountUuid, workspace, { service: 'gitlab' })
}

export async function createPlatformClient (
  ctx: MeasureContext,
  workspace: WorkspaceUuid,
  config: Config,
  onConnect?: (event: ClientConnectEvent) => Promise<void>
): Promise<Client> {
  setMetadata(client.metadata.ClientSocketFactory, (url) => {
    return new WebSocket(url, { headers: { 'User-Agent': config.ServiceID } }) as never
  })
  const token = systemToken(workspace)
  setMetadata(client.metadata.UseBinaryProtocol, true)
  setMetadata(client.metadata.UseProtocolCompression, true)
  setMetadata(client.metadata.ConnectionTimeout, ACCOUNT_CLIENT_TIMEOUT_MS)
  setMetadata(client.metadata.FilterModel, 'client')
  const endpoint = await getTransactorEndpoint(token)
  return await (
    await clientResources()
  ).function.GetClient(token, endpoint, {
    ctx,
    useGlobalRPCHandler: true,
    onConnect:
      onConnect === undefined
        ? undefined
        : async (event) => {
            await onConnect(event)
          }
  })
}
