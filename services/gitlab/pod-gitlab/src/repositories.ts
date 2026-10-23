// SPDX-License-Identifier: EPL-2.0

import type { Hyperlink, Ref, TxOperations } from '@hcengineering/core'
import gitlab, {
  type GitlabIntegration,
  type GitlabIntegrationRepository,
  type GitlabIssue
} from '@hcengineering/gitlab'
import type { Issue } from '@hcengineering/tracker'
import { type GitlabApi, GitlabApiError } from './gitlab/api'
import type { GitlabProjectInfo } from './gitlab/types'

export type RepositoryFields = Pick<
  GitlabIntegrationRepository,
  | 'projectId'
  | 'name'
  | 'pathWithNamespace'
  | 'webUrl'
  | 'description'
  | 'visibility'
  | 'archived'
  | 'defaultBranch'
  | 'starCount'
  | 'forksCount'
  | 'openIssuesCount'
  | 'lastActivityAt'
>

export interface RepositoryPlan {
  create: RepositoryFields[]
  update: Array<{ _id: Ref<GitlabIntegrationRepository>, update: Partial<RepositoryFields> & { deleted?: boolean } }>
  markDeleted: Array<Ref<GitlabIntegrationRepository>>
}

export function toRepositoryFields (p: GitlabProjectInfo): RepositoryFields {
  return {
    projectId: p.id,
    name: p.name,
    pathWithNamespace: p.path_with_namespace,
    webUrl: p.web_url,
    description: p.description,
    visibility: p.visibility,
    archived: p.archived,
    defaultBranch: p.default_branch,
    starCount: p.star_count,
    forksCount: p.forks_count,
    openIssuesCount: p.open_issues_count ?? 0,
    lastActivityAt: Date.parse(p.last_activity_at)
  }
}

function changedFields (current: GitlabIntegrationRepository, fields: RepositoryFields): Partial<RepositoryFields> {
  const update: Partial<RepositoryFields> = {}
  for (const key of Object.keys(fields) as Array<keyof RepositoryFields>) {
    if (current[key] !== fields[key]) {
      ;(update as Record<string, unknown>)[key] = fields[key]
    }
  }
  return update
}

export function planRepositorySync (
  existing: GitlabIntegrationRepository[],
  remote: GitlabProjectInfo[]
): RepositoryPlan {
  const plan: RepositoryPlan = { create: [], update: [], markDeleted: [] }
  const byProjectId = new Map(existing.map((it) => [it.projectId, it]))
  const seen = new Set<number>()

  for (const project of remote) {
    seen.add(project.id)
    const fields = toRepositoryFields(project)
    const current = byProjectId.get(project.id)
    if (current === undefined) {
      plan.create.push(fields)
      continue
    }
    const update: Partial<RepositoryFields> & { deleted?: boolean } = changedFields(current, fields)
    if (current.deleted) {
      update.deleted = false
    }
    if (Object.keys(update).length > 0) {
      plan.update.push({ _id: current._id, update })
    }
  }

  for (const current of existing) {
    // Keep the document and its project link: access may come back.
    if (!seen.has(current.projectId) && !current.deleted) {
      plan.markDeleted.push(current._id)
    }
  }
  return plan
}

async function applyRepositoryPlan (
  client: TxOperations,
  integration: GitlabIntegration,
  existing: GitlabIntegrationRepository[],
  plan: RepositoryPlan
): Promise<void> {
  const byId = new Map(existing.map((it) => [it._id, it]))
  for (const fields of plan.create) {
    await client.addCollection(
      gitlab.class.GitlabIntegrationRepository,
      integration.space,
      integration._id,
      gitlab.class.GitlabIntegration,
      'repositories',
      { ...fields, enabled: false, gitlabProject: null, hookId: null, deleted: false }
    )
  }
  for (const { _id, update } of plan.update) {
    const doc = byId.get(_id)
    if (doc !== undefined) {
      await client.update(doc, update)
    }
  }
  for (const _id of plan.markDeleted) {
    const doc = byId.get(_id)
    if (doc !== undefined) {
      await client.update(doc, { deleted: true })
    }
  }
}

export interface RepositoryUrlChange {
  repository: Ref<GitlabIntegrationRepository>
  from: string
  to: string
}

/**
 * Linked repositories that the maintained-projects listing no longer returns are looked up by their stable id.
 * Renamed, transferred, or with access below Maintainer, they stay linked and take the new fields. Gone or
 * unreadable (403, 404), they are marked deleted. Linked repositories marked deleted earlier come back when readable.
 */
