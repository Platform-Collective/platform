// SPDX-License-Identifier: EPL-2.0
import {
  belongsToHost,
  discussionIdOf,
  discussionKey,
  gitlabSocialValue,
  hostKey,
  issueKey,
  mergeRequestKey,
  noteKey,
  objectKey,
  parseGitlabSocialValue,
  reviewKey
} from '../sync/keys'

describe('keys', () => {
  it('normalises hosts with sub-paths, schemes and case', () => {
    expect(hostKey('https://GitLab.com')).toBe('gitlab.com')
    expect(hostKey('http://git.corp.local/gitlab/')).toBe('git.corp.local/gitlab')
  })

  it('builds stable issue and note keys', () => {
    const issue = issueKey('https://git.corp.local/gitlab', 42, 7)
    expect(issue).toBe('git.corp.local/gitlab/projects/42/issues/7')
    expect(noteKey(issue, 99)).toBe('git.corp.local/gitlab/projects/42/issues/7/notes/99')
  })

  it('scopes social id values to the host and parses them back', () => {
    const value = gitlabSocialValue('https://gitlab.com', 42)
    expect(value).toBe('42@gitlab.com')
    expect(parseGitlabSocialValue(value)).toEqual({ userId: 42, host: 'gitlab.com' })
    expect(parseGitlabSocialValue('7@git.corp.local/gitlab')).toEqual({ userId: 7, host: 'git.corp.local/gitlab' })
    expect(parseGitlabSocialValue('alice')).toBeUndefined()
    expect(parseGitlabSocialValue('x@gitlab.com')).toBeUndefined()
  })

  it('matches project web URLs to their host, sub-path aware', () => {
    expect(belongsToHost('https://gitlab.com/group/proj', 'https://gitlab.com')).toBe(true)
    expect(belongsToHost('https://git.corp.local/gitlab/g/p', 'https://git.corp.local/gitlab')).toBe(true)
    expect(belongsToHost('https://git.corp.local/other/g/p', 'https://git.corp.local/gitlab')).toBe(false)
    expect(belongsToHost('https://gitlab.company.com/g/p', 'https://gitlab.com')).toBe(false)
  })

  it('builds merge request keys next to issue keys', () => {
    expect(mergeRequestKey('https://gitlab.com', 42, 3)).toBe('gitlab.com/projects/42/merge_requests/3')
    expect(objectKey('https://gitlab.com', 42, 'issues', 3)).toBe(issueKey('https://gitlab.com', 42, 3))
    expect(noteKey(mergeRequestKey('https://gitlab.com', 42, 3), 9)).toBe(
      'gitlab.com/projects/42/merge_requests/3/notes/9'
    )
  })
})

describe('review keys', () => {
  const mr = 'gitlab.example.com/projects/42/merge_requests/3'

  it('puts discussions and review messages under their merge request', () => {
    expect(discussionKey(mr, 'abc123')).toBe(`${mr}/discussions/abc123`)
    expect(reviewKey(mr, 7, 1000)).toBe(`${mr}/reviews/7/1000`)
  })

  it('reads the discussion id back from a discussion key', () => {
    expect(discussionIdOf(discussionKey(mr, 'abc123'))).toBe('abc123')
  })
})
