// SPDX-License-Identifier: EPL-2.0
import { issueHeaderState } from '../issue-header'

const base = { linkedRepositories: 1, readonly: false }

describe('issueHeaderState', () => {
  it('shows a merge request link with its error', () => {
    expect(issueHeaderState({ ...base, mergeRequest: { syncError: 'boom' } })).toEqual({ kind: 'mergeRequest', error: 'boom' })
  })

  it('shows a linked issue, with a push error if any', () => {
    expect(issueHeaderState({ ...base, link: { gitlabIid: 4, repository: 'r', syncError: null } })).toEqual({ kind: 'linked', error: null })
    expect(issueHeaderState({ ...base, link: { gitlabIid: 4, repository: 'r', syncError: '403' } })).toEqual({ kind: 'linked', error: '403' })
  })

  it('shows "being created" until GitLab refuses, then the error instead', () => {
    expect(issueHeaderState({ ...base, link: { gitlabIid: 0, repository: 'r' } })).toEqual({ kind: 'creating', error: null })
    expect(issueHeaderState({ ...base, link: { gitlabIid: 0, repository: 'r', syncError: '403 Forbidden' } })).toEqual({
      kind: 'failed',
      error: '403 Forbidden'
    })
  })

  it('offers the picker for an issue without a pick, with the error of a failed default creation', () => {
    expect(issueHeaderState({ ...base })).toEqual({ kind: 'pick', error: null })
    expect(issueHeaderState({ ...base, link: { syncError: '422' } })).toEqual({ kind: 'pick', error: '422' })
    expect(issueHeaderState({ ...base, link: { repository: null, gitlabIid: 0 } })).toEqual({ kind: 'pick', error: null })
  })

  it('shows nothing without linked repositories or in a read-only view', () => {
    expect(issueHeaderState({ linkedRepositories: 0, readonly: false })).toEqual({ kind: 'none', error: null })
    expect(issueHeaderState({ linkedRepositories: 1, readonly: true })).toEqual({ kind: 'none', error: null })
  })
})
