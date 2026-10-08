// SPDX-License-Identifier: EPL-2.0

import type { Ref, TxOperations } from '@hcengineering/core'
import gitlab, { type GitlabIntegration, type GitlabIntegrationRepository } from '@hcengineering/gitlab'
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
    const update: Partial<RepositoryFields> & { deleted?: boolean } = {}
    for (const key of Object.keys(fields) as Array<keyof RepositoryFields>) {
      if (current[key] !== fields[key]) {
        ;(update as Record<string, unknown>)[key] = fields[key]
      }
    }
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

export async function applyRepositoryPlan (
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
