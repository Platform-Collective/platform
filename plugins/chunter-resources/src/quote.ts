// SPDX-License-Identifier: EPL-2.0

import type { Markup } from '@hcengineering/core'
import { jsonToMarkup, markupToJSON, MarkupMarkType, MarkupNodeType } from '@hcengineering/text'

/** Builds a linked quote followed by an empty paragraph for the reply. */
export function buildQuoteMarkup (message: Markup, author: string, link: string): Markup {
  return jsonToMarkup({
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
                text: author || link,
                marks: [{ type: MarkupMarkType.link, attrs: { href: link } }]
              }
            ]
          },
          ...(markupToJSON(message).content ?? [])
        ]
      },
      { type: MarkupNodeType.paragraph, content: [] }
    ]
  })
}
