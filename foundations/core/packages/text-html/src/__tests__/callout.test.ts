// SPDX-License-Identifier: EPL-2.0

import { getCalloutEmoji, MarkupNodeType, type MarkupNode } from '@hcengineering/text-core'
import { htmlToMarkup, markupToHtml } from '..'

describe('callout HTML conversion', () => {
  it('round-trips info with emoji and nested formatting', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          attrs: { kind: 'info', emoji: '💡' },
          content: [
            {
              type: MarkupNodeType.paragraph,
              attrs: { textAlign: null },
              content: [{ type: MarkupNodeType.text, text: 'Hello' }]
            }
          ]
        }
      ]
    }
    const html = markupToHtml(doc)
    expect(html).toContain('data-type="callout"')
    expect(html).toContain('data-emoji="💡"')
    expect(htmlToMarkup(html)).toEqual(doc)
  })

  it.each(['', ' data-kind="unsupported"', ' data-kind="warning"', ' data-kind="success"'])(
    'defaults to info for missing or deferred kinds: %s',
    (attrs) => {
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
    }
  )

  it('limits emoji to sixteen UTF-16 code units', () => {
    const emoji = (value: string): unknown =>
      htmlToMarkup(`<div data-type="callout" data-emoji="${value}"><p>Note</p></div>`).content?.[0].attrs?.emoji

    expect(emoji('1234567890123456')).toBe('1234567890123456')
    expect(emoji('12345678901234567')).toBeNull()
    expect(emoji('👨‍👩‍👧‍👦')).toBe('👨‍👩‍👧‍👦')
    expect(getCalloutEmoji('info')).toBe('ℹ️')
  })

  it('serializes text consistently inside and outside callouts', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'A < B & C' }] },
        {
          type: MarkupNodeType.callout,
          content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'A < B & C' }] }]
        }
      ]
    }

    expect(markupToHtml(doc)).toBe(
      '<p>A < B & C</p><div data-type="callout" data-kind="info" data-emoji="ℹ️"><p>A < B & C</p></div>'
    )
  })

  it('handles split text nodes consistently inside and outside callouts', () => {
    const outside = htmlToMarkup('<p>A&amp;B</p>').content?.[0].content
    const inside = htmlToMarkup('<div data-type="callout"><p>A&amp;B</p></div>').content?.[0].content?.[0].content

    expect(inside).toEqual(outside)
  })

  it('keeps nested callouts and adjacent paragraphs separate', () => {
    const doc = htmlToMarkup(
      '<p>Before</p><div data-type="callout"><div data-type="callout">' +
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

  it('preserves a complete plain div and the paragraph after it', () => {
    const doc = htmlToMarkup('<div><p>Raw</p></div><p>After</p>')
    expect(doc.content?.map((node) => node.content?.[0]?.text)).toEqual(['<div><p>Raw</p></div>', 'After'])
  })

  it('keeps a plain div inside a callout and preserves following paragraphs', () => {
    const doc = htmlToMarkup('<div data-type="callout"><div><p>x</p></div><p>after</p></div><p>outside</p>')
    expect(doc.content?.map((node) => node.type)).toEqual([MarkupNodeType.callout, MarkupNodeType.paragraph])
    expect(doc.content?.[0].content?.map((node) => node.type)).toEqual([
      MarkupNodeType.paragraph,
      MarkupNodeType.paragraph
    ])
    expect(doc.content?.[0].content?.map((node) => node.content?.[0]?.text)).toEqual(['<div><p>x</p></div>', 'after'])
    expect(doc.content?.[1].content?.[0].text).toBe('outside')
  })
})
