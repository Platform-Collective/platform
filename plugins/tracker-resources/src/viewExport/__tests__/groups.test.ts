//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { NO_GROUPING } from '../../board/config'
import { exportGroupKeys } from '../groups'

describe('exportGroupKeys', () => {
  it('uses the group by of a table', () => {
    expect(exportGroupKeys({ groupBy: ['status', 'assignee'] })).toEqual(['status', 'assignee'])
  })

  it('leaves out no grouping and repeated keys', () => {
    expect(exportGroupKeys({ groupBy: [NO_GROUPING] })).toEqual([])
    expect(exportGroupKeys({ groupBy: [] })).toEqual([])
    expect(exportGroupKeys({ groupBy: undefined })).toEqual([])
    expect(exportGroupKeys({ groupBy: ['status', '', 'status'] })).toEqual(['status'])
  })

  it('lists a board lane after lane and column after column', () => {
    expect(exportGroupKeys({ groupBy: ['assignee'], board: { columnKey: 'status', laneKey: 'assignee' } })).toEqual([
      'assignee',
      'status'
    ])
    expect(exportGroupKeys({ groupBy: [NO_GROUPING], board: { columnKey: 'status', laneKey: undefined } })).toEqual([
      'status'
    ])
  })
})
