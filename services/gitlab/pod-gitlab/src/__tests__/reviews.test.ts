// SPDX-License-Identifier: EPL-2.0
import {
  effectiveReviewStates,
  reviewEvents,
  reviewRecord,
  type ReviewRecord,
  type UserReviewState
} from '../sync/reviews'
import { gitlabUser } from './helpers/fixtures'

const states = (entries: Array<[number, UserReviewState['state']]>): Map<number, UserReviewState> =>
  new Map(entries.map(([id, state]) => [id, { user: gitlabUser(id), state }]))

describe('effectiveReviewStates', () => {
  it('takes reviewer states and marks approvers approved, reviewers or not', () => {
    const result = effectiveReviewStates({
      reviewers: [
        { user: gitlabUser(7), state: 'unreviewed' },
        { user: gitlabUser(8), state: 'requested_changes' }
      ],
      approvals: {
        approved_by: [{ user: gitlabUser(7), approved_at: '2026-01-01T12:00:00.000Z' }, { user: gitlabUser(9) }]
      }
    })
    expect([...result.entries()].map(([id, it]) => [id, it.state, it.at])).toEqual([
      [7, 'approved', '2026-01-01T12:00:00.000Z'],
      [8, 'requested_changes', undefined],
      [9, 'approved', undefined]
    ])
  })
})

describe('reviewEvents', () => {
  it('reports approvals, requested changes and finished reviews on first import, not pending states', () => {
    const events = reviewEvents(
      undefined,
      states([
        [7, 'approved'],
        [8, 'requested_changes'],
        [9, 'reviewed'],
        [10, 'unreviewed'],
        [11, 'unapproved']
      ])
    )
    expect(events.map((it) => [it.user.id, it.state])).toEqual([
      [7, 'approved'],
      [8, 'requested_changes'],
      [9, 'reviewed']
    ])
  })

  it('reports only what changed since the record', () => {
    const previous = reviewRecord(
      states([
        [7, 'approved'],
        [8, 'review_started']
      ])
    )
    const events = reviewEvents(
      previous,
      states([
        [7, 'approved'],
        [8, 'reviewed']
      ])
    )
    expect(events.map((it) => [it.user.id, it.state])).toEqual([[8, 'reviewed']])
  })

  it('reports a revoked approval, also of an approver who is no reviewer', () => {
    const previous: ReviewRecord = reviewRecord(
      states([
        [7, 'approved'],
        [9, 'approved']
      ])
    )
    const events = reviewEvents(previous, states([[7, 'unreviewed']]))
    expect(events.map((it) => [it.user.id, it.state])).toEqual([
      [7, 'unapproved'],
      [9, 'unapproved']
    ])
  })

  it('keeps users and states, without approval times, in the record', () => {
    const current = new Map([[7, { user: gitlabUser(7), state: 'approved' as const, at: '2026-01-01T12:00:00.000Z' }]])
    expect(reviewRecord(current)).toEqual({ 7: { user: gitlabUser(7), state: 'approved' } })
  })
})
