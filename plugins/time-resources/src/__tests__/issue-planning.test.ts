// SPDX-License-Identifier: EPL-2.0

import type { Ref, RelatedDocument, Status } from '@hcengineering/core'
import type { ToDo } from '@hcengineering/time'
import type { Issue } from '@hcengineering/tracker'
import {
  getBlockerIds,
  getPlanningIssueIds,
  getIssuePlanningConstraints,
  getIssueSlotDuration,
  getToDoPlanningConstraints
} from '../issue-planning'

const NOW = Date.UTC(2026, 9, 23, 12)
const HOUR = 60 * 60 * 1000
const MORNING = new Date(2026, 9, 23, 9).getTime()
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

function byId (issues: Issue[]): Map<Ref<Issue>, Issue> {
  return new Map(issues.map((issue) => [issue._id, issue]))
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
    expect(getIssueSlotDuration({ estimation: 4, reportedTime: 1.5 }, MORNING)).toBe(2.5 * HOUR)
    expect(getIssueSlotDuration({ estimation: 0.25, reportedTime: 0 }, MORNING)).toBe(HOUR / 4)
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
    expect(getIssueSlotDuration(issue, MORNING)).toBe(HOUR / 2)
    expect(getIssueSlotDuration(issue, MORNING, HOUR)).toBe(HOUR)
  })

  it('caps the default slot at one working day', () => {
    expect(getIssueSlotDuration({ estimation: 8, reportedTime: 0 }, MORNING)).toBe(8 * HOUR)
    expect(getIssueSlotDuration({ estimation: 40, reportedTime: 1 }, MORNING)).toBe(8 * HOUR)
  })

  it('caps positive estimates at midnight of the start day', () => {
    const evening = new Date(2026, 9, 23, 18).getTime()
    const midnight = new Date(2026, 9, 24).getTime()
    expect(evening + getIssueSlotDuration({ estimation: 8, reportedTime: 0 }, evening)).toBe(midnight)
    const late = new Date(2026, 9, 23, 23, 30).getTime()
    expect(getIssueSlotDuration({ estimation: 2, reportedTime: 0 }, late)).toBe(HOUR / 2)
    const startOfDay = new Date(2026, 9, 23).getTime()
    expect(getIssueSlotDuration({ estimation: 4, reportedTime: 0 }, startOfDay)).toBe(4 * HOUR)
  })

  it('tolerates legacy issue data without reported time', () => {
    const issue: Partial<Issue> = { estimation: 2 }
    expect(getIssueSlotDuration(issue as Issue, MORNING)).toBe(2 * HOUR)
  })
})

describe('issue planning constraints', () => {
  it('leaves standalone ToDos and legacy issues unrestricted', () => {
    const issue: Partial<Issue> = {}
    expect(getIssuePlanningConstraints(undefined, new Map(), RESOLVED, NOW)).toEqual({
      blockers: [],
      startDate: undefined
    })
    expect(getIssuePlanningConstraints(issue as Issue, new Map(), RESOLVED, NOW)).toEqual({
      blockers: [],
      startDate: undefined
    })
  })

  it('lists only related unresolved blockers in relation order', () => {
    const issue = { blockedBy: [relation('1'), relation('2'), relation('3')], startDate: null }
    const blockers = byId([blocker('3', 'active'), blocker('2', 'done'), blocker('1', 'todo'), blocker('4', 'active')])
    expect(getIssuePlanningConstraints(issue, blockers, RESOLVED, NOW)).toEqual({
      blockers: ['TEST-1: Blocker 1', 'TEST-3: Blocker 3'],
      startDate: undefined
    })
  })

  it('clears blockers when their status becomes completed or canceled and restores reopened blockers', () => {
    const issue = { blockedBy: [relation('1')], startDate: null }
    for (const status of ['done', 'canceled']) {
      expect(getIssuePlanningConstraints(issue, byId([blocker('1', status)]), RESOLVED, NOW).blockers).toEqual([])
    }
    expect(getIssuePlanningConstraints(issue, byId([blocker('1', 'active')]), RESOLVED, NOW).blockers).toHaveLength(1)
  })

  it('keeps unknown statuses unresolved and skips blocker references that are not loaded', () => {
    const issue = { blockedBy: [relation('1'), relation('2')], startDate: null }
    expect(getIssuePlanningConstraints(issue, byId([blocker('1', 'unknown')]), RESOLVED, NOW).blockers).toEqual([
      'TEST-1: Blocker 1'
    ])
    expect(getIssuePlanningConstraints(issue, new Map(), RESOLVED, NOW).blockers).toEqual([])
  })

  it.each([null, NOW - 1, NOW])('does not flag a missing, past, or current start date: %p', (startDate) => {
    expect(
      getIssuePlanningConstraints({ blockedBy: [], startDate }, new Map(), RESOLVED, NOW).startDate
    ).toBeUndefined()
  })

  it('reports future start dates alongside blockers and clears the date when it arrives', () => {
    const issue = { blockedBy: [relation('1')], startDate: NOW + HOUR }
    const blockers = byId([blocker('1', 'active')])
    expect(getIssuePlanningConstraints(issue, blockers, RESOLVED, NOW)).toEqual({
      blockers: ['TEST-1: Blocker 1'],
      startDate: NOW + HOUR
    })
    expect(getIssuePlanningConstraints(issue, blockers, RESOLVED, NOW + HOUR).startDate).toBeUndefined()
  })
})

