//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  canModifyStatusUpdate,
  latestStatusUpdate,
  MAX_STATUS_UPDATE_BODY,
  PROJECT_STATUSES,
  ProjectStatus,
  sortStatusUpdates,
  validateStatusUpdate
} from '../projectStatus'

describe('project status', () => {
  it('lists the five GitHub statuses', () => {
    expect(PROJECT_STATUSES).toEqual(['INACTIVE', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETE'])
  })

  it('accepts a plain update and a dated one', () => {
    expect(validateStatusUpdate({ status: ProjectStatus.OnTrack, body: '' })).toBeUndefined()
    expect(
      validateStatusUpdate({ status: ProjectStatus.AtRisk, startDate: 1, targetDate: 1, body: 'x' })
    ).toBeUndefined()
    expect(
      validateStatusUpdate({ status: ProjectStatus.AtRisk, startDate: null, targetDate: 5, body: 'x' })
    ).toBeUndefined()
  })

  it('rejects an unknown status, a target before the start and a huge body', () => {
    expect(validateStatusUpdate({ status: 'nope' as any, body: '' })).toBe('invalidStatus')
    expect(validateStatusUpdate({ status: ProjectStatus.OnTrack, startDate: 10, targetDate: 9, body: '' })).toBe(
      'invalidDates'
    )
    expect(
      validateStatusUpdate({ status: ProjectStatus.OnTrack, body: 'a'.repeat(MAX_STATUS_UPDATE_BODY + 1) })
    ).toBe('bodyTooLong')
  })

  it('orders the updates newest first and takes the latest as the status', () => {
    const list = [
      { _id: 'a', createdOn: 10 },
      { _id: 'c', createdOn: 30 },
      { _id: 'b', createdOn: 20 }
    ] as any[]
    expect(sortStatusUpdates(list).map((it) => it._id)).toEqual(['c', 'b', 'a'])
    expect(latestStatusUpdate(list)?._id).toBe('c')
    expect(latestStatusUpdate([])).toBeUndefined()
    // the input is not reordered
    expect(list.map((it) => it._id)).toEqual(['a', 'c', 'b'])
  })

  it('breaks a tie of the creation time by the id', () => {
    const list = [
      { _id: 'a', createdOn: 5 },
      { _id: 'b', createdOn: 5 }
    ] as any[]
    expect(sortStatusUpdates(list).map((it) => it._id)).toEqual(['b', 'a'])
  })

  it('lets the author and the managers modify an update', () => {
    const update = { createdBy: 'p1' } as any
    expect(canModifyStatusUpdate(update, ['p1', 'p2'], false)).toBe(true)
    expect(canModifyStatusUpdate(update, ['p3'], false)).toBe(false)
    expect(canModifyStatusUpdate(update, ['p3'], true)).toBe(true)
    expect(canModifyStatusUpdate({} as any, [], false)).toBe(false)
  })
})
