// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Unit tests for the pure regression-guard helper.

import type { Ref } from '@hcengineering/core'
import type { IssueStatus } from '@hcengineering/tracker'
import type { WorkflowRule } from '@hcengineering/workflow-rules'

import { isRegression } from '../logic'

const s = {
  backlog: 'status:backlog' as Ref<IssueStatus>,
  inProgress: 'status:in-progress' as Ref<IssueStatus>,
  review: 'status:review' as Ref<IssueStatus>,
  done: 'status:done' as Ref<IssueStatus>
}

describe('isRegression', () => {
  const rank = [s.backlog, s.inProgress, s.review, s.done]

  it('allows forward moves', () => {
    expect(isRegression(s.backlog, s.review, rank, [])).toBe(false)
    expect(isRegression(s.inProgress, s.done, rank, [])).toBe(false)
  })

  it('blocks backward moves without an allow-list entry', () => {
    expect(isRegression(s.done, s.inProgress, rank, [])).toBe(true)
    expect(isRegression(s.review, s.backlog, rank, [])).toBe(true)
  })

  it('allows backward moves that match an allowedLoops entry', () => {
    const allowedLoops: WorkflowRule['allowedLoops'] = [{ from: s.review, to: s.inProgress }]
    expect(isRegression(s.review, s.inProgress, rank, allowedLoops)).toBe(false)
  })

  it('is strict about the direction of the allow-list entry', () => {
    const allowedLoops: WorkflowRule['allowedLoops'] = [{ from: s.review, to: s.inProgress }]
    expect(isRegression(s.done, s.review, rank, allowedLoops)).toBe(true)
  })

  it('is a same-rank no-op, not a regression', () => {
    expect(isRegression(s.review, s.review, rank, [])).toBe(false)
  })

  it('fails closed when a status is unknown', () => {
    // Rank table missing one of the statuses: the trigger validates
    // TaskType membership upstream and must not reach the helper with an
    // unknown status, but if it does the helper refuses to apply the
    // write rather than silently letting it through.
    const unknown = 'status:unknown' as Ref<IssueStatus>
    expect(isRegression(unknown, s.review, rank, [])).toBe(true)
    expect(isRegression(s.review, unknown, rank, [])).toBe(true)
  })
})
