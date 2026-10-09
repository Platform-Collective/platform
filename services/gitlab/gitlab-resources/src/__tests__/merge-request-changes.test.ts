// SPDX-License-Identifier: EPL-2.0
import { changesUrl, isTooLargeForHuly, showDiffInHuly } from '../merge-request-changes'

describe('changesUrl', () => {
  it('points at the merge request changes page', () => {
    expect(changesUrl('https://gitlab.example.com/group/repo/-/merge_requests/3')).toBe(
      'https://gitlab.example.com/group/repo/-/merge_requests/3/diffs'
    )
  })

  it('drops a trailing slash, query and fragment', () => {
    expect(changesUrl('https://gitlab.example.com/g/r/-/merge_requests/3/?tab=overview#note_1')).toBe(
      'https://gitlab.example.com/g/r/-/merge_requests/3/diffs'
    )
  })

  it('refuses anything that is not http(s)', () => {
    expect(changesUrl('javascript:alert(1)')).toBeUndefined()
    expect(changesUrl('')).toBeUndefined()
    expect(changesUrl('HTTP://gitlab.local/g/r/-/merge_requests/1')).toBe(
      'HTTP://gitlab.local/g/r/-/merge_requests/1/diffs'
    )
  })
})

describe('showDiffInHuly', () => {
  it('needs a stored diff', () => {
    expect(showDiffInHuly({ files: 1, additions: 1, deletions: 1 }, false)).toBe(false)
  })

  it('shows up to 50 files and 2,000 changed lines', () => {
    expect(showDiffInHuly({ files: 50, additions: 1500, deletions: 500 }, true)).toBe(true)
    expect(showDiffInHuly({ files: 51, additions: 1, deletions: 1 }, true)).toBe(false)
    expect(showDiffInHuly({ files: 50, additions: 1500, deletions: 501 }, true)).toBe(false)
  })
})

describe('isTooLargeForHuly', () => {
  it('is about the counts only, not whether a diff is stored', () => {
    expect(isTooLargeForHuly({ files: 3, additions: 10, deletions: 2 })).toBe(false)
    expect(isTooLargeForHuly({ files: 51, additions: 0, deletions: 0 })).toBe(true)
    expect(isTooLargeForHuly({ files: 2, additions: 2001, deletions: 0 })).toBe(true)
  })
})
