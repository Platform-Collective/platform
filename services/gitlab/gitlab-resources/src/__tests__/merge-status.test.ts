// SPDX-License-Identifier: EPL-2.0
import gitlab from '../plugin'
import { mergeStatusLabel } from '../merge-status'

describe('mergeStatusLabel', () => {
  it('reports a conflict whatever the detailed status says', () => {
    expect(mergeStatusLabel('mergeable', true)).toBe(gitlab.string.Conflict)
    expect(mergeStatusLabel('conflict', false)).toBe(gitlab.string.Conflict)
    expect(mergeStatusLabel('need_rebase', false)).toBe(gitlab.string.Conflict)
  })

  it('maps the GitLab detailed merge statuses', () => {
    expect(mergeStatusLabel('mergeable', false)).toBe(gitlab.string.ReadyToMerge)
    expect(mergeStatusLabel('checking', false)).toBe(gitlab.string.Checking)
    expect(mergeStatusLabel('unchecked', false)).toBe(gitlab.string.Checking)
    expect(mergeStatusLabel('ci_must_pass', false)).toBe(gitlab.string.PipelinePending)
    expect(mergeStatusLabel('ci_still_running', false)).toBe(gitlab.string.PipelinePending)
    expect(mergeStatusLabel('discussions_not_resolved', false)).toBe(gitlab.string.UnresolvedDiscussions)
    expect(mergeStatusLabel('not_approved', false)).toBe(gitlab.string.NeedsApproval)
    expect(mergeStatusLabel('draft_status', false)).toBe(gitlab.string.Draft)
  })

  it('shows nothing for statuses it does not know', () => {
    expect(mergeStatusLabel('not_open', false)).toBeUndefined()
    expect(mergeStatusLabel('', false)).toBeUndefined()
  })
})
