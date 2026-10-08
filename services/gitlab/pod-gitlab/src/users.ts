// SPDX-License-Identifier: EPL-2.0

import type { AccountClient, IntegrationSecret } from '@hcengineering/account-client'
import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import { gitlabUserIntegrationKind } from '@hcengineering/gitlab'
import { assertWorkspace } from './caller'
import type { OAuthConfig } from './config'
import type { FetchFn } from './gitlab/api'
import { isTokenExpired, refreshTokens } from './gitlab/oauth'

export interface GitlabUserRecord {
  // Huly social id the token belongs to
  account: PersonId
  // Workspace whose GitLab application issued the token
  workspace: WorkspaceUuid
  // GitLab instance the token is valid for
  host: string
  userId: number
  login: string
  token: string
  refreshToken: string | null
  // Epoch seconds
  expiresAt: number | null
  scope: string
}

export type SecretStore = Pick<
AccountClient,
| 'getIntegration'
| 'createIntegration'
| 'updateIntegration'
| 'getIntegrationSecret'
| 'addIntegrationSecret'
| 'updateIntegrationSecret'
| 'listIntegrationsSecrets'
| 'deleteIntegrationSecret'
| 'deleteIntegration'
>

export class GitlabUserManager {
  // GitLab rotates refresh tokens, so concurrent refreshes for one user must share a single request.
  // Keyed by `${workspace}:${socialId}`.
  private readonly refreshing = new Map<string, Promise<GitlabUserRecord | undefined>>()

  constructor (
    private readonly store: SecretStore,
    // Resolved on every refresh, so a renewed or removed workspace application takes effect immediately.
    private readonly resolveOAuth: (workspace: WorkspaceUuid) => Promise<OAuthConfig | undefined>,
    private readonly fetchFn: FetchFn = fetch,
    private readonly nowSec: () => number = () => Math.floor(Date.now() / 1000)
  ) {}

  async getByRef (workspace: WorkspaceUuid, socialId: PersonId): Promise<GitlabUserRecord | undefined> {
    assertWorkspace(workspace)
    const secrets = await this.store.listIntegrationsSecrets({ kind: gitlabUserIntegrationKind, workspaceUuid: workspace, socialId })
    if (secrets.length === 0) {
      return undefined
    }
    return this.parse(secrets[0])
  }

  async save (record: GitlabUserRecord): Promise<void> {
    assertWorkspace(record.workspace)
    const key = String(record.userId)
    const integrationKey = { kind: gitlabUserIntegrationKind, workspaceUuid: record.workspace, socialId: record.account }
    const data = { login: record.login, userId: record.userId }
    const integration = await this.store.getIntegration(integrationKey)
    if (integration == null) {
      await this.store.createIntegration({ ...integrationKey, data })
    } else if (integration.data?.login !== record.login || integration.data?.userId !== record.userId) {
      await this.store.updateIntegration({ ...integrationKey, data })
    }
    const secret = { key, ...integrationKey, secret: JSON.stringify(record) }
    const existing = await this.store.getIntegrationSecret({ key, ...integrationKey })
    if (existing != null) {
      await this.store.updateIntegrationSecret(secret)
    } else {
      await this.store.addIntegrationSecret(secret)
    }
    // One GitLab identity per Huly social id and workspace: drop secrets of any previously linked GitLab account.
    const all = await this.store.listIntegrationsSecrets({
      kind: gitlabUserIntegrationKind,
      workspaceUuid: record.workspace,
      socialId: record.account
    })
    for (const stale of all.filter((s) => s.key !== key)) {
      await this.store.deleteIntegrationSecret({
        key: stale.key,
        kind: stale.kind,
        socialId: stale.socialId,
        workspaceUuid: stale.workspaceUuid
      })
    }
  }

  async getValidRecord (workspace: WorkspaceUuid, socialId: PersonId): Promise<GitlabUserRecord | undefined> {
    assertWorkspace(workspace)
    const flightKey = `${workspace}:${socialId}`
    const pending = this.refreshing.get(flightKey)
    if (pending !== undefined) {
      return await pending
    }
    const record = await this.getByRef(workspace, socialId)
    if (record === undefined || !isTokenExpired(record, this.nowSec())) {
      return record
    }
    const inFlight = this.refreshing.get(flightKey)
    if (inFlight !== undefined) {
      return await inFlight
    }
    const promise = this.refresh(record).finally(() => this.refreshing.delete(flightKey))
    this.refreshing.set(flightKey, promise)
    return await promise
  }

  async remove (workspace: WorkspaceUuid, socialId: PersonId): Promise<void> {
    assertWorkspace(workspace)
    const key = { kind: gitlabUserIntegrationKind, workspaceUuid: workspace, socialId }
    // The account service deletes the integration's secrets together with the row.
    if ((await this.store.getIntegration(key)) != null) {
      await this.store.deleteIntegration(key)
    }
  }

  private async refresh (record: GitlabUserRecord): Promise<GitlabUserRecord | undefined> {
    if (record.refreshToken === null) {
      return undefined
    }
    const oauth = await this.resolveOAuth(record.workspace)
    if (oauth === undefined) {
      // The workspace application was removed: the token can no longer be refreshed.
      return undefined
    }
    try {
      const tokens = await refreshTokens(oauth, record.refreshToken, this.fetchFn)
      // GitLab may omit refresh_token on refresh; keep the stored one rather than losing it.
      const updated: GitlabUserRecord = { ...record, ...tokens, refreshToken: tokens.refreshToken ?? record.refreshToken }
      await this.save(updated)
      return updated
    } catch (err: unknown) {
      // Another pod/request may have rotated the refresh token after our read; use its result if valid.
      const latest = await this.getByRef(record.workspace, record.account)
      if (latest !== undefined && latest.token !== record.token && !isTokenExpired(latest, this.nowSec())) {
        return latest
      }
      throw err
    }
  }

  private parse (secret: IntegrationSecret): GitlabUserRecord {
    return { ...(JSON.parse(secret.secret) as GitlabUserRecord), account: secret.socialId }
  }
}
