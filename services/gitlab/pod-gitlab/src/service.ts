// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import core, {
  type MeasureContext,
  type PersonId,
  type PersonUuid,
  type Ref,
  type TxOperations,
  type WorkspaceUuid
} from '@hcengineering/core'
import gitlab, {
  gitlabIntegrationKind,
  type GitlabAuthentication,
  type GitlabIntegration,
  type GitlabIntegrationRepository,
  type GitlabProject
} from '@hcengineering/gitlab'
import tracker, { type Project } from '@hcengineering/tracker'
import { DEFAULT_GITLAB_HOST, normalizeHost, toOAuthConfig, type GitlabAppConfig, type GitlabAppStore } from './apps'
import { redirectUriFor, type Config, type OAuthConfig } from './config'
import { GitlabApi, type FetchFn } from './gitlab/api'
import { buildAuthorizeUrl, exchangeCode, GITLAB_SCOPES, revokeToken } from './gitlab/oauth'
import type { GitlabUser, GitlabUserRef } from './gitlab/types'
import { ensureRepositoryHook, removeRepositoryHook } from './hooks'
import { APP_IN_USE, HttpError } from './http-error'
import type { HostGuard } from './host-guard'
import { EXPIRED_ERROR, errorMessage } from './sync/errors'
import { refreshIntegrationRepositories } from './repositories'
import { signState, verifyState, type OAuthStatePayload } from './state'
import type { GitlabUserManager, GitlabUserRecord } from './users'

export interface CallerIdentity {
  workspace: WorkspaceUuid
  // Huly account uuid from the verified token
  account: string
}

export interface WorkspaceSession {
  client: TxOperations
  close: () => Promise<void>
}

export interface GitlabAppStatus {
  configured: boolean
  host?: string
  clientId?: string
  // Callback URL to register in the GitLab application
  redirectUri: string
  scopes: string
}

export interface GitlabAppInput {
  // Empty or missing means gitlab.com; only self-managed GitLab needs it
  host?: string
  clientId: string
  // May be omitted when re-saving the same application to keep the stored secret
  clientSecret?: string
}

/** The caller of a project hook route. */
export interface RepositoryCaller {
  accountId: PersonId
  // Workspace Maintainer or higher; asked only when the caller did not connect the repository's integration
  isMaintainer: () => Promise<boolean>
}

export class GitlabNotConfiguredError extends Error {
  constructor () {
    super('GitLab is not configured for this workspace')
    this.name = 'GitlabNotConfiguredError'
  }
}

export interface ServiceDeps {
  config: Config
  users: Pick<GitlabUserManager, 'save' | 'getValidRecord' | 'remove'>
  accounts: Pick<AccountClient, 'getIntegration' | 'createIntegration' | 'updateIntegration' | 'deleteIntegration'>
  apps: Pick<GitlabAppStore, 'get' | 'save' | 'remove'>
  // Self-managed hosts the pod may call (HostGuard)
  hostGuard: Pick<HostGuard, 'assertAllowed'>
  openSession: (workspace: WorkspaceUuid, accountId: PersonId) => Promise<WorkspaceSession>
  // Attaches the connecting user's GitLab identity to their Huly person (best effort)
  linkIdentity?: (client: TxOperations, personUuid: PersonUuid, host: string, user: GitlabUserRef) => Promise<void>
  // The set of GitLab connections in the workspace changed: start/stop its worker and re-sync
  onWorkspaceChanged?: (workspace: WorkspaceUuid) => void
  fetchFn: FetchFn
  now?: () => number
}

export class GitlabService {
  constructor (private readonly deps: ServiceDeps) {}

  private now (): number {
    return (this.deps.now ?? Date.now)()
  }

