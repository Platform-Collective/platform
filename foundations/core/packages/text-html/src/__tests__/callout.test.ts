// SPDX-License-Identifier: EPL-2.0

import { MarkupNodeType, type MarkupNode } from '@hcengineering/text-core'
import { htmlToMarkup, markupToHtml } from '..'

describe('callout HTML conversion', () => {
  it.each(['info', 'warning', 'success'])('round-trips %s with emoji and nested formatting', (kind) => {
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
              content: [{ type: MarkupNodeType.text, text: 'Hello <world>' }]
            }
          ]
        }
      ]
    }
    const html = markupToHtml(doc)
    expect(html).toContain('data-type="callout"')
    expect(html).toContain('data-emoji="💡 &quot;&lt;&amp;"')
    expect(htmlToMarkup(html)).toEqual(doc)
  })

  it.each(['', ' data-kind="unsupported"'])('defaults to info for missing or invalid kind: %s', (attrs) => {
    expect(htmlToMarkup(`<div data-type="callout"${attrs}><p>Note</p></div>`).content?.[0]).toEqual({
      type: MarkupNodeType.callout,
      attrs: { kind: 'info', emoji: null },
      content: [
        {
          type: MarkupNodeType.paragraph,
          attrs: { textAlign: null },
          content: [{ type: MarkupNodeType.text, text: 'Note' }]
        }
      ]
    })
  })

  it('keeps nested callouts and adjacent paragraphs separate', () => {
    const doc = htmlToMarkup(
      '<p>Before</p><div data-type="callout"><div data-type="callout" data-kind="success">' +
        '<p>Inner</p></div><p>Outer</p></div><p>After</p>'
    )
    expect(doc.content?.map((node) => node.type)).toEqual(['paragraph', 'callout', 'paragraph'])
    expect(doc.content?.[1].content?.map((node) => node.type)).toEqual(['callout', 'paragraph'])
    expect(htmlToMarkup(markupToHtml(doc))).toEqual(doc)
  })

  it('continues to preserve untagged divs as raw HTML', () => {
    const doc = htmlToMarkup('<div><p>Raw</p></div>')
    expect(doc.content?.[0].content?.[0].text).toContain('<div>')
    expect(doc.content?.[0].type).toBe(MarkupNodeType.paragraph)
  })
})