export async function confirmMissing (
  api: Pick<GitlabApi, 'getProject'>,
  existing: GitlabIntegrationRepository[],
  remote: GitlabProjectInfo[],
  plan: RepositoryPlan
): Promise<RepositoryPlan> {
  const listed = new Set(remote.map((it) => it.id))
  const update = [...plan.update]
  const markDeleted: Array<Ref<GitlabIntegrationRepository>> = []
  const lookups = existing.filter(
    (it) => !listed.has(it.projectId) && it.gitlabProject !== null && (plan.markDeleted.includes(it._id) || it.deleted)
  )
  for (const id of plan.markDeleted) {
    if (!lookups.some((it) => it._id === id)) markDeleted.push(id)
  }
  for (const current of lookups) {
    let project: GitlabProjectInfo
    try {
      project = await api.getProject(current.projectId)
    } catch (err: unknown) {
      if (err instanceof GitlabApiError && (err.status === 403 || err.status === 404)) {
        if (!current.deleted) markDeleted.push(current._id)
        continue
      }
      throw err
    }
    const changed: Partial<RepositoryFields> & { deleted?: boolean } = changedFields(
      current,
      toRepositoryFields(project)
    )
    if (current.deleted) changed.deleted = false
    if (Object.keys(changed).length > 0) update.push({ _id: current._id, update: changed })
  }
  return { create: plan.create, update, markDeleted }
}

export function urlChanges (existing: GitlabIntegrationRepository[], plan: RepositoryPlan): RepositoryUrlChange[] {
  const changes: RepositoryUrlChange[] = []
  for (const { _id, update } of plan.update) {
    const current = existing.find((it) => it._id === _id)
    if (current !== undefined && update.webUrl !== undefined && update.webUrl !== current.webUrl) {
      changes.push({ repository: _id, from: current.webUrl, to: update.webUrl })
    }
  }
  return changes
}

/** Points the links of a renamed or transferred project's issues and merge requests at its new URL. */
export async function rewriteRepositoryUrls (client: TxOperations, change: RepositoryUrlChange): Promise<number> {
  const rewrite = (url: string | undefined): Hyperlink | undefined =>
    url !== undefined && url.startsWith(`${change.from}/`) ? `${change.to}${url.slice(change.from.length)}` : undefined
  let count = 0
  for (const issue of await client.findAll(gitlab.mixin.GitlabIssue, { repository: change.repository })) {
    const url = rewrite(issue.url)
    if (url === undefined) continue
    await client.updateMixin<Issue, GitlabIssue>(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, {
      url
    })
    count++
  }
  for (const mr of await client.findAll(gitlab.class.GitlabMergeRequest, { repository: change.repository })) {
    const url = rewrite(mr.url)
    if (url === undefined) continue
    await client.update(mr, { url })
    count++
  }
  return count
}

// One refresh per integration at a time in this pod: the HTTP service (authorize, refresh) and the worker's health
// job share this module, and two overlapping refreshes would each create the same new repositories
const refreshing = new Map<string, Promise<unknown>>()

/** Refreshes one integration's repositories from GitLab and rewrites the links of moved projects. */
export async function refreshIntegrationRepositories (
  client: TxOperations,
  api: Pick<GitlabApi, 'listMaintainedProjects' | 'getProject'>,
  integration: GitlabIntegration
): Promise<RepositoryUrlChange[]> {
  const previous = refreshing.get(integration._id) ?? Promise.resolve()
  const run = previous.then(
    async () => await refreshNow(client, api, integration),
    async () => await refreshNow(client, api, integration)
  )
  const tail = run.catch(() => {})
  refreshing.set(integration._id, tail)
  void tail.then(() => {
    if (refreshing.get(integration._id) === tail) refreshing.delete(integration._id)
  })
  return await run
}

async function refreshNow (
  client: TxOperations,
  api: Pick<GitlabApi, 'listMaintainedProjects' | 'getProject'>,
  integration: GitlabIntegration
): Promise<RepositoryUrlChange[]> {
  const remote = await api.listMaintainedProjects()
  const existing = await client.findAll(gitlab.class.GitlabIntegrationRepository, { attachedTo: integration._id })
  const plan = await confirmMissing(api, existing, remote, planRepositorySync(existing, remote))
  await applyRepositoryPlan(client, integration, existing, plan)
  const changes = urlChanges(existing, plan)
  for (const change of changes) {
    await rewriteRepositoryUrls(client, change)
  }
  return changes
}