  /** `origin` is the browser's Huly front origin; the callback goes back there. */
  async authorizeUrl (caller: OAuthStatePayload, origin?: string): Promise<string> {
    const oauth = await this.oauthFor(caller.workspace)
    const redirectUri = redirectUriFor(origin, oauth.RedirectURI)
    const state = signState({ ...caller, redirectUri }, this.deps.config.ServerSecret, this.now())
    return buildAuthorizeUrl({ ...oauth, RedirectURI: redirectUri }, state)
  }

  /** Public view of the workspace's GitLab application; never includes the secret. */
  async appStatus (workspace: WorkspaceUuid, origin?: string): Promise<GitlabAppStatus> {
    const app = await this.deps.apps.get(workspace)
    const common = { redirectUri: redirectUriFor(origin, this.deps.config.RedirectURI), scopes: GITLAB_SCOPES }
    if (app === undefined) {
      return { configured: false, ...common }
    }
    return { configured: true, host: app.host, clientId: app.clientId, ...common }
  }

  async saveApp (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    accountId: PersonId,
    input: GitlabAppInput
  ): Promise<void> {
    const rawHost = input.host?.trim() ?? ''
    const host =
      rawHost === ''
        ? DEFAULT_GITLAB_HOST
        : normalizeHost(rawHost, { allowInsecure: this.deps.config.AllowInsecureHosts === true })
    // Only public addresses, or the hosts GITLAB_ALLOWED_HOSTS lists: the pod calls this host with server credentials
    await this.deps.hostGuard.assertAllowed(host)
    const clientId = input.clientId.trim()
    if (clientId === '') {
      throw new Error('Application ID is required')
    }
    const stored = await this.deps.apps.get(workspace)
    const sameApp = stored !== undefined && stored.host === host && stored.clientId === clientId
    const newSecret = input.clientSecret?.trim() ?? ''
    let clientSecret: string
    if (newSecret !== '') {
      clientSecret = newSecret
    } else if (sameApp) {
      clientSecret = stored.clientSecret
    } else {
      throw new Error('Application secret is required')
    }
    if (!sameApp) {
      await this.assertNoConnections(workspace, accountId)
    }
    await this.deps.apps.save(workspace, { host, clientId, clientSecret, updatedOn: this.now(), updatedBy: accountId })
    ctx.info('gitlab application saved', { workspace, host, clientId })
  }

  async removeApp (ctx: MeasureContext, workspace: WorkspaceUuid): Promise<void> {
    await this.assertNoConnections(workspace, core.account.System)
    await this.deps.apps.remove(workspace)
    ctx.info('gitlab application removed', { workspace })
  }

  /** Refuses while any member is connected, naming them so an owner knows whom to ask (or to disconnect everyone). */
  private async assertNoConnections (workspace: WorkspaceUuid, accountId: PersonId): Promise<void> {
    const logins = await this.withClient(workspace, accountId, async (client) =>
      (await client.findAll(gitlab.class.GitlabIntegration, {})).map((it) => it.login)
    )
    if (logins.length > 0) {
      throw new HttpError(
        409,
        `Disconnect GitLab before changing the application (connected: ${[...new Set(logins)].join(', ')})`,
        APP_IN_USE
      )
    }
  }

  private async appFor (workspace: WorkspaceUuid): Promise<GitlabAppConfig> {
    const app = await this.deps.apps.get(workspace)
    if (app === undefined) {
      throw new GitlabNotConfiguredError()
    }
    return app
  }

  private async oauthFor (workspace: WorkspaceUuid): Promise<OAuthConfig> {
    return toOAuthConfig(await this.appFor(workspace), this.deps.config.RedirectURI)
  }

  private async withClient<T>(
    workspace: WorkspaceUuid,
    accountId: PersonId,
    fn: (client: TxOperations) => Promise<T>
  ): Promise<T> {
    const session = await this.deps.openSession(workspace, accountId)
    try {
      return await fn(session.client)
    } finally {
      await session.close()
    }
  }

