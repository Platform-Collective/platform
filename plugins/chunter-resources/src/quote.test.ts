// SPDX-License-Identifier: EPL-2.0

import {
  EmptyMarkup,
  jsonToMarkup,
  jsonToPmNode,
  markupToJSON,
  MarkupMarkType,
  MarkupNodeType
} from '@hcengineering/text'
import { buildQuoteMarkup } from './quote'

describe('buildQuoteMarkup', () => {
  const link = 'https://huly.app/workbench/workspace/chunter/channel?message=message-id'
  const attribution = 'Jane Doe wrote:'

  it('quotes the attribution and original rich text and leaves a paragraph for the reply', () => {
    const content = [
      {
        type: MarkupNodeType.paragraph,
        content: [{ type: MarkupNodeType.text, text: 'Hello', marks: [{ type: MarkupMarkType.bold }] }]
      }
    ]
    const message = jsonToMarkup({ type: MarkupNodeType.doc, content })

    expect(markupToJSON(buildQuoteMarkup(message, attribution, link))).toEqual({
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.blockquote,
          content: [
            {
              type: MarkupNodeType.paragraph,
              content: [
                { type: MarkupNodeType.text, text: attribution },
                { type: MarkupNodeType.text, text: ' ' },
                {
                  type: MarkupNodeType.text,
                  text: link,
                  marks: [{ type: MarkupMarkType.link, attrs: { href: link } }]
                }
              ]
            },
            ...content
          ]
        },
        { type: MarkupNodeType.paragraph, content: [] }
      ]
    })
    expect(markupToJSON(message)).toEqual({ type: MarkupNodeType.doc, content })
    expect(() => {
      jsonToPmNode(markupToJSON(buildQuoteMarkup(message, attribution, link))).check()
    }).not.toThrow()
  })

  it('converts references to plain text without notifying mentioned people again', () => {
    const message = jsonToMarkup({
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.paragraph,
          content: [
            { type: MarkupNodeType.text, text: 'Before ' },
            {
              type: MarkupNodeType.reference,
              attrs: { id: 'person', objectclass: 'contact:class:Person', label: 'Jane' }
            },
            { type: MarkupNodeType.text, text: ' ' },
            {
              type: MarkupNodeType.reference,
              attrs: { id: 'everyone', objectclass: 'contact:class:Person', label: 'everyone' },
              marks: [{ type: MarkupMarkType.bold }]
            },
            { type: MarkupNodeType.text, text: ' ' },
            {
              type: MarkupNodeType.reference,
              attrs: { id: 'here', objectclass: 'contact:class:Person', label: 'here' }
            },
            { type: MarkupNodeType.text, text: ' after' }
          ]
        }
      ]
    })

    const quote = markupToJSON(buildQuoteMarkup(message, attribution, link))

    expect(quote.content?.[0].content?.[1]).toEqual({
      type: MarkupNodeType.paragraph,
      content: [
        { type: MarkupNodeType.text, text: 'Before ' },
        { type: MarkupNodeType.text, text: '@Jane' },
        { type: MarkupNodeType.text, text: ' ' },
        { type: MarkupNodeType.text, text: '@everyone', marks: [{ type: MarkupMarkType.bold }] },
        { type: MarkupNodeType.text, text: ' ' },
        { type: MarkupNodeType.text, text: '@here' },
        { type: MarkupNodeType.text, text: ' after' }
      ]
    })
  })

  it('drops images and nested quotes while preserving surrounding text', () => {
    const message = jsonToMarkup({
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.paragraph,
          content: [
            { type: MarkupNodeType.text, text: 'Before ' },
            { type: MarkupNodeType.image, attrs: { src: 'https://huly.app/image.png' } },
            { type: MarkupNodeType.text, text: ' between ' },
            { type: MarkupNodeType.gif, attrs: { src: 'https://huly.app/image.gif' } },
            { type: MarkupNodeType.text, text: ' after' }
          ]
        },
        {
          type: MarkupNodeType.blockquote,
          content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'Nested' }] }]
        },
        { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'After quote' }] }
      ]
    })

    const quote = markupToJSON(buildQuoteMarkup(message, attribution, link))

    expect(quote.content?.[0].content?.slice(1)).toEqual([
      {
        type: MarkupNodeType.paragraph,
        content: [
          { type: MarkupNodeType.text, text: 'Before ' },
          { type: MarkupNodeType.text, text: ' between ' },
          { type: MarkupNodeType.text, text: ' after' }
        ]
      },
      { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'After quote' }] }
    ])
    expect(() => {
      jsonToPmNode(quote).check()
    }).not.toThrow()
  })

  it('limits the quote to three blocks with an ellipsis', () => {
    const content = ['One', 'Two', 'Three', 'Four', 'Five'].map((text) => ({
      type: MarkupNodeType.paragraph,
      content: [{ type: MarkupNodeType.text, text }]
    }))
    const message = jsonToMarkup({ type: MarkupNodeType.doc, content })

    const quote = markupToJSON(buildQuoteMarkup(message, attribution, link))

    expect(quote.content?.[0].content?.slice(1)).toEqual([
      ...content.slice(0, 3),
      { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: '…' }] }
    ])
  })

  it('does not add an ellipsis at the three-block limit', () => {
    const content = ['One', 'Two', 'Three'].map((text) => ({
      type: MarkupNodeType.paragraph,
      content: [{ type: MarkupNodeType.text, text }]
    }))
    const message = jsonToMarkup({ type: MarkupNodeType.doc, content })

    const quote = markupToJSON(buildQuoteMarkup(message, attribution, link))

    expect(quote.content?.[0].content?.slice(1)).toEqual(content)
  })

  it('keeps attribution and links as data, including markup characters', () => {
    const author = '<Jane & "Doe"> wrote:'
    const href = `${link}&title="<example>"`
    const quote = markupToJSON(buildQuoteMarkup(EmptyMarkup, author, href))
    const attribution = quote.content?.[0].content?.[0].content

    expect(attribution).toEqual([
      { type: MarkupNodeType.text, text: author },
      { type: MarkupNodeType.text, text: ' ' },
      {
        type: MarkupNodeType.text,
        text: href,
        marks: [{ type: MarkupMarkType.link, attrs: { href } }]
      }
    ])
  })

  it.each([EmptyMarkup, ''])('can quote a message without text', (message) => {
    const quote = markupToJSON(buildQuoteMarkup(message, attribution, link))

    expect(quote.content?.[0].type).toBe(MarkupNodeType.blockquote)
    expect(quote.content?.[0].content?.[0].content?.[0].text).toBe(attribution)
    expect(quote.content?.[1]).toEqual({ type: MarkupNodeType.paragraph, content: [] })
  })
})
