// SPDX-License-Identifier: EPL-2.0

import type { Ref, RelatedDocument, Status } from '@hcengineering/core'
import type { Issue } from '@hcengineering/tracker'
import { getIssuePlanningConstraints, getIssueSlotDuration } from '../issue-planning'

const NOW = Date.UTC(2026, 9, 23, 12)
const HOUR = 60 * 60 * 1000
const DONE = 'done' as Ref<Status>
const CANCELED = 'canceled' as Ref<Status>
const RESOLVED = new Set([DONE, CANCELED])

function blocker (id: string, status: string): Issue {
  const issue: Partial<Issue> = {
    _id: id as Ref<Issue>,
    status: status as Issue['status'],
    identifier: `TEST-${id}`,
    title: `Blocker ${id}`
  }
  return issue as Issue
}

function relation (id: string): RelatedDocument {
  const document: RelatedDocument = {
    _id: id as RelatedDocument['_id'],
    _class: 'tracker:class:Issue' as RelatedDocument['_class']
  }
  return document
}

describe('issue slot duration', () => {
  it('converts positive remaining estimation from hours to milliseconds', () => {
    expect(getIssueSlotDuration({ estimation: 4, reportedTime: 1.5 })).toBe(2.5 * HOUR)
    expect(getIssueSlotDuration({ estimation: 0.25, reportedTime: 0 })).toBe(HOUR / 4)
  })

  it.each([
    undefined,
    { estimation: 0, reportedTime: 0 },
    { estimation: 0, reportedTime: 2 },
    { estimation: 2, reportedTime: 2 },
    { estimation: 2, reportedTime: 3 },
    { estimation: NaN, reportedTime: 0 },
    { estimation: Infinity, reportedTime: 0 },
    { estimation: 2, reportedTime: NaN }
  ])('preserves the existing default for missing or non-positive remaining time: %p', (issue) => {
    expect(getIssueSlotDuration(issue)).toBe(HOUR / 2)
    expect(getIssueSlotDuration(issue, HOUR)).toBe(HOUR)
  })

  it('caps the default slot at one working day', () => {
    expect(getIssueSlotDuration({ estimation: 8, reportedTime: 0 })).toBe(8 * HOUR)
    expect(getIssueSlotDuration({ estimation: 40, reportedTime: 1 })).toBe(8 * HOUR)
  })

  it('tolerates legacy issue data without reported time', () => {
    const issue: Partial<Issue> = { estimation: 2 }
    expect(getIssueSlotDuration(issue as Issue)).toBe(2 * HOUR)
  })
})

describe('issue planning constraints', () => {
  it('leaves standalone ToDos and legacy issues unrestricted', () => {
    const issue: Partial<Issue> = {}
    expect(getIssuePlanningConstraints(undefined, [], RESOLVED, NOW)).toEqual({ blockers: [], startDate: undefined })
    expect(getIssuePlanningConstraints(issue as Issue, [], RESOLVED, NOW)).toEqual({
      blockers: [],
      startDate: undefined
    })
  })

  it('lists only related unresolved blockers in relation order', () => {
    const issue = { blockedBy: [relation('1'), relation('2'), relation('3')], startDate: null }
    const blockers = [blocker('3', 'active'), blocker('2', 'done'), blocker('1', 'todo'), blocker('4', 'active')]
    expect(getIssuePlanningConstraints(issue, blockers, RESOLVED, NOW)).toEqual({
      blockers: ['TEST-1: Blocker 1', 'TEST-3: Blocker 3'],
      startDate: undefined
    })
  })

  it('clears blockers when their status becomes completed or canceled and restores reopened blockers', () => {
    const issue = { blockedBy: [relation('1')], startDate: null }
    for (const status of ['done', 'canceled']) {
      expect(getIssuePlanningConstraints(issue, [blocker('1', status)], RESOLVED, NOW).blockers).toEqual([])
    }
    expect(getIssuePlanningConstraints(issue, [blocker('1', 'active')], RESOLVED, NOW).blockers).toHaveLength(1)
  })

  it('keeps unknown statuses unresolved and skips blocker references that are not loaded', () => {
    const issue = { blockedBy: [relation('1'), relation('2')], startDate: null }
    expect(getIssuePlanningConstraints(issue, [blocker('1', 'unknown')], RESOLVED, NOW).blockers).toEqual([
      'TEST-1: Blocker 1'
    ])
    expect(getIssuePlanningConstraints(issue, [], RESOLVED, NOW).blockers).toEqual([])
  })

  it.each([null, NOW - 1, NOW])('does not flag a missing, past, or current start date: %p', (startDate) => {
    expect(getIssuePlanningConstraints({ startDate }, [], RESOLVED, NOW).startDate).toBeUndefined()
  })

  it('reports future start dates alongside blockers and clears the date when it arrives', () => {
    const issue = { blockedBy: [relation('1')], startDate: NOW + HOUR }
    const blockers = [blocker('1', 'active')]
    expect(getIssuePlanningConstraints(issue, blockers, RESOLVED, NOW)).toEqual({
      blockers: ['TEST-1: Blocker 1'],
      startDate: NOW + HOUR
    })
    expect(getIssuePlanningConstraints(issue, blockers, RESOLVED, NOW + HOUR).startDate).toBeUndefined()
  })
})
