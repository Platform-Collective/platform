//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref } from '@hcengineering/core'
import { ProjectFieldType, type ProjectField } from '@hcengineering/tracker'
import { buildRegistry, computeMove, mergeCustomFieldValue, nextFieldPosition, readIssueValue, resolveField } from '../registry'

function f (id: string, key: string, position: number, type = ProjectFieldType.Text): ProjectField {
  return { _id: id, key, position, type, label: key } as unknown as ProjectField
}

describe('project field registry', () => {
  const fields = [f('b', 'beta', 1), f('a', 'alpha', 0), f('c', 'points', 2, ProjectFieldType.Number)]

  it('sorts and resolves by key', () => {
    const reg = buildRegistry(fields)
    expect(reg.fields.map((x) => x.key)).toEqual(['alpha', 'beta', 'points'])
    expect(resolveField(reg, 'beta')?._id).toBe('b')
    expect(resolveField(reg, 'zzz')).toBeUndefined()
  })

  it('computes next position', () => {
    expect(nextFieldPosition([])).toBe(0)
    expect(nextFieldPosition(fields)).toBe(3)
  })

  it('moves fields and ignores out-of-range moves', () => {
    expect(computeMove(fields, 'a' as Ref<ProjectField>, -1)).toEqual([])
    expect(computeMove(fields, 'c' as Ref<ProjectField>, 1)).toEqual([])
    expect(computeMove(fields, 'a' as Ref<ProjectField>, 1)).toEqual([
      { id: 'b', position: 0 },
      { id: 'a', position: 1 }
    ])
  })

  it('merges values and removes empty ones', () => {
    expect(mergeCustomFieldValue({ x: 1 }, 'y', 'v')).toEqual({ x: 1, y: 'v' })
    expect(mergeCustomFieldValue({ x: 1, y: 'v' }, 'y', null)).toEqual({ x: 1 })
    expect(mergeCustomFieldValue(undefined, 'y', [])).toEqual({})
  })

  it('reads normalized issue values', () => {
    const reg = buildRegistry(fields)
    expect(readIssueValue(reg, { points: 5 }, 'points')).toBe(5)
    expect(readIssueValue(reg, { points: 'x' }, 'points')).toBeNull()
    expect(readIssueValue(reg, {}, 'missing')).toBeNull()
  })
})
