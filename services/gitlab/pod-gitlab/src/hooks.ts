// SPDX-License-Identifier: EPL-2.0

import type { Ref, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import type { GitlabIntegration, GitlabIntegrationRepository } from '@hcengineering/gitlab'
import { createHmac } from 'crypto'
import type { GitlabApi } from './gitlab/api'

/** The workspace and integration a project hook belongs to. */
export interface HookTarget {
  workspace: WorkspaceUuid
  integration: Ref<GitlabIntegration>
}

/** Prefix of the project hook URLs. */
export const WEBHOOK_PATH = '/api/webhook'

export function hookUrl (baseUrl: string, target: HookTarget): string {
  return `${baseUrl}${WEBHOOK_PATH}/${encodeURIComponent(target.workspace)}/${encodeURIComponent(target.integration)}`
}

/** Derived from WEBHOOK_SECRET, so nothing is stored; a leaked hook secret is good for one integration only. */
export function hookSecret (master: string, target: HookTarget): string {
  return createHmac('sha256', master).update(`gitlab-hook:v1:${target.workspace}:${target.integration}`).digest('hex')
}

/** The target named by a scoped hook URL's route parameters; undefined when one is missing. */
export function hookTargetOf (params: Record<string, string | undefined>): HookTarget | undefined {
  const { workspace, integration } = params
  if (workspace === undefined || workspace === '' || integration === undefined || integration === '') return undefined
  return { workspace: workspace as WorkspaceUuid, integration: integration as Ref<GitlabIntegration> }
}

/** Where hooks send events and the master secret their secrets derive from. */
export interface HookSettings {
  baseUrl: string
  master: string
}

/** Installs (or re-applies) the scoped project hook of a repository; its id is stored when it changed. */
export async function ensureRepositoryHook (
  client: Pick<TxOperations, 'update'>,
  api: Pick<GitlabApi, 'ensureProjectHook'>,
  repository: GitlabIntegrationRepository,
  settings: HookSettings,
  target: HookTarget
): Promise<number> {
  const hook = await api.ensureProjectHook(
    repository.projectId,
    hookUrl(settings.baseUrl, target),
    hookSecret(settings.master, target)
  )
  if (hook.id !== repository.hookId) await client.update(repository, { hookId: hook.id })
  return hook.id
}

/** Deletes a repository's project hook (already gone counts as deleted) and clears the stored id. */
export async function removeRepositoryHook (
  client: Pick<TxOperations, 'update'>,
  api: Pick<GitlabApi, 'deleteProjectHook'>,
  repository: GitlabIntegrationRepository
): Promise<void> {
  if (repository.hookId === null) return
  await api.deleteProjectHook(repository.projectId, repository.hookId)
  await client.update(repository, { hookId: null })
}