  async authorize (
    ctx: MeasureContext,
    payload: { code: string, state: string, caller: CallerIdentity }
  ): Promise<void> {
    const state = verifyState(payload.state, this.deps.config.ServerSecret, this.now())
    // The callback must come from the same Huly user/workspace that started the flow (prevents account-linking CSRF).
    if (state.workspace !== payload.caller.workspace || state.account !== payload.caller.account) {
      throw new Error('OAuth state does not match the current user')
    }
    const workspace = state.workspace
    let user: GitlabUser
    let record: GitlabUserRecord
    let host: string
    try {
      const configured = await this.oauthFor(workspace)
      const oauth = { ...configured, RedirectURI: state.redirectUri ?? configured.RedirectURI }
      host = oauth.GitlabHost
      const tokens = await exchangeCode(oauth, payload.code, this.deps.fetchFn)
      user = await new GitlabApi(host, tokens.token, this.deps.fetchFn).getCurrentUser()
      record = {
        account: state.accountId,
        workspace,
        host,
        userId: user.id,
        login: user.username,
        ...tokens
      }
      // Must run before save(): it needs the previous identity's token to remove its hooks.
      await this.withClient(workspace, state.accountId, async (client) => {
        await this.removeReplacedIntegrations(ctx, client, workspace, state.accountId, user.id)
      })
      await this.deps.users.save(record)
    } catch (err: unknown) {
      const message = errorMessage(err)
      ctx.error('gitlab authorization failed', { workspace, error: message })
      await this.withClient(workspace, state.accountId, async (client) => {
        await this.upsertAuthentication(client, state.accountId, { error: message })
      })
      throw err
    }

    await this.withClient(workspace, state.accountId, async (client) => {
      await this.upsertAuthentication(client, state.accountId, {
        login: user.username,
        name: user.name,
        avatar: user.avatar_url ?? undefined,
        url: user.web_url,
        error: null
      })
      const integration = await this.upsertIntegration(client, host, state.accountId, user)
      try {
        await this.deps.linkIdentity?.(client, state.account as PersonUuid, host, user)
      } catch (err: unknown) {
        ctx.warn('gitlab identity not linked to the Huly person', {
          error: errorMessage(err)
        })
      }
      await this.syncRepositories(client, host, integration, record.token)
    })

    const key = { kind: gitlabIntegrationKind, workspaceUuid: workspace, socialId: state.accountId }
    const data = { gitlabUserId: user.id, login: user.username }
    if ((await this.deps.accounts.getIntegration(key)) == null) {
      await this.deps.accounts.createIntegration({ ...key, data })
    } else {
      await this.deps.accounts.updateIntegration({ ...key, data })
    }
    this.deps.onWorkspaceChanged?.(workspace)
  }

  async refresh (ctx: MeasureContext, workspace: WorkspaceUuid, accountId: PersonId): Promise<void> {
    await this.appFor(workspace)
    ctx.info('gitlab refresh requested', { workspace, accountId })
    // Bookkeeping as System: link rewrites must not queue every issue again or make the caller their author
    await this.withClient(workspace, core.account.System, async (client) => {
      for (const integration of await client.findAll(gitlab.class.GitlabIntegration, {})) {
        try {
          const record = await this.deps.users.getValidRecord(workspace, integration.connectedBy)
          if (record === undefined) {
            await client.update(integration, { alive: false, error: EXPIRED_ERROR })
            continue
          }
          await this.syncRepositories(client, integration.host, integration, record.token)
          if (!integration.alive || (integration.error ?? null) !== null) {
            await client.update(integration, { alive: true, error: null })
          }
        } catch (err: unknown) {
          // One member's broken connection must not stop the others' refresh
          const message = errorMessage(err)
          ctx.warn('gitlab refresh failed for an integration', { login: integration.login, error: message })
          await client.update(integration, { alive: false, error: message })
        }
      }
    })
  }

