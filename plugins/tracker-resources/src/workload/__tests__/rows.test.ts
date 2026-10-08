//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { assigneeOfRow, orderRows, rowKeyOf, UNASSIGNED_ROW } from '../rows'

describe('rows', () => {
  it('maps assignees to rows and back', () => {
    expect(rowKeyOf('p1')).toBe('p1')
    expect(rowKeyOf(null)).toBe(UNASSIGNED_ROW)
    expect(rowKeyOf(undefined)).toBe(UNASSIGNED_ROW)
    expect(rowKeyOf('')).toBe(UNASSIGNED_ROW)
    expect(assigneeOfRow('p1')).toBe('p1')
    expect(assigneeOfRow(UNASSIGNED_ROW)).toBeNull()
  })

  it('orders people by name and puts the unassigned row last', () => {
    const names: Record<string, string> = { a: 'Zoe Adams', b: 'adam Brown', c: 'Émile Cole', d: 'Anna 10', e: 'Anna 2' }
    const rows = orderRows([UNASSIGNED_ROW, 'a', 'b', 'c', 'd', 'e'], (k) => names[k], 'Unassigned', 'en')
    expect(rows.map((r) => r.name)).toEqual(['adam Brown', 'Anna 2', 'Anna 10', 'Émile Cole', 'Zoe Adams', 'Unassigned'])
    expect(rows[rows.length - 1].unassigned).toBe(true)
    expect(rows[0].unassigned).toBe(false)
  })

  it('shows the key of a person that is not known', () => {
    const rows = orderRows(['x', 'y'], (k) => (k === 'x' ? '  ' : undefined), 'Unassigned')
    expect(rows.map((r) => r.name)).toEqual(['x', 'y'])
  })

  it('has no unassigned row when there are no unassigned items', () => {
    expect(orderRows(['a'], () => 'A', 'Unassigned').map((r) => r.key)).toEqual(['a'])
    expect(orderRows([], () => 'A', 'Unassigned')).toEqual([])
  })

  it('does not depend on the order the people came in', () => {
    const name = (k: string): string => 'Same'
    expect(orderRows(['b', 'a'], name, 'U').map((r) => r.key)).toEqual(['a', 'b'])
    expect(orderRows(['a', 'b'], name, 'U').map((r) => r.key)).toEqual(['a', 'b'])
  })
})
