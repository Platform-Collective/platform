// SPDX-License-Identifier: EPL-2.0
import { mergeStatusKey } from '../merge-status'

describe('mergeStatusKey', () => {
  it('reports a conflict whatever the detailed status says', () => {
    expect(mergeStatusKey('mergeable', true)).toBe('Conflict')
    expect(mergeStatusKey('conflict', false)).toBe('Conflict')
    expect(mergeStatusKey('need_rebase', false)).toBe('Conflict')
  })

  it('maps the GitLab detailed merge statuses', () => {
    expect(mergeStatusKey('mergeable', false)).toBe('ReadyToMerge')
    expect(mergeStatusKey('checking', false)).toBe('Checking')
    expect(mergeStatusKey('unchecked', false)).toBe('Checking')
    expect(mergeStatusKey('ci_must_pass', false)).toBe('PipelinePending')
    expect(mergeStatusKey('ci_still_running', false)).toBe('PipelinePending')
    expect(mergeStatusKey('discussions_not_resolved', false)).toBe('UnresolvedDiscussions')
    expect(mergeStatusKey('not_approved', false)).toBe('NeedsApproval')
    expect(mergeStatusKey('draft_status', false)).toBe('Draft')
  })

  it('shows nothing for statuses it does not know', () => {
    expect(mergeStatusKey('not_open', false)).toBeUndefined()
    expect(mergeStatusKey('', false)).toBeUndefined()
  })
})
