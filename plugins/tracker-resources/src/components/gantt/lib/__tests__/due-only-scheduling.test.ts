//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref } from '@hcengineering/core'
import type { Issue, IssueRelation } from '@hcengineering/tracker'
import { bulkDragPrimaryEdits, issueDragPrimaryEdit, selectedDragMembers } from '../drag-members'
import { simulateCascade } from '../scheduler'
import { computeBulkDeltaBounds } from '../bulk-boundary'

const DAY = 86_400_000
const CALENDAR = { weekdayMask: 0b0011111, holidays: [] }

function issue(id: string, startDate: number | null, dueDate: number | null): Issue {
  return {
    _id: id as Ref<Issue>,
    _class: 'tracker:class:Issue' as never,
    space: 'space:default' as never,
    createdOn: 0,
    createdBy: 'person:me' as never,
    modifiedOn: 0,
    modifiedBy: 'person:me' as never,
    startDate,
    dueDate,
    parents: []
  } as unknown as Issue
}

function relation(source: Issue, target: Issue): IssueRelation {
  return {
    _id: 'relation:one' as never,
    _class: 'tracker:class:IssueRelation' as never,
    space: source.space,
    attachedTo: source._id,
    target: target._id,
    kind: 'finish-to-start',
    createdOn: 0,
    createdBy: 'person:me' as never,
    modifiedOn: 0,
    modifiedBy: 'person:me' as never
  } as unknown as IssueRelation
}

describe('due-only schedule wiring', () => {
  it('persists the inferred start when a due-only bar is resized at its right edge', () => {
    const dueOnly = issue('due-only', null, Date.UTC(2026, 9, 19))

    expect(
      issueDragPrimaryEdit(dueOnly, {
        kind: 'resizing-right',
        originStart: Date.UTC(2026, 9, 19),
        originEnd: Date.UTC(2026, 9, 19),
        previewEnd: Date.UTC(2026, 9, 20)
      })
    ).toEqual({ issue: dueOnly, newStart: Date.UTC(2026, 9, 19), newDue: Date.UTC(2026, 9, 20) })
  })

  it('includes a due-only bar in a bulk drag and writes its inferred start', () => {
    const dueOnly = issue('due-only', null, Date.UTC(2026, 9, 19)) // Monday
    const scheduled = issue('scheduled', Date.UTC(2026, 9, 16), Date.UTC(2026, 9, 19))
    const members = selectedDragMembers([dueOnly, scheduled], new Set([dueOnly._id, scheduled._id]))

    const edits = bulkDragPrimaryEdits(members, [dueOnly, scheduled], DAY)

    expect(edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issue: dueOnly, newStart: Date.UTC(2026, 9, 20), newDue: Date.UTC(2026, 9, 20) })
      ])
    )
  })

  it('cascades a predecessor move into a due-only successor and supplies a complete range', () => {
    const predecessor = issue('predecessor', Date.UTC(2026, 9, 15), Date.UTC(2026, 9, 16))
    const successor = issue('successor', null, Date.UTC(2026, 9, 19))
    const result = simulateCascade(
      [{ issue: predecessor, newStart: Date.UTC(2026, 9, 16), newDue: Date.UTC(2026, 9, 19) }],
      [predecessor, successor],
      [relation(predecessor, successor)],
      () => true,
      { workingDays: CALENDAR }
    )

    expect(result.kind).toBe('cascade')
    if (result.kind !== 'cascade') return
    expect(result.shifts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issue: successor,
          oldStart: null,
          oldDue: Date.UTC(2026, 9, 19),
          newStart: Date.UTC(2026, 9, 20),
          newDue: Date.UTC(2026, 9, 20)
        })
      ])
    )
  })

  it('enforces a due-only predecessor boundary for a due-only member', () => {
    const predecessor = issue('predecessor', null, Date.UTC(2026, 9, 16))
    const member = issue('member', null, Date.UTC(2026, 9, 19))
    const { minDeltaMs } = computeBulkDeltaBounds(
      new Set([member._id]),
      [predecessor, member],
      [relation(predecessor, member)],
      CALENDAR
    )
    expect(Math.abs(minDeltaMs)).toBe(0)
  })

  it('preserves slack through a shifted due-only predecessor', () => {
    const a = issue('a', Date.UTC(2026, 9, 15), Date.UTC(2026, 9, 15))
    const b = issue('b', null, Date.UTC(2026, 9, 19))
    const c = issue('c', Date.UTC(2026, 9, 21), Date.UTC(2026, 9, 22))
    const result = simulateCascade(
      [{ issue: a, newStart: Date.UTC(2026, 9, 20), newDue: Date.UTC(2026, 9, 20) }],
      [a, b, c],
      [relation(a, b), relation(b, c)],
      () => true,
      { workingDays: CALENDAR }
    )
    expect(result.kind).toBe('cascade')
    if (result.kind !== 'cascade') return
    expect(result.shifts).toEqual(
      expect.arrayContaining([expect.objectContaining({ issue: c, newStart: Date.UTC(2026, 9, 26) })])
    )
  })
})
