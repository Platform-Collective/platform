// SPDX-License-Identifier: EPL-2.0

import { getEnumTooltipLabel } from '../components/enum-presenter'

describe('getEnumTooltipLabel', () => {
  const items = [
    { id: 'JPEG', label: 'JPEG' },
    { id: 'PNG', label: 'PNG' }
  ]

  it('keeps the tooltip for a selected enum option', () => {
    expect(getEnumTooltipLabel(items, 'JPEG')).toBe('JPEG')
  })

  it('uses the displayed label of the matching option', () => {
    expect(getEnumTooltipLabel([{ id: 'JPEG', label: 'JPEG image' }], 'JPEG')).toBe('JPEG image')
  })

  it('removes the tooltip when the stored option is removed', () => {
    expect(
      getEnumTooltipLabel(
        items.filter((item) => item.id !== 'JPEG'),
        'JPEG'
      )
    ).toBeUndefined()
  })

  it('removes the tooltip when the stored option is renamed', () => {
    expect(getEnumTooltipLabel([{ id: 'JPG', label: 'JPG' }, items[1]], 'JPEG')).toBeUndefined()
  })

  it('omits the tooltip until enum choices are loaded', () => {
    expect(getEnumTooltipLabel([], 'JPEG')).toBeUndefined()
    expect(getEnumTooltipLabel(undefined, 'JPEG')).toBeUndefined()
  })

  it('omits the tooltip for an empty selection', () => {
    expect(getEnumTooltipLabel(items, '')).toBeUndefined()
  })
})
