/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { type AccountUuid, type WorkspaceUuid } from '@hcengineering/core'
import { type Token } from '@hcengineering/server-token'

/**
 * Everything the request pipeline needs to act on behalf of one caller.
 *
 * Resolved once per request, then frozen onto the MCP session: a session can
 * never change identity halfway through, so a stolen `Mcp-Session-Id` is useless
 * on its own and a token swap cannot escalate a live session.
 */
export interface SessionIdentity {
  /** Global person id (Huly `AccountUuid`). */
  account: AccountUuid
  /** Workspace the token is scoped to. */
  workspace: WorkspaceUuid
  /** The verified, unexpired, non-revoked token. */
  token: Token
  /** Re-signed token bound to `workspace`, used to talk to the transactor. */
  workspaceToken: string
  /** Transactor endpoint in http(s) form, derived from the ws endpoint. */
  transactorUrl: string
  /** True when the token carries `extra.readonly === 'true'`. */
  readOnly: boolean
}

export interface Authenticator {
  /**
   * Verifies a raw bearer token and resolves it to a workspace-scoped identity.
   * Rejects with `AuthenticationError` for any credential that must not be used
   * against this server.
   */
  authenticate: (rawToken: string) => Promise<SessionIdentity>
}

export type AuthenticationFailure = 'missing' | 'invalid' | 'guest' | 'forbidden'

export class AuthenticationError extends Error {
  readonly reason: AuthenticationFailure

  constructor (reason: AuthenticationFailure, message: string) {
    super(message)
    this.name = 'AuthenticationError'
    this.reason = reason
  }
}

/**
 * Turns a WebSocket transactor endpoint into its HTTP twin, which is what the
 * REST client and the blob endpoint expect.
 */
export function toTransactorHttpUrl (endpoint: string): string {
  return endpoint.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://')
}
