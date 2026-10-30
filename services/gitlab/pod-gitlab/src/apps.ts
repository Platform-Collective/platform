// SPDX-License-Identifier: EPL-2.0

import type { AccountClient, IntegrationSecret } from '@hcengineering/account-client'
import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import { gitlabAppIntegrationKind } from '@hcengineering/gitlab'
import { assertWorkspace } from './caller'
import { trimSlash, type OAuthConfig } from './config'
import { SyncRunner } from './sync/runner'

export interface GitlabAppConfig {
  // Base URL of the GitLab instance, normalised by normalizeHost
  host: string
  clientId: string
  clientSecret: string
  updatedOn: number
  // Social id of the owner who saved it
  updatedBy: PersonId
}

export type AppSecretStore = Pick<
  AccountClient,
  | 'listIntegrations'
  | 'getIntegration'
  | 'createIntegration'
  | 'updateIntegration'
  | 'deleteIntegration'
  | 'listIntegrationsSecrets'
  | 'getIntegrationSecret'
  | 'addIntegrationSecret'
  | 'updateIntegrationSecret'
  | 'deleteIntegrationSecret'
>

// Used when a workspace saves an application without a host
export const DEFAULT_GITLAB_HOST = 'https://gitlab.com'

const APP_KEY = 'app'
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|.+\.local)$/

export interface NormalizeHostOptions {
  // Accept plain http for localhost, 127.0.0.1 and *.local (GITLAB_ALLOW_INSECURE_HOSTS, dev only)
  allowInsecure?: boolean
}

export function normalizeHost (raw: string, options: NormalizeHostOptions = {}): string {
  const value = trimSlash(raw.trim())
  if (value.includes('?') || value.includes('#')) throw new Error('Invalid GitLab URL')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid GitLab URL')
  }
  const httpAllowed = options.allowInsecure === true && url.protocol === 'http:' && LOCAL_HOST.test(url.hostname)
  if (
    (url.protocol !== 'https:' && !httpAllowed) ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('Invalid GitLab URL')
  }
  return trimSlash(`${url.origin}${url.pathname}`)
}

/** Maps a workspace's stored application to the OAuth settings used for GitLab calls. */
export function toOAuthConfig (
  app: Pick<GitlabAppConfig, 'host' | 'clientId' | 'clientSecret'>,
  redirectUri: string
): OAuthConfig {
  return { GitlabHost: app.host, ClientID: app.clientId, ClientSecret: app.clientSecret, RedirectURI: redirectUri }
}

function parseConfig (raw: string): GitlabAppConfig | undefined {
  try {
    const value = JSON.parse(raw)
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof value.host === 'string' &&
      typeof value.clientId === 'string' &&
      typeof value.clientSecret === 'string' &&
      typeof value.updatedOn === 'number'
    ) {
      return value as GitlabAppConfig
    }
  } catch {
    // Malformed secret, ignored
  }
  return undefined
}

/**
 * Stores one GitLab OAuth application per workspace as an account-service secret.
 * The secret is only ever read by the pod.
 */
export class GitlabAppStore {
  private readonly runner = new SyncRunner()

  constructor (private readonly store: AppSecretStore) {}

  async get (workspace: WorkspaceUuid): Promise<GitlabAppConfig | undefined> {
    assertWorkspace(workspace)
    let best: GitlabAppConfig | undefined
    for (const secret of await this.list(workspace)) {
      if (secret.key !== APP_KEY) continue
      const config = parseConfig(secret.secret)
      if (config !== undefined && (best === undefined || config.updatedOn > best.updatedOn)) best = config
    }
    return best
  }

  async save (workspace: WorkspaceUuid, config: GitlabAppConfig): Promise<void> {
    assertWorkspace(workspace)
    await this.runner.exec(workspace, async () => {
      const integrationKey = { kind: gitlabAppIntegrationKind, workspaceUuid: workspace, socialId: config.updatedBy }
      const data = { host: config.host, clientId: config.clientId }
      const integration = await this.store.getIntegration(integrationKey)
      if (integration == null) {
        await this.store.createIntegration({ ...integrationKey, data })
      } else if (integration.data?.host !== data.host || integration.data?.clientId !== data.clientId) {
        await this.store.updateIntegration({ ...integrationKey, data })
      }

      const secretKey = { ...integrationKey, key: APP_KEY }
      const secret = { ...secretKey, secret: JSON.stringify(config) }
      if ((await this.store.getIntegrationSecret(secretKey)) != null) {
        await this.store.updateIntegrationSecret(secret)
      } else {
        await this.store.addIntegrationSecret(secret)
      }

      // Only after the new config is written: drop other owners' secrets and integration rows.
      for (const old of await this.list(workspace)) {
        if (old.socialId !== config.updatedBy) await this.deleteSecretAndIntegration(old)
      }
      for (const row of await this.store.listIntegrations({
        kind: gitlabAppIntegrationKind,
        workspaceUuid: workspace
      })) {
        if (row.socialId !== config.updatedBy) {
          await this.store.deleteIntegration(this.integrationKey(row.socialId, workspace))
        }
      }
    })
  }

  async remove (workspace: WorkspaceUuid): Promise<void> {
    assertWorkspace(workspace)
    await this.runner.exec(workspace, async () => {
      for (const old of await this.list(workspace)) {
        await this.deleteSecretAndIntegration(old)
      }
      // Integration rows left without a secret
      for (const row of await this.store.listIntegrations({
        kind: gitlabAppIntegrationKind,
        workspaceUuid: workspace
      })) {
        await this.store.deleteIntegration(this.integrationKey(row.socialId, workspace))
      }
    })
  }

  private integrationKey (
    socialId: PersonId,
    workspace: WorkspaceUuid
  ): {
    kind: typeof gitlabAppIntegrationKind
    workspaceUuid: WorkspaceUuid
    socialId: PersonId
  } {
    return { kind: gitlabAppIntegrationKind, workspaceUuid: workspace, socialId }
  }

  private async list (workspace: WorkspaceUuid): Promise<IntegrationSecret[]> {
    return await this.store.listIntegrationsSecrets({ kind: gitlabAppIntegrationKind, workspaceUuid: workspace })
  }

  private async deleteSecretAndIntegration (secret: IntegrationSecret): Promise<void> {
    await this.store.deleteIntegrationSecret({
      key: secret.key,
      kind: secret.kind,
      socialId: secret.socialId,
      workspaceUuid: secret.workspaceUuid
    })
    await this.store.deleteIntegration({
      kind: secret.kind,
      socialId: secret.socialId,
      workspaceUuid: secret.workspaceUuid
    })
  }
}
