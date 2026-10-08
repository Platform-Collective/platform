// SPDX-License-Identifier: EPL-2.0

import { type MeasureContext } from '@hcengineering/core'

import { type Config } from '../config'
import { AuthenticationError, type Authenticator, type SessionIdentity } from './authenticator'
import { ConfiguredAuthenticator } from './configured-authenticator'
import { HulyTokenAuthenticator } from './huly-token-authenticator'

/**
 * Allowlist checked before the real authenticator runs.
 *
 * It does two different jobs, and the two need different failure reasons:
 *
 * - In `perRequest` mode it narrows a shared endpoint down to the tokens an
 *   operator pinned to it, because Huly API tokens carry the full rights of
 *   their account and cannot be scoped any narrower.
 * - In `configured` mode it is the *only* thing standing between an anonymous
 *   caller and the configured Huly account. The configured authenticator
 *   ignores the credential entirely, so without this gate anyone who could
 *   reach the port would act as that account.
 *
 * Checking before delegating also means an unknown token never triggers a
 * login attempt against the account service.
 */
export class AllowlistedAuthenticator implements Authenticator {
  private readonly inner: Authenticator
  private readonly allowed: Set<string>

  constructor (inner: Authenticator, allowed: string[]) {
    this.inner = inner
    this.allowed = new Set(allowed)
  }

  async authenticate (rawToken: string): Promise<SessionIdentity> {
    // Distinguishing "no credential" from "wrong credential" matters to the
    // client: only `missing` gets a WWW-Authenticate challenge back, which is
    // what tells a client that it should present a credential at all.
    if (rawToken === '') {
      throw new AuthenticationError('missing', 'This MCP endpoint requires a bearer token')
    }
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
 *
 * `loadConfig` refuses to start in `configured` mode with an empty allowlist on
 * a non-loopback HOST, so by the time this runs the shared-secret gate exists
 * whenever it is needed. Logging it here makes that visible at boot rather than
 * something an operator has to infer from an absent 401.
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
