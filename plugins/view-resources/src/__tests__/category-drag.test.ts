// SPDX-License-Identifier: EPL-2.0

import { getCategoryDropIndex, isPointInside, removeDragPreview } from '../components/list/category-drag'

function dragEvent (clientY: number, clientX = 250): MouseEvent {
  return {
    clientX,
    clientY,
    currentTarget: {
      getBoundingClientRect: () => ({ top: 100, bottom: 200, left: 0, right: 500 })
    }
  } as unknown as MouseEvent
}

describe('category drop index', () => {
  it.each([102, 125, 150, 175, 198])('previews an incoming item throughout an empty group at y=%i', (clientY) => {
    expect(getCategoryDropIndex(dragEvent(clientY), 0, false)).toBe(0)
  })

  it.each([102, 150, 198])('previews an incoming item throughout a collapsed group at y=%i', (clientY) => {
    expect(getCategoryDropIndex(dragEvent(clientY), 3, true)).toBe(0)
  })

  it('inserts at the top in the upper half of an expanded populated group', () => {
    expect(getCategoryDropIndex(dragEvent(102), 3, false)).toBe(0)
    expect(getCategoryDropIndex(dragEvent(125), 3, false)).toBe(0)
    expect(getCategoryDropIndex(dragEvent(149), 3, false)).toBe(0)
  })

  it('inserts at the bottom in the lower half of an expanded populated group', () => {
    expect(getCategoryDropIndex(dragEvent(150), 3, false)).toBe(3)
    expect(getCategoryDropIndex(dragEvent(175), 3, false)).toBe(3)
    expect(getCategoryDropIndex(dragEvent(198), 3, false)).toBe(3)
  })
})

describe('category pointer bounds', () => {
  const rect = { top: 100, bottom: 200, left: 0, right: 500 }

  it.each([
    [250, 101],
    [250, 150],
    [250, 199]
  ])('keeps child dragleave events inside the group at (%i, %i)', (x, y) => {
    expect(isPointInside(rect, x, y)).toBe(true)
  })

  it.each([
    [250, 100],
    [250, 200],
    [250, 90],
    [250, 210],
    [-1, 150],
    [500, 150],
    [0, 0]
  ])('recognizes a real group exit at (%i, %i)', (x, y) => {
    expect(isPointInside(rect, x, y)).toBe(false)
  })
})

describe('cancelled category preview', () => {
  it('removes only the incoming preview row', () => {
    const existing = { _id: 'existing' }
    const preview = { _id: 'preview' }

    expect(removeDragPreview([existing, preview], 'preview')).toEqual([existing])
  })

  it('leaves groups without a preview unchanged on an unrelated dragend', () => {
    const items = [{ _id: 'first' }, { _id: 'second' }]

    expect(removeDragPreview(items, undefined)).toBe(items)
  })
})
