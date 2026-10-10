// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test data */
import type { Ref, Space } from '@hcengineering/core'
import type { GitlabIntegrationRepository } from '@hcengineering/gitlab'
import { defaultRepository, issueLinkFor, linkedRepositories, shownRepository, validChoice } from '../repository-choice'

function repo (id: string, extra: Partial<GitlabIntegrationRepository> = {}): GitlabIntegrationRepository {
  return {
    _id: id,
    gitlabProject: 'prj-1',
    enabled: true,
    deleted: false,
    pathWithNamespace: `group/${id}`,
    ...extra
  } as unknown as GitlabIntegrationRepository
}

const r1 = repo('r1')
const r2 = repo('r2')
const project = 'prj-1' as Ref<Space>

describe('repository choice', () => {
  it('lists the enabled, present repositories of the project', () => {
    const all = [
      r1,
      repo('off', { enabled: false }),
      repo('gone', { deleted: true }),
      repo('other', { gitlabProject: 'prj-2' as any })
    ]
    expect(linkedRepositories(all, project).map((it) => it._id)).toEqual(['r1'])
    expect(linkedRepositories(all, undefined)).toEqual([])
  })

  it('defaults to the only linked repository, and to Huly only with two', () => {
    expect(defaultRepository([r1])).toBe(r1)
    expect(defaultRepository([r1, r2])).toBeUndefined()
    expect(shownRepository({}, [r1])).toBe(r1)
    expect(shownRepository({}, [r1, r2])).toBeNull()
  })

  it('shows the pick, or Huly only for an explicit opt-out', () => {
    expect(shownRepository({ repository: r2._id }, [r1, r2])).toBe(r2)
    expect(shownRepository({ repository: null }, [r1])).toBeNull()
  })

  it('drops a pick that belongs to another project', () => {
    expect(validChoice({ repository: r2._id }, [r1])).toEqual({})
    expect(validChoice({ repository: r1._id }, [r1])).toEqual({ repository: r1._id })
    expect(validChoice({ repository: null }, [r1])).toEqual({ repository: null })
  })

  it('turns a pick into GitlabIssue mixin data, and no pick into nothing', () => {
    expect(issueLinkFor({})).toBeUndefined()
    expect(issueLinkFor({ repository: r1._id })).toEqual({ repository: r1._id, url: '', gitlabIid: 0 })
    expect(issueLinkFor({ repository: null })).toEqual({ repository: null, url: '', gitlabIid: 0 })
  })
})
