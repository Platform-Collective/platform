// SPDX-License-Identifier: EPL-2.0

import { MarkupNodeType, MarkupMarkType, type MarkupNode } from '@hcengineering/text-core'
import { markdownToMarkup, markupToMarkdown } from '..'

describe('callout Markdown conversion', () => {
  it.each(['info', 'warning', 'success'])('round-trips %s callouts without losing block content', (kind) => {
    const paragraph = (text: string): MarkupNode => ({
      type: MarkupNodeType.paragraph,
      attrs: { textAlign: null },
      content: [{ type: MarkupNodeType.text, text }]
    })
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          attrs: { kind, emoji: '💡 "<&' },
          content: [
            {
              type: MarkupNodeType.paragraph,
              attrs: { textAlign: null },
              content: [{ type: MarkupNodeType.text, text: 'Formatted', marks: [{ type: MarkupMarkType.bold }] }]
            },
            paragraph('Second paragraph'),
            {
              type: MarkupNodeType.bullet_list,
              content: [{ type: MarkupNodeType.list_item, content: [paragraph('Item')] }]
            },
            {
              type: MarkupNodeType.code_block,
              attrs: { language: 'ts' },
              content: [{ type: MarkupNodeType.text, text: 'first\n\nsecond' }]
            },
            { type: MarkupNodeType.callout, attrs: { kind: 'info', emoji: null }, content: [paragraph('Nested')] }
          ]
        }
      ]
    }
    const markdown = markupToMarkdown(doc)
    expect(markdown).toContain('<div data-type="callout"')
    expect(markdownToMarkup(markdown)).toEqual(doc)
    expect(markupToMarkdown(markdownToMarkup(markdown))).toBe(markdown)
  })

  it('defaults missing attributes and preserves an empty callout', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          content: [{ type: MarkupNodeType.paragraph, attrs: { textAlign: null } }]
        }
      ]
    }
    expect(markdownToMarkup(markupToMarkdown(doc)).content?.[0]).toEqual({
      ...doc.content?.[0],
      attrs: { kind: 'info', emoji: null }
    })
  })

  it('keeps a callout separate from following Markdown and ordinary blockquotes', () => {
    const doc = markdownToMarkup('<div data-type="callout"><p>Note</p></div>\n\nAfter\n\n> Quote')
    expect(doc.content?.map((node) => node.type)).toEqual(['callout', 'paragraph', 'blockquote'])
    expect(markdownToMarkup('> Quote').content?.[0].type).toBe(MarkupNodeType.blockquote)
  })
})
