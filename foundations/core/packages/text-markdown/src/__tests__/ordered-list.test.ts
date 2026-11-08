// SPDX-License-Identifier: EPL-2.0

import { MarkupNodeType, traverseNode, type Attrs, type AttrValue, type MarkupNode } from '@hcengineering/text-core'

import { markdownToMarkup, markupToMarkdown } from '..'

function listDocument (attrs?: Attrs): MarkupNode {
  return {
    type: MarkupNodeType.doc,
    content: [
      {
        type: MarkupNodeType.ordered_list,
        attrs,
        content: ['First', 'Second'].map((text) => ({
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
    { attrs: undefined, start: 1 },
    { attrs: { start: 1 }, start: 1 },
    { attrs: { start: 3 }, start: 3 },
    { attrs: { start: '3' }, start: 3 },
    { attrs: { start: 1, order: 8 }, start: 1 },
    { attrs: { order: 4 }, start: 4 },
    { attrs: { order: '4' }, start: 4 },
    { attrs: { start: 3, order: 8 }, start: 3 },
    { attrs: { start: null, order: 4 }, start: 4 },
    { attrs: { start: '  +3  ' }, start: 3 },
    { attrs: { start: '0', order: 8 }, start: 0 },
    { attrs: { start: null, order: null }, start: 1 },
    { attrs: { start: 3, order: 'invalid' }, start: 3 },
    { attrs: { start: 0, order: 8 }, start: 0 }
  ])('uses start with a legacy order fallback: %j', ({ attrs, start }) => {
    const markup = listDocument(attrs)

    expect(markupToMarkdown(markup)).toBe(`${start}. First\n${start + 1}. Second`)
  })

  it.each(invalidStarts)('defaults invalid start/order to 1: %s', (value) => {
    for (const attrs of [{ start: value, order: 8 }, { order: value }, { start: null, order: value }]) {
      expect(markupToMarkdown(listDocument(attrs))).toBe('1. First\n2. Second')
    }
  })

  it.each([-1, '-1', Number.MIN_SAFE_INTEGER])('clamps negative start/order to zero: %s', (value) => {
    for (const attrs of [{ start: value }, { order: value }, { start: null, order: value }]) {
      expect(markupToMarkdown(listDocument(attrs))).toBe('0. First\n1. Second')
    }
  })

  it.each([
    { value: 999999998, markdown: '999999998. First\n999999999. Second' },
    { value: 999999999, markdown: '999999999. First\n999999999. Second' },
    { value: 1000000000, markdown: '999999999. First\n999999999. Second' },
    { value: '1000000000', markdown: '999999999. First\n999999999. Second' },
    { value: Number.MAX_SAFE_INTEGER, markdown: '999999999. First\n999999999. Second' }
  ])('caps every start/order marker at nine digits: %j', ({ value, markdown }) => {
    for (const attrs of [{ start: value }, { order: value }, { start: null, order: value }]) {
      expect(markupToMarkdown(listDocument(attrs))).toBe(markdown)
    }
  })

  it.each([-1, 0, 3, 10, 1000000000])('preserves start %s in a table through Markdown HTML export/import', (start) => {
    const list = listDocument({ start }).content?.[0]
    if (list === undefined) {
      throw new Error('Missing ordered list fixture')
    }
    const markup: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.table,
          content: [
            {
              type: MarkupNodeType.table_row,
              content: [{ type: MarkupNodeType.table_cell, content: [list] }]
            }
          ]
        }
      ]
    }

    const markdown = markupToMarkdown(markup)
    expect(markdown).toBe(
      `<table><tbody><tr><td><ol start="${start}">` +
        '<li><p>First</p></li><li><p>Second</p></li></ol></td></tr></tbody></table>'
    )
    const parsed = markdownToMarkup(markdown)
    expect(parsed.content?.[0]?.type).toBe(MarkupNodeType.table)
    const lists: MarkupNode[] = []
    traverseNode(parsed, (node) => {
      if (node.type === MarkupNodeType.ordered_list) {
        lists.push(node)
      }
      return true
    })
    expect(lists).toEqual([list])
  })
})
