// SPDX-License-Identifier: EPL-2.0
import type { Ref } from '@hcengineering/core'
import type { GitlabIntegrationRepository } from '@hcengineering/gitlab'
import type { GitlabProjectInfo } from '../gitlab/types'
import { planRepositorySync, toRepositoryFields } from '../repositories'

function remote (id: number, patch: Partial<GitlabProjectInfo> = {}): GitlabProjectInfo {
  return {
    id,
    name: `p${id}`,
    path_with_namespace: `g/p${id}`,
    web_url: `https://gitlab.com/g/p${id}`,
    description: null,
    visibility: 'private',
    archived: false,
    default_branch: 'main',
    star_count: 0,
    forks_count: 0,
    last_activity_at: '2026-10-01T00:00:00Z',
    namespace: { id: 1, name: 'g', path: 'g', kind: 'group', full_path: 'g' },
    ...patch
  }
}

function existing (id: number, patch: Partial<GitlabIntegrationRepository> = {}): GitlabIntegrationRepository {
  return {
    _id: `r${id}` as Ref<GitlabIntegrationRepository>,
    ...toRepositoryFields(remote(id)),
    enabled: false,
    gitlabProject: null,
    hookId: null,
    deleted: false,
    ...patch
  } as unknown as GitlabIntegrationRepository
}

describe('toRepositoryFields', () => {
  it('defaults open issues to 0 when issues are disabled', () => {
    expect(toRepositoryFields(remote(1)).openIssuesCount).toBe(0)
    expect(toRepositoryFields(remote(1, { open_issues_count: 3 })).openIssuesCount).toBe(3)
  })

  it('parses last activity into a timestamp', () => {
    expect(toRepositoryFields(remote(1)).lastActivityAt).toBe(Date.parse('2026-10-01T00:00:00Z'))
  })
})

describe('planRepositorySync', () => {
  it('creates new projects', () => {
    const plan = planRepositorySync([], [remote(1)])
    expect(plan.create.map((r) => r.projectId)).toEqual([1])
    expect(plan.update).toEqual([])
    expect(plan.markDeleted).toEqual([])
  })

  it('updates only changed fields', () => {
    const plan = planRepositorySync([existing(1)], [remote(1, { name: 'renamed', path_with_namespace: 'g/renamed' })])
    expect(plan.update).toEqual([{ _id: 'r1', update: { name: 'renamed', pathWithNamespace: 'g/renamed' } }])
  })

  it('produces no work when nothing changed', () => {
    expect(planRepositorySync([existing(1)], [remote(1)])).toEqual({ create: [], update: [], markDeleted: [] })
  })

  it('marks missing projects deleted without touching links', () => {
    const linked = existing(1, { enabled: true, gitlabProject: 'prj' as any })
    const plan = planRepositorySync([linked], [])
    expect(plan.markDeleted).toEqual(['r1'])
    expect(plan.update).toEqual([])
  })

  it('does not re-mark already deleted projects', () => {
    expect(planRepositorySync([existing(1, { deleted: true })], []).markDeleted).toEqual([])
  })

  it('restores a project that re-appears', () => {
    const plan = planRepositorySync([existing(1, { deleted: true })], [remote(1)])
    expect(plan.update).toEqual([{ _id: 'r1', update: { deleted: false } }])
  })
})