  async enableRepository (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    repositoryId: Ref<GitlabIntegrationRepository>,
    caller: RepositoryCaller
  ): Promise<void> {
    await this.withClient(workspace, core.account.System, async (client) => {
      const { repository, integration, api } = await this.resolveRepository(
        client,
        workspace,
        repositoryId,
        caller,
        'enable'
      )
      const hookId = await ensureRepositoryHook(
        client,
        api,
        repository,
        { baseUrl: this.deps.config.WebhookBaseURL, master: this.deps.config.WebhookSecret },
        { workspace, integration: integration._id }
      )
      ctx.info('gitlab hook installed', { workspace, projectId: repository.projectId, hookId })
    })
  }

  async disableRepository (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    repositoryId: Ref<GitlabIntegrationRepository>,
    caller: RepositoryCaller
  ): Promise<void> {
    await this.withClient(workspace, core.account.System, async (client) => {
      const { repository, api } = await this.resolveRepository(client, workspace, repositoryId, caller, 'disable')
      await removeRepositoryHook(client, api, repository)
    })
  }

  async disconnect (ctx: MeasureContext, workspace: WorkspaceUuid, accountId: PersonId): Promise<void> {
    // A member disconnects only the GitLab connections they made.
    await this.withClient(workspace, accountId, async (client) => {
      await this.removeMemberDocs(ctx, client, workspace, accountId)
    })
    await this.removeMemberAccountState(ctx, workspace, accountId)
    this.deps.onWorkspaceChanged?.(workspace)
  }

  /**
   * Owner-only: disconnects every member, each with their own token for best-effort hook deletion,
   * so a departed member's connection cannot block changing or removing the application.
   */
  async disconnectAll (ctx: MeasureContext, workspace: WorkspaceUuid): Promise<void> {
    const members = await this.withClient(workspace, core.account.System, async (client) => {
      const connected = [
        ...new Set((await client.findAll(gitlab.class.GitlabIntegration, {})).map((it) => it.connectedBy))
      ]
      for (const member of connected) {
        await this.removeMemberDocs(ctx, client, workspace, member)
      }
      return connected
    })
    for (const member of members) {
      try {
        await this.removeMemberAccountState(ctx, workspace, member)
      } catch (err: unknown) {
        // A member without an account row (e.g. a half-finished earlier authorization) must not block the rest
        ctx.warn('gitlab account state cleanup failed for a member', {
          error: errorMessage(err)
        })
        await this.deps.users.remove(workspace, member).catch(() => {})
      }
    }
    this.deps.onWorkspaceChanged?.(workspace)
    ctx.info('gitlab disconnected for every member', { workspace, members: members.length })
  }

  /** Removes the member's integrations (hooks best effort with their token), repositories and "Connected as ..." state. */
  private async removeMemberDocs (
    ctx: MeasureContext,
    client: TxOperations,
    workspace: WorkspaceUuid,
    member: PersonId
  ): Promise<void> {
    for (const integration of await client.findAll(gitlab.class.GitlabIntegration, { connectedBy: member })) {
      let token: string | undefined
      try {
        token = (await this.deps.users.getValidRecord(workspace, member))?.token
      } catch (err: unknown) {
        // An unrefreshable token must not block disconnecting; the hooks are then left in place.
        ctx.warn('gitlab token unavailable for hook cleanup', {
          error: errorMessage(err)
        })
      }
      await this.removeIntegration(ctx, client, integration, token)
    }
    for (const auth of await client.findAll(gitlab.class.GitlabAuthentication, { attachedTo: member })) {
      await client.remove(auth)
    }
  }

  /** Best effort: a token deleted only in Huly would stay valid at GitLab. */
  private async revokeMemberToken (ctx: MeasureContext, workspace: WorkspaceUuid, member: PersonId): Promise<void> {
    try {
      const record = await this.deps.users.getValidRecord(workspace, member)
      const app = await this.deps.apps.get(workspace)
      // Another application issued it, or nothing to revoke
      if (record === undefined || app === undefined || app.host !== record.host) return
      await revokeToken(toOAuthConfig(app, this.deps.config.RedirectURI), record.token, this.deps.fetchFn)
    } catch (err: unknown) {
      ctx.warn('gitlab token not revoked', { error: errorMessage(err) })
    }
  }

