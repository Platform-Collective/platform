// SPDX-License-Identifier: EPL-2.0

import { getCategoryDropIndex, isDragAtBorder } from '../components/list/category-drag'

function dragEvent (clientY: number, childTop = 120, childBottom = 140): MouseEvent {
  return {
    clientY,
    currentTarget: { getBoundingClientRect: () => ({ top: 100, bottom: 200 }) },
    target: { getBoundingClientRect: () => ({ top: childTop, bottom: childBottom }) }
  } as unknown as MouseEvent
}

describe('category drag borders', () => {
  it('measures the category rather than the child under the pointer', () => {
    expect(isDragAtBorder(dragEvent(102), 'top')).toBe(true)
    expect(isDragAtBorder(dragEvent(198), 'bottom')).toBe(true)
    expect(isDragAtBorder(dragEvent(122), 'top')).toBe(false)
    expect(isDragAtBorder(dragEvent(138), 'bottom')).toBe(false)
  })
})

describe('category drop index', () => {
  it.each([102, 125, 150, 175, 198])('previews an incoming item throughout an empty group at y=%i', (clientY) => {
    expect(getCategoryDropIndex(dragEvent(clientY), 0, false)).toBe(0)
  })

  it.each([102, 150, 198])('previews an incoming item throughout a collapsed group at y=%i', (clientY) => {
    expect(getCategoryDropIndex(dragEvent(clientY), 3, true)).toBe(0)
  })

  it('preserves insertion before the first or after the last item in a populated group', () => {
    expect(getCategoryDropIndex(dragEvent(102), 3, false)).toBe(0)
    expect(getCategoryDropIndex(dragEvent(198), 3, false)).toBe(3)
  })

  it('leaves row reordering in control inside an expanded populated group', () => {
    expect(getCategoryDropIndex(dragEvent(150), 3, false)).toBeUndefined()
    expect(getCategoryDropIndex(dragEvent(122), 3, false)).toBeUndefined()
    expect(getCategoryDropIndex(dragEvent(138), 3, false)).toBeUndefined()
  })

  it('preserves the five-pixel border threshold for expanded populated groups', () => {
    expect(getCategoryDropIndex(dragEvent(105), 3, false)).toBeUndefined()
    expect(getCategoryDropIndex(dragEvent(195), 3, false)).toBeUndefined()
  })
})
