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

  it('quotes the author and original rich text and leaves a paragraph for the reply', () => {
    const content = [
      {
        type: MarkupNodeType.paragraph,
        content: [{ type: MarkupNodeType.text, text: 'Hello', marks: [{ type: MarkupMarkType.bold }] }]
      },
      {
        type: MarkupNodeType.blockquote,
        content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'Earlier' }] }]
      }
    ]
    const message = jsonToMarkup({ type: MarkupNodeType.doc, content })

    expect(markupToJSON(buildQuoteMarkup(message, 'Jane Doe', link))).toEqual({
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.blockquote,
          content: [
            {
              type: MarkupNodeType.paragraph,
              content: [
                {
                  type: MarkupNodeType.text,
                  text: 'Jane Doe',
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
      jsonToPmNode(markupToJSON(buildQuoteMarkup(message, 'Jane Doe', link))).check()
    }).not.toThrow()
  })

  it('keeps author names and links as data, including markup characters', () => {
    const author = '<Jane & "Doe">'
    const href = `${link}&title="<example>"`
    const quote = markupToJSON(buildQuoteMarkup(EmptyMarkup, author, href))
    const attribution = quote.content?.[0].content?.[0].content?.[0]

    expect(attribution).toEqual({
      type: MarkupNodeType.text,
      text: author,
      marks: [{ type: MarkupMarkType.link, attrs: { href } }]
    })
  })

  it.each([EmptyMarkup, ''])('can quote a message without text', (message) => {
    const quote = markupToJSON(buildQuoteMarkup(message, 'Jane Doe', link))

    expect(quote.content?.[0].type).toBe(MarkupNodeType.blockquote)
    expect(quote.content?.[0].content?.[0].content?.[0].text).toBe('Jane Doe')
    expect(quote.content?.[1]).toEqual({ type: MarkupNodeType.paragraph, content: [] })
  })

  it('uses the message link when the author is unavailable', () => {
    const quote = markupToJSON(buildQuoteMarkup(EmptyMarkup, '', link))

    expect(quote.content?.[0].content?.[0].content?.[0].text).toBe(link)
  })
})
