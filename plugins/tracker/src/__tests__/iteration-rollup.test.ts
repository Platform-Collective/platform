//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { computeIterationRollups, computeRollup } from '../iterationRollup'

const done = new Set(['won'])

describe('computeRollup', () => {
  it('is empty for no issues', () => {
    expect(computeRollup([], done)).toEqual({ count: 0, done: 0, estimation: 0 })
  })

  it('counts, counts done and sums the estimates', () => {
    const res = computeRollup(
      [
        { status: 'won', estimation: 2 },
        { status: 'open', estimation: 3.5 },
        { status: 'won' },
        { status: 'open', estimation: Number.NaN }
      ],
      done
    )
    expect(res).toEqual({ count: 4, done: 2, estimation: 5.5 })
  })
})

describe('computeIterationRollups', () => {
  it('groups by the iteration of the field, issues without one under undefined', () => {
    const res = computeIterationRollups(
      [
        { status: 'won', estimation: 1, customFields: { sprint: 'a' } },
        { status: 'open', estimation: 2, customFields: { sprint: 'a' } },
        { status: 'open', estimation: 4, customFields: { sprint: 'b', other: 'a' } },
        { status: 'open', customFields: { other: 'a' } },
        { status: 'won' }
      ],
      'sprint',
      done
    )
    expect(res.get('a')).toEqual({ count: 2, done: 1, estimation: 3 })
    expect(res.get('b')).toEqual({ count: 1, done: 0, estimation: 4 })
    expect(res.get(undefined)).toEqual({ count: 2, done: 1, estimation: 0 })
    expect(res.size).toBe(3)
  })
})
