// SPDX-License-Identifier: EPL-2.0

import type { Class, PersonId, Ref, Space } from '@hcengineering/core'
import { makeRank } from '@hcengineering/rank'
import type { Item } from '../types'
import { getDropRank, hasDropPositionChanged } from '../utils'

function card (id: string, rank: string): Item {
  return {
    _id: id as Ref<Item>,
    _class: 'test:class:Card' as Ref<Class<Item>>,
    space: 'test:space:Cards' as Ref<Space>,
    modifiedOn: 0,
    modifiedBy: 'test:person:User' as PersonId,
    rank
  }
}

describe('getDropRank', () => {
  const a = card('a', '0|hzzzzz:')
  const b = card('b', '0|i00007:')
  const c = card('c', '0|i0000f:')

  it.each([
    ['top', [c, a, b], c],
    ['middle', [a, c, b], c],
    ['bottom', [b, c, a], a]
  ])('persists the displayed order when dropping at the %s of a column', (_, items, dragged) => {
    const rank = getDropRank(items, dragged._id)
    expect(rank).toBeDefined()
    const reloaded = items
      .map((item) => (item._id === dragged._id ? { ...item, rank: rank ?? item.rank } : item))
      .sort((left, right) => left.rank.localeCompare(right.rank))

    expect(reloaded.map((item) => item._id)).toEqual(items.map((item) => item._id))
  })

  it('uses the final order after moving down and then up without a card-level drop', () => {
    const items = [a, b, c]
    items.splice(0, 1)
    items.push(a)
    items.splice(2, 1)
    items.splice(1, 0, a)

    expect(getDropRank(items, a._id)).toBe(makeRank(b.rank, c.rank))
    expect(a.rank).toBe('0|hzzzzz:')
  })

  it('ranks an appended card after the last card in another column', () => {
    expect(getDropRank([b, c, a], a._id)).toBe(makeRank(c.rank, undefined))
  })

  it('ranks a card dropped into an empty column', () => {
    expect(getDropRank([a], a._id)).toBe(makeRank(undefined, undefined))
  })

  it('does not invent a position if the dragged card is absent', () => {
    expect(getDropRank([a, b], c._id)).toBeUndefined()
  })
})

describe('hasDropPositionChanged', () => {
  it('does not update a card released at its original column and position', () => {
    expect(hasDropPositionChanged('open', 'open', 1, 1)).toBe(false)
  })

  it('updates a card moved to another position or column', () => {
    expect(hasDropPositionChanged('open', 'open', 1, 2)).toBe(true)
    expect(hasDropPositionChanged('open', 'done', 1, 1)).toBe(true)
  })
})
