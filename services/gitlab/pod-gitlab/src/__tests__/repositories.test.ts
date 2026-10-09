// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import type { Ref } from '@hcengineering/core'
import gitlab, { type GitlabIntegrationRepository } from '@hcengineering/gitlab'
import tracker from '@hcengineering/tracker'
import { GitlabApiError } from '../gitlab/api'
import type { GitlabProjectInfo } from '../gitlab/types'
import { confirmMissing, planRepositorySync, refreshIntegrationRepositories, rewriteRepositoryUrls, toRepositoryFields, urlChanges } from '../repositories'
import { asTxOperations, createMemoryClient } from './helpers/memory'

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

describe('confirmMissing', () => {
  const linked = (id: number, patch: Partial<GitlabIntegrationRepository> = {}): GitlabIntegrationRepository =>
    existing(id, { enabled: true, gitlabProject: 'prj' as any, hookId: 3, ...patch })

  it('keeps a renamed or transferred project linked and takes its new fields', async () => {
    const current = [linked(1)]
    const moved = remote(1, { path_with_namespace: 'other/p1', web_url: 'https://gitlab.com/other/p1' })
    const api = { getProject: jest.fn(async () => moved) }
    const plan = await confirmMissing(api, current, [], planRepositorySync(current, []))
    expect(api.getProject).toHaveBeenCalledWith(1)
    expect(plan.markDeleted).toEqual([])
    expect(plan.update).toEqual([{ _id: 'r1', update: { pathWithNamespace: 'other/p1', webUrl: 'https://gitlab.com/other/p1' } }])
  })

  it('marks a linked project deleted when GitLab answers 404 or 403', async () => {
    const current = [linked(1), linked(2)]
    const api = {
      getProject: jest.fn(async (id: number) => {
        throw new GitlabApiError(id === 1 ? 404 : 403, 'gone')
      })
    }
    const plan = await confirmMissing(api, current, [], planRepositorySync(current, []))
    expect(plan.markDeleted).toEqual(['r1', 'r2'])
  })

  it('does not look up unlinked projects', async () => {
    const current = [existing(1)]
    const api = { getProject: jest.fn() }
    const plan = await confirmMissing(api, current, [], planRepositorySync(current, []))
    expect(api.getProject).not.toHaveBeenCalled()
    expect(plan.markDeleted).toEqual(['r1'])
  })

  it('brings back a linked project marked deleted that is readable again', async () => {
    const current = [linked(1, { deleted: true })]
    const api = { getProject: jest.fn(async () => remote(1, { web_url: 'https://gitlab.com/other/p1' })) }
    const plan = await confirmMissing(api, current, [], planRepositorySync(current, []))
    expect(plan.update).toEqual([{ _id: 'r1', update: { webUrl: 'https://gitlab.com/other/p1', deleted: false } }])
  })

  it('lets other GitLab errors through', async () => {
    const current = [linked(1)]
    const api = { getProject: jest.fn(async () => { throw new GitlabApiError(500, 'boom') }) }
    await expect(confirmMissing(api, current, [], planRepositorySync(current, []))).rejects.toThrow('boom')
  })
})

describe('urlChanges and rewriteRepositoryUrls', () => {
  it('lists repositories whose web URL changed', () => {
    const current = [existing(1), existing(2)]
    const plan = planRepositorySync(current, [remote(1, { web_url: 'https://gitlab.com/other/p1' }), remote(2, { name: 'renamed' })])
    expect(urlChanges(current, plan)).toEqual([{ repository: 'r1', from: 'https://gitlab.com/g/p1', to: 'https://gitlab.com/other/p1' }])
  })

  it('rewrites the links of a moved project\'s issues and merge requests, and nothing else', async () => {
    const memory = createMemoryClient()
    memory.docs.push(
      { _id: 'i1', _class: tracker.class.Issue, space: 'prj', [gitlab.mixin.GitlabIssue]: { url: 'https://gitlab.com/g/p1/-/issues/4', gitlabIid: 4, repository: 'r1' } },
      { _id: 'i2', _class: tracker.class.Issue, space: 'prj', [gitlab.mixin.GitlabIssue]: { url: 'https://gitlab.com/g/p12/-/issues/1', gitlabIid: 1, repository: 'r1' } },
      { _id: 'i3', _class: tracker.class.Issue, space: 'prj', [gitlab.mixin.GitlabIssue]: { url: 'https://gitlab.com/g/p1/-/issues/9', gitlabIid: 9, repository: 'r2' } },
      { _id: 'm1', _class: gitlab.class.GitlabMergeRequest, space: 'prj', url: 'https://gitlab.com/g/p1/-/merge_requests/3', repository: 'r1' }
    )
    const count = await rewriteRepositoryUrls(asTxOperations(memory), {
      repository: 'r1' as Ref<GitlabIntegrationRepository>,
      from: 'https://gitlab.com/g/p1',
      to: 'https://gitlab.com/other/p1'
    })
    expect(count).toBe(2)
    expect(memory.docs[0][gitlab.mixin.GitlabIssue].url).toBe('https://gitlab.com/other/p1/-/issues/4')
    // Another project whose path starts with the same text, and another repository: unchanged
    expect(memory.docs[1][gitlab.mixin.GitlabIssue].url).toBe('https://gitlab.com/g/p12/-/issues/1')
    expect(memory.docs[2][gitlab.mixin.GitlabIssue].url).toBe('https://gitlab.com/g/p1/-/issues/9')
    expect(memory.docs[3].url).toBe('https://gitlab.com/other/p1/-/merge_requests/3')
  })
})

describe('refreshIntegrationRepositories', () => {
  it('creates each new project once when two refreshes of one integration overlap', async () => {
    const memory = createMemoryClient()
    const integration: any = { _id: 'int-1', _class: gitlab.class.GitlabIntegration, space: 'core:space:Configuration' }
    memory.docs.push(integration)
    const api = { listMaintainedProjects: async () => [remote(1), remote(2)], getProject: jest.fn() }
    const client = asTxOperations(memory)
    await Promise.all([refreshIntegrationRepositories(client, api, integration), refreshIntegrationRepositories(client, api, integration)])
    expect(memory.docs.filter((d) => d._class === gitlab.class.GitlabIntegrationRepository).map((d) => d.projectId).sort()).toEqual([1, 2])
  })
})
