// SPDX-License-Identifier: EPL-2.0

import { MarkupNodeType, type Attrs, type AttrValue, type MarkupNode } from '@hcengineering/text-core'

import { htmlToMarkup, markupToHtml } from '..'

function listDocument (attrs?: Attrs): MarkupNode {
  return {
    type: MarkupNodeType.doc,
    content: [
      {
        type: MarkupNodeType.ordered_list,
        attrs,
        content: ['First'].map((text) => ({
          type: MarkupNodeType.list_item,
          content: [
            {
              type: MarkupNodeType.paragraph,
              attrs: { textAlign: null },
              content: [{ type: MarkupNodeType.text, text }]
            }
          ]
        }))
      }
    ]
  }
}

const invalidStarts: AttrValue[] = [
  'invalid',
  '',
  ' ',
  '3.5',
  3.5,
  NaN,
  Infinity,
  -Infinity,
  'NaN',
  'Infinity',
  '3items',
  '0x10',
  '1e2',
  Number.MAX_SAFE_INTEGER + 1,
  '9007199254740992',
  true,
  false
]

describe('ordered list serialization', () => {
  it.each([
    { attrs: undefined, startAttribute: '' },
    { attrs: { start: 1 }, startAttribute: '' },
    { attrs: { start: 3 }, startAttribute: ' start="3"' },
    { attrs: { start: '3' }, startAttribute: ' start="3"' },
    { attrs: { start: 1, order: 8 }, startAttribute: '' },
    { attrs: { order: 4 }, startAttribute: ' start="4"' },
    { attrs: { order: '4' }, startAttribute: ' start="4"' },
    { attrs: { start: 3, order: 8 }, startAttribute: ' start="3"' },
    { attrs: { start: null, order: 4 }, startAttribute: ' start="4"' },
    { attrs: { start: '  +3  ' }, startAttribute: ' start="3"' },
    { attrs: { start: '0', order: 8 }, startAttribute: ' start="0"' },
    { attrs: { start: null, order: null }, startAttribute: '' },
    { attrs: { start: 3, order: 'invalid' }, startAttribute: ' start="3"' },
    { attrs: { start: 0, order: 8 }, startAttribute: ' start="0"' }
  ])('uses start with a legacy order fallback: %j', ({ attrs, startAttribute }) => {
    const markup = listDocument(attrs)

    expect(markupToHtml(markup)).toBe(`<ol${startAttribute}><li><p>First</p></li></ol>`)
  })

  it.each(invalidStarts)('defaults invalid start/order to 1: %s', (value) => {
    for (const attrs of [{ start: value, order: 8 }, { order: value }, { start: null, order: value }]) {
      expect(markupToHtml(listDocument(attrs))).toBe('<ol><li><p>First</p></li></ol>')
    }
  })

  it.each([0, 1, 3, 10, -1])('preserves start %s through the shared HTML parser', (start) => {
    const markup = listDocument({ start })
    expect(htmlToMarkup(markupToHtml(markup))).toEqual(markup)
  })

  it.each(['invalid', '', ' ', '3.5', 'NaN', 'Infinity', '3items', '0x10', '9007199254740992'])(
    'defaults malformed HTML start to 1: %s',
    (start) => {
      const markup = htmlToMarkup(`<ol start="${start}"><li><p>First</p></li></ol>`)
      expect(markup).toEqual(listDocument({ start: 1 }))
      expect(markupToHtml(markup)).toBe('<ol><li><p>First</p></li></ol>')
    }
  )
})