describe('list-level planning constraints', () => {
  function issue (id: string, data: Partial<Issue>): Issue {
    return { _id: id as Ref<Issue>, blockedBy: [], startDate: null, ...data } as unknown as Issue
  }

  function todo (id: string, attachedTo: string, data: Partial<ToDo> = {}): ToDo {
    return { _id: id as Ref<ToDo>, attachedTo, workslots: 0, doneOn: null, ...data } as unknown as ToDo
  }

  it('collects each blocker id once across all issues of the list', () => {
    const issues = [
      issue('a', { blockedBy: [relation('1'), relation('2')] }),
      issue('b', { blockedBy: [relation('2'), relation('3')] }),
      issue('c', {})
    ]
    expect(getBlockerIds(issues)).toEqual(['1', '2', '3'])
  })

  it('returns entries only for unplanned open ToDos whose issue has a constraint', () => {
    const issues = byId([
      issue('blocked', { blockedBy: [relation('1')] }),
      issue('later', { startDate: NOW + HOUR }),
      issue('free', { blockedBy: [relation('2')] })
    ])
    const blockers = byId([blocker('1', 'active'), blocker('2', 'done')])
    const todos = [
      todo('t1', 'blocked'),
      todo('t2', 'later'),
      todo('t3', 'free'),
      todo('t4', 'blocked', { workslots: 1 }),
      todo('t5', 'blocked', { doneOn: NOW }),
      todo('t6', 'not-loaded')
    ]
    const result = getToDoPlanningConstraints(todos, issues, blockers, RESOLVED, NOW)
    expect(Array.from(result.keys())).toEqual(['t1', 't2'])
    expect(result.get('t1' as Ref<ToDo>)).toEqual({ blockers: ['TEST-1: Blocker 1'], startDate: undefined })
    expect(result.get('t2' as Ref<ToDo>)).toEqual({ blockers: [], startDate: NOW + HOUR })
  })
})

it('queries only unique issues of open unplanned rows', () => {
  const todos = [
    { attachedTo: 'a', attachedToClass: 'issue', workslots: 0, doneOn: null },
    { attachedTo: 'a', attachedToClass: 'issue', workslots: 0, doneOn: null },
    { attachedTo: 'b', attachedToClass: 'issue', workslots: 1, doneOn: null },
    { attachedTo: 'c', attachedToClass: 'issue', workslots: 0, doneOn: NOW },
    { attachedTo: 'd', attachedToClass: 'document', workslots: 0, doneOn: null }
  ] as unknown as ToDo[]
  expect(getPlanningIssueIds(todos, (clazz) => clazz === 'issue')).toEqual(['a'])
})

it('reuses unchanged constraints on ticks and clears a start hint at its boundary', () => {
  const issue = { _id: 'issue', startDate: NOW + HOUR, blockedBy: [relation('1')] } as unknown as Issue
  const todo = { _id: 'todo', attachedTo: 'issue', workslots: 0, doneOn: null } as unknown as ToDo
  const issues = byId([issue])
  const blockers = byId([blocker('1', 'active')])
  const previous = getToDoPlanningConstraints([todo], issues, blockers, RESOLVED, NOW)
  const next = getToDoPlanningConstraints([todo], issues, blockers, RESOLVED, NOW + 1, previous)
  expect(next).toBe(previous)
  expect(next.get(todo._id)).toBe(previous.get(todo._id))
  const reached = getToDoPlanningConstraints([todo], issues, blockers, RESOLVED, NOW + HOUR, next)
  expect(reached.get(todo._id)?.startDate).toBeUndefined()
  expect(reached.get(todo._id)?.blockers).toEqual(['TEST-1: Blocker 1'])
  expect(reached.get(todo._id)).not.toBe(next.get(todo._id))
  const resolved = getToDoPlanningConstraints(
    [todo],
    issues,
    byId([blocker('1', 'done')]),
    RESOLVED,
    NOW + HOUR,
    reached
  )
  expect(resolved.size).toBe(0)
})

it('keeps the uncapped legacy fallback without a positive estimate', () => {
  const late = new Date(2026, 9, 23, 23, 45).getTime()
  expect(getIssueSlotDuration(undefined, late)).toBe(HOUR / 2)
  expect(getIssueSlotDuration({ estimation: 0, reportedTime: 0 }, late)).toBe(HOUR / 2)
})
