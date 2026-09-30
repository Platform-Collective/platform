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

import { type MeasureContext } from '@hcengineering/core'

import { type Config } from '../config'
import { AuthenticationError, type Authenticator, type SessionIdentity } from './authenticator'
import { ConfiguredAuthenticator } from './configured-authenticator'
import { HulyTokenAuthenticator } from './huly-token-authenticator'

/**
 * Optional allowlist applied on top of per-request authentication.
 *
 * Huly API tokens carry the full rights of their account and cannot be scoped
 * narrower, so a shared multi-tenant endpoint needs its own gate: an operator
 * can pin the endpoint to specific tokens without changing Huly itself.
 */
class AllowlistedAuthenticator implements Authenticator {
  private readonly inner: Authenticator
  private readonly allowed: Set<string>

  constructor (inner: Authenticator, allowed: string[]) {
    this.inner = inner
    this.allowed = new Set(allowed)
  }

  async authenticate (rawToken: string): Promise<SessionIdentity> {
    if (!this.allowed.has(rawToken)) {
      throw new AuthenticationError('forbidden', 'This token is not permitted to use this MCP endpoint')
    }
    return await this.inner.authenticate(rawToken)
  }
}

/** Forces every identity to be read-only, whatever the underlying token says. */
class ReadOnlyAuthenticator implements Authenticator {
  private readonly inner: Authenticator

  constructor (inner: Authenticator) {
    this.inner = inner
  }

  async authenticate (rawToken: string): Promise<SessionIdentity> {
    const identity = await this.inner.authenticate(rawToken)
    return { ...identity, readOnly: true }
  }
}

/**
 * Chooses the authenticator for a deployment.
 *
 * Decorators are applied outermost-last so the read-only clamp always wins: it
 * is the operator's bluntest control and must not be bypassable by a token flag.
 */
export function createAuthenticator (ctx: MeasureContext, config: Config): Authenticator {
  let authenticator: Authenticator

  if (config.AuthMode === 'configured') {
    authenticator = new ConfiguredAuthenticator(ctx, config)
  } else {
    authenticator = new HulyTokenAuthenticator(ctx, {
      accountsUrl: config.AccountsUrl,
      cacheTtlMs: config.LoginCacheTtlMs
    })
  }

  if (config.AllowedTokens.length > 0) {
    authenticator = new AllowlistedAuthenticator(authenticator, config.AllowedTokens)
  }

  if (config.ReadOnly) {
    authenticator = new ReadOnlyAuthenticator(authenticator)
  }

  ctx.info('mcp authenticator ready', {
    mode: config.AuthMode,
    allowlist: config.AllowedTokens.length > 0,
    readOnly: config.ReadOnly
  })

  return authenticator
}
