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
import { decodeToken } from '@hcengineering/server-token'

import { type Config } from '../config'
import { AuthenticationError, type Authenticator, type SessionIdentity, toTransactorHttpUrl } from './authenticator'

/** Builds an account-service client; injectable so the login flow can be unit tested. */
export type AccountClientFactory = (accountsUrl: string, token?: string) => AccountClient

/**
 * Authenticates every caller as one account configured on the pod itself.
 *
 * This is the shape a self-hosted install actually needs. The operator supplies
 * Huly's URL and a credential once, in compose; every MCP client (Claude
 * Desktop, an IDE, a phone) then connects to this pod with nothing but the pod's
 * own URL. Handing a Huly token to each agent instead would mean distributing
 * workspace-wide write access to every tool the user has ever installed.
 *
 * The identity is resolved lazily and cached, so the first tool call pays the
 * login round trip and later calls reuse it until the TTL expires.
 */
export class ConfiguredAuthenticator implements Authenticator {
  private readonly ctx: MeasureContext
  private readonly config: Config
  private cached: { identity: SessionIdentity, expiresOn: number } | undefined
  private inFlight: Promise<SessionIdentity> | undefined

  private readonly createClient: AccountClientFactory

  constructor (ctx: MeasureContext, config: Config, createClient: AccountClientFactory = getAccountClient) {
    this.ctx = ctx
    this.config = config
    this.createClient = createClient
  }

  async authenticate (): Promise<SessionIdentity> {
    const now = Date.now()
    if (this.cached !== undefined && this.cached.expiresOn > now) {
      return this.cached.identity
    }

    // Collapse a cold-start stampede: many MCP clients call initialize at once
    // on reconnect, and each would otherwise trigger its own login.
    if (this.inFlight !== undefined) return await this.inFlight

    const creation = this.resolve()
    this.inFlight = creation
    try {
      return await creation
    } finally {
      this.inFlight = undefined
    }
  }

  private async resolve (): Promise<SessionIdentity> {
    const identity = this.toIdentity(await this.login())
    // Kept short on purpose: a configured password or token can be rotated out
    // of band, and a long cache would keep using the old one after that.
    this.cached = { identity, expiresOn: Date.now() + this.config.LoginCacheTtlMs }
    this.ctx.info('mcp configured identity resolved', {
      workspace: identity.workspace,
      readOnly: identity.readOnly
    })
    return identity
  }

  private async login (): Promise<LoginInfoByToken> {
    try {
      const { info, accountToken } = await this.loginAtAccountLevel()
      if (isWorkspaceLoginInfo(info) || this.config.HulyWorkspace === '') {
        return info
      }
      // A login or a plain account token is scoped to the account, not to a
      // workspace, so the account service must be asked for a workspace token.
      return await this.createClient(this.config.AccountsUrl, accountToken).selectWorkspace(this.config.HulyWorkspace)
    } catch (err) {
      this.ctx.error('mcp configured login failed', { error: (err as Error)?.message })
      throw new AuthenticationError(
        'invalid',
        'The configured Huly credentials were rejected. Check HULY_TOKEN or HULY_EMAIL/HULY_PASSWORD.'
      )
    }
  }

  private async loginAtAccountLevel (): Promise<{ info: LoginInfoByToken, accountToken: string }> {
    if (this.config.HulyToken !== '') {
      const client = this.createClient(this.config.AccountsUrl, this.config.HulyToken)
      return { info: await client.getLoginInfoByToken(), accountToken: this.config.HulyToken }
    }
    const client = this.createClient(this.config.AccountsUrl)
    const info = await client.login(this.config.HulyEmail, this.config.HulyPassword)
    if (info?.token === undefined) {
      throw new Error('The account service returned no token (two-factor authentication may be required)')
    }
    return { info, accountToken: info.token }
  }

  private toIdentity (loginInfo: LoginInfoByToken): SessionIdentity {
    if (!isWorkspaceLoginInfo(loginInfo)) {
      throw new AuthenticationError(
        'invalid',
        this.config.HulyWorkspace === ''
          ? 'The configured account is not bound to a workspace. Set HULY_WORKSPACE to pick one.'
          : `The configured account could not be resolved to workspace "${this.config.HulyWorkspace}".`
      )
    }

    if (this.config.HulyWorkspace !== '' && !matchesWorkspace(loginInfo, this.config.HulyWorkspace)) {
      throw new AuthenticationError(
        'forbidden',
        `The configured account is bound to a different workspace than HULY_WORKSPACE="${this.config.HulyWorkspace}".`
      )
    }

    // The account service just minted this token and scoped it to the
    // workspace, so decoding it locally is enough to learn who we act as.
    // `decodeToken` verifies the signature, which also proves the account
    // service and this pod share SECRET.
    let token
    try {
      token = decodeToken(loginInfo.token)
    } catch {
      throw new AuthenticationError('invalid', 'The account service returned a token we cannot verify')
    }

    return {
      account: token.account,
      workspace: loginInfo.workspace,
      token,
      workspaceToken: loginInfo.token,
      transactorUrl: toTransactorHttpUrl(loginInfo.endpoint),
      readOnly: this.config.ReadOnly || token.extra?.readonly === 'true'
    }
  }
}

/** Accepts a workspace id, its url slug, or a case-insensitive id. */
function matchesWorkspace (loginInfo: { workspace: string, workspaceUrl: string }, wanted: string): boolean {
  return (
    loginInfo.workspace === wanted || loginInfo.workspaceUrl === wanted || loginInfo.workspace === wanted.toLowerCase()
  )
}
