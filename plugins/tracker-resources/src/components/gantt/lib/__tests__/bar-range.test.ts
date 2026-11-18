//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { getIssueBarRange } from '../bar-range'

describe('getIssueBarRange', () => {
  it('uses persisted bounds unchanged when both dates are present', () => {
    expect(getIssueBarRange({ startDate: 10, dueDate: 20 })).toEqual({
      startDate: 10,
      dueDate: 20,
      hasInferredStart: false
    })
  })

  it('draws a due-date-only issue as one inclusive day', () => {
    const dueDate = Date.UTC(2026, 9, 19)
    expect(getIssueBarRange({ startDate: null, dueDate })).toEqual({
      startDate: dueDate,
      dueDate,
      hasInferredStart: true
    })
  })

  it.each([
    { startDate: null, dueDate: null },
    { startDate: Date.UTC(2026, 9, 18), dueDate: null }
  ])('keeps non-due-date schedules out of the bar layer', (dates) => {
    expect(getIssueBarRange(dates)).toBeNull()
  })
})
