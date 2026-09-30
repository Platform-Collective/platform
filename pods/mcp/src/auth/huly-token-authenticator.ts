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

import {
  getClient as getAccountClient,
  isWorkspaceLoginInfo,
  type AccountClient,
  type LoginInfoByToken
} from '@hcengineering/account-client'
import { type MeasureContext } from '@hcengineering/core'
import { setApiTokenRevocationChecker, verifyToken } from '@hcengineering/server-token'

import { AuthenticationError, type Authenticator, type SessionIdentity, toTransactorHttpUrl } from './authenticator'

export interface HulyTokenAuthenticatorOptions {
  accountsUrl: string
  /** TTL for the cached account-service round trip, in milliseconds. */
  cacheTtlMs?: number
  now?: () => number
}

interface CacheEntry {
  identity: SessionIdentity
  expiresOn: number
}

const DEFAULT_CACHE_TTL_MS = 60_000

/**
 * Authenticates MCP callers with a regular Huly API token.
 *
 * Two independent checks are performed on purpose:
 *
 *  1. `verifyToken` — signature, expiry and revocation. Revocation is only
 *     enforced when a process registers a checker, which is why
 *     `registerRevocationChecker` runs in the constructor.
 *  2. `getLoginInfoByToken` — the account service is the authority on whether a
 *     token still maps to a live account and workspace, and it hands back a token
 *     already scoped to that workspace.
 *
 * The second check costs one round trip, so successful results are cached for a
 * short TTL. The TTL is deliberately short: revocation is enforced fail-closed
 * in the transactor, and a minute of staleness here is the price for not hitting
 * the account service on every single tool call.
 */
export class HulyTokenAuthenticator implements Authenticator {
  private readonly ctx: MeasureContext
  private readonly accountsUrl: string
  private readonly cacheTtlMs: number
  private readonly now: () => number
  private readonly cache = new Map<string, CacheEntry>()

  constructor (ctx: MeasureContext, options: HulyTokenAuthenticatorOptions) {
    this.ctx = ctx
    this.accountsUrl = options.accountsUrl
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.now = options.now ?? Date.now

    this.registerRevocationChecker()
  }

  /**
   * Makes `verifyToken` reject revoked API tokens. Without this, a revoked token
   * is silently accepted by this process — see `setApiTokenRevocationChecker`.
   */
  private registerRevocationChecker (): void {
    setApiTokenRevocationChecker(async (_apiTokenId: string, _decoded: unknown, raw: string) => {
      try {
        await this.accountClient(raw).getLoginInfoByToken()
        return false
      } catch (err) {
        // Only an explicit Unauthorized means "revoked". Anything else (network
        // hiccup, account service restart) rethrows so the checker's own
        // fail-closed path decides, instead of us guessing.
        const status = (err as { status?: { code?: number } })?.status?.code
        if (status === 401) return true
        throw err
      }
    })
  }

  private accountClient (token: string): AccountClient {
    return getAccountClient(this.accountsUrl, token)
  }

  async authenticate (rawToken: string): Promise<SessionIdentity> {
    if (rawToken === '') {
      throw new AuthenticationError('missing', 'Missing bearer token')
    }

    const cached = this.cache.get(rawToken)
    if (cached !== undefined && cached.expiresOn > this.now()) {
      return cached.identity
    }

    const token = await this.verify(rawToken)
    this.assertUsable(token.extra)

    const identity = await this.resolveWorkspace(rawToken, token)

    this.cache.set(rawToken, { identity, expiresOn: this.now() + this.cacheTtlMs })
    this.sweepCache()

    return identity
  }

  private async verify (rawToken: string): Promise<SessionIdentity['token']> {
    try {
      return await verifyToken(rawToken)
    } catch (err) {
      this.ctx.warn('mcp token rejected', { error: (err as Error)?.message })
      // Expired, revoked, malformed and unverifiable are indistinguishable from
      // the outside by design — the client only learns that the token is bad.
      throw new AuthenticationError('invalid', 'Invalid or expired token')
    }
  }

  private assertUsable (extra: Record<string, any> | undefined): void {
    if (extra?.guest === 'true') {
      throw new AuthenticationError('guest', 'Guest tokens cannot be used against the MCP server')
    }
    if (extra?.readonly === 'true' && extra?.admin === 'true') {
      throw new AuthenticationError('forbidden', 'Conflicting token flags')
    }
  }

  private async resolveWorkspace (rawToken: string, token: SessionIdentity['token']): Promise<SessionIdentity> {
    let loginInfo: LoginInfoByToken
    try {
      loginInfo = await this.accountClient(rawToken).getLoginInfoByToken()
    } catch (err) {
      this.ctx.warn('mcp account lookup failed', { error: (err as Error)?.message })
      throw new AuthenticationError('invalid', 'Invalid or revoked token')
    }

    if (!isWorkspaceLoginInfo(loginInfo)) {
      throw new AuthenticationError('invalid', 'Token is not bound to a workspace')
    }

    if (loginInfo.workspace !== token.workspace) {
      throw new AuthenticationError('forbidden', 'Token workspace mismatch')
    }

    return {
      account: token.account,
      workspace: token.workspace,
      token,
      workspaceToken: loginInfo.token,
      transactorUrl: toTransactorHttpUrl(loginInfo.endpoint),
      readOnly: token.extra?.readonly === 'true'
    }
  }

  private sweepCache (): void {
    if (this.cache.size <= 1024) return
    const now = this.now()
    for (const [key, entry] of this.cache) {
      if (entry.expiresOn <= now) this.cache.delete(key)
    }
  }
}