  private async removeMemberAccountState (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    member: PersonId
  ): Promise<void> {
    // Hook cleanup is done; revoke first (best effort, never throws), so a failing account call cannot skip it.
    await this.revokeMemberToken(ctx, workspace, member)
    await this.deps.accounts.deleteIntegration({
      kind: gitlabIntegrationKind,
      workspaceUuid: workspace,
      socialId: member
    })
    // Tokens are workspace-scoped: drop the member's token last.
    await this.deps.users.remove(workspace, member)
  }

  /**
   * Removes integrations this person made with a previously linked GitLab identity, so a re-link
   * does not leave a zombie integration that would be reconciled with the new identity's token.
   */
  private async removeReplacedIntegrations (
    ctx: MeasureContext,
    client: TxOperations,
    workspace: WorkspaceUuid,
    accountId: PersonId,
    gitlabUserId: number
  ): Promise<void> {
    const replaced = (await client.findAll(gitlab.class.GitlabIntegration, { connectedBy: accountId })).filter(
      (it) => it.gitlabUserId !== gitlabUserId
    )
    if (replaced.length === 0) return
    let previous: GitlabUserRecord | undefined
    try {
      previous = await this.deps.users.getValidRecord(workspace, accountId)
    } catch (err: unknown) {
      ctx.warn('previous gitlab token unavailable', { error: errorMessage(err) })
    }
    for (const integration of replaced) {
      const token = previous !== undefined && previous.userId === integration.gitlabUserId ? previous.token : undefined
      if (token === undefined) {
        ctx.warn('previous gitlab token unavailable or belongs to another user, hooks not deleted', {
          gitlabUserId: integration.gitlabUserId
        })
      }
      await this.removeIntegration(ctx, client, integration, token)
    }
  }

  /**
   * Deletes the integration's hooks best effort (when a token is given), then its repositories and the integration.
   * Uses the host stored on the integration, so disconnecting never depends on the workspace application.
   */
  private async removeIntegration (
    ctx: MeasureContext,
    client: TxOperations,
    integration: GitlabIntegration,
    token: string | undefined
  ): Promise<void> {
    const api = token !== undefined ? new GitlabApi(integration.host, token, this.deps.fetchFn) : undefined
    const repositories = await client.findAll(gitlab.class.GitlabIntegrationRepository, { attachedTo: integration._id })
    const orphanedHooks: number[] = []
    for (const repository of repositories) {
      if (repository.hookId !== null) {
        if (api === undefined) {
          orphanedHooks.push(repository.projectId)
        } else {
          await api.deleteProjectHook(repository.projectId, repository.hookId).catch((err: Error) => {
            ctx.warn('failed to delete gitlab hook', { projectId: repository.projectId, error: err.message })
          })
        }
      }
      await client.remove(repository)
    }
    if (orphanedHooks.length > 0) {
      ctx.warn('gitlab hooks left in place, token unavailable', { projectIds: orphanedHooks })
    }
    await this.unlinkRemovedRepositories(
      client,
      integration._id,
      repositories.map((it) => it._id)
    )
    await client.remove(integration)
  }

  /**
   * Drops removed repositories from tracker projects' GitLab mixins so they do not keep dangling links.
   * `integration` is a required ref and is left as is; a project with no repositories is linkable again.
   */
  private async unlinkRemovedRepositories (
    client: TxOperations,
    integrationId: Ref<GitlabIntegration>,
    removed: Array<Ref<GitlabIntegrationRepository>>
  ): Promise<void> {
    const projects = new Map<Ref<GitlabProject>, GitlabProject>()
    for (const project of await client.findAll(gitlab.mixin.GitlabProject, { integration: integrationId })) {
      projects.set(project._id, project)
    }
    for (const repositoryId of removed) {
      for (const project of await client.findAll(gitlab.mixin.GitlabProject, { repositories: repositoryId })) {
        projects.set(project._id, project)
      }
    }
    const removedIds = new Set<Ref<GitlabIntegrationRepository>>(removed)
    for (const project of projects.values()) {
      const current = project.repositories ?? []
      const remaining = current.filter((it) => !removedIds.has(it))
      if (remaining.length === current.length) continue
      await client.updateMixin(
        project._id as Ref<Project>,
        tracker.class.Project,
        project.space,
        gitlab.mixin.GitlabProject,
        {
          repositories: remaining
        }
      )
    }
  }

