// SPDX-License-Identifier: EPL-2.0

import { mergeInlineCommandItems } from '../inlineCommandItems'

describe('mergeInlineCommandItems', () => {
  const base = [{ id: 'image' }, { id: 'table' }, { id: 'mermaid' }]

  it('returns the built-in items when nothing is contributed', () => {
    expect(mergeInlineCommandItems(base)).toEqual(base)
  })

  it('appends contributed items after the built-in ones', () => {
    expect(mergeInlineCommandItems(base, [{ id: 'subpage' }]).map((it) => it.id)).toEqual([
      'image',
      'table',
      'mermaid',
      'subpage'
    ])
  })

  it('drops excluded items, built-in and contributed', () => {
    expect(mergeInlineCommandItems(base, [{ id: 'subpage' }], ['image', 'subpage']).map((it) => it.id)).toEqual([
      'table',
      'mermaid'
    ])
  })

  it('does not let a contributed item shadow a built-in one or repeat itself', () => {
    const result = mergeInlineCommandItems(
      [{ id: 'table', label: 'built-in' }],
      [
        { id: 'table', label: 'contributed' },
        { id: 'subpage', label: 'first' },
        { id: 'subpage', label: 'second' }
      ]
    )
    expect(result).toEqual([
      { id: 'table', label: 'built-in' },
      { id: 'subpage', label: 'first' }
    ])
  })

  it('does not modify its arguments', () => {
    const extra = [{ id: 'subpage' }]
    mergeInlineCommandItems(base, extra, ['table'])
    expect(base.map((it) => it.id)).toEqual(['image', 'table', 'mermaid'])
    expect(extra).toEqual([{ id: 'subpage' }])
  })
})