  private async resolveRepository (
    client: TxOperations,
    workspace: WorkspaceUuid,
    repositoryId: Ref<GitlabIntegrationRepository>,
    caller: RepositoryCaller,
    action: 'enable' | 'disable'
  ): Promise<{ repository: GitlabIntegrationRepository, integration: GitlabIntegration, api: GitlabApi }> {
    const repository = await client.findOne(gitlab.class.GitlabIntegrationRepository, { _id: repositoryId })
    if (repository === undefined) {
      throw new Error('Repository not found')
    }
    const integration = await client.findOne(gitlab.class.GitlabIntegration, { _id: repository.attachedTo })
    if (integration === undefined) {
      throw new Error('Integration not found')
    }
    // The hook runs with the connecting member's GitLab token. An unlinked repository's hook may always go: the Huly
    // unlink that left it behind already passed Huly's permission checks.
    const unlinked = repository.gitlabProject === null || !repository.enabled
    if (
      !(action === 'disable' && unlinked) &&
      integration.connectedBy !== caller.accountId &&
      !(await caller.isMaintainer())
    ) {
      throw new HttpError(
        403,
        'Only the member who connected this GitLab account or a workspace maintainer can manage its project hooks'
      )
    }
    const record = await this.deps.users.getValidRecord(workspace, integration.connectedBy)
    if (record === undefined) {
      throw new Error(EXPIRED_ERROR)
    }
    return { repository, integration, api: new GitlabApi(integration.host, record.token, this.deps.fetchFn) }
  }

  private async upsertAuthentication (
    client: TxOperations,
    accountId: PersonId,
    update: Partial<GitlabAuthentication>
  ): Promise<void> {
    const existing = await client.findOne(gitlab.class.GitlabAuthentication, { attachedTo: accountId })
    if (existing !== undefined) {
      await client.update(existing, { ...update, authRequestTime: this.now() })
      return
    }
    await client.createDoc(gitlab.class.GitlabAuthentication, core.space.Workspace, {
      attachedTo: accountId,
      login: '',
      ...update,
      authRequestTime: this.now()
    })
  }

  private async upsertIntegration (
    client: TxOperations,
    host: string,
    accountId: PersonId,
    user: GitlabUser
  ): Promise<GitlabIntegration> {
    const existing = await client.findOne(gitlab.class.GitlabIntegration, { host, gitlabUserId: user.id })
    if (existing !== undefined) {
      await client.update(existing, {
        login: user.username,
        name: user.name,
        connectedBy: accountId,
        alive: true,
        error: null
      })
      return { ...existing, login: user.username, name: user.name, connectedBy: accountId, alive: true, error: null }
    }
    const _id = await client.createDoc(gitlab.class.GitlabIntegration, core.space.Configuration, {
      host,
      gitlabUserId: user.id,
      login: user.username,
      name: user.name,
      connectedBy: accountId,
      alive: true,
      error: null,
      repositories: 0
    })
    const created = await client.findOne(gitlab.class.GitlabIntegration, { _id })
    if (created === undefined) {
      throw new Error('Failed to create GitLab integration')
    }
    return created
  }

  private async syncRepositories (
    client: TxOperations,
    host: string,
    integration: GitlabIntegration,
    token: string
  ): Promise<void> {
    await refreshIntegrationRepositories(client, new GitlabApi(host, token, this.deps.fetchFn), integration)
  }
}
