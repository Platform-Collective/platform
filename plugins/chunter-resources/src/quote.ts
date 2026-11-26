// SPDX-License-Identifier: EPL-2.0

import type { Markup } from '@hcengineering/core'
import { jsonToMarkup, markupToJSON, MarkupMarkType, type MarkupNode, MarkupNodeType } from '@hcengineering/text'

const QUOTE_BLOCK_LIMIT = 3

function getTextContent (node: MarkupNode): string {
  const text = node.type === MarkupNodeType.text ? (node.text ?? '') : ''
  return text + (node.content?.map(getTextContent).join('') ?? '')
}

function getReferenceText (node: MarkupNode): string {
  const label = node.attrs?.label
  if (typeof label === 'string' && label.length > 0) return label

  const visibleText = node.content?.map(getTextContent).join('') ?? ''
  if (visibleText.length > 0) return visibleText

  const id = node.attrs?.id
  return typeof id === 'string' ? id : ''
}

function toQuoteNode (node: MarkupNode): MarkupNode | undefined {
  if (
    node.type === MarkupNodeType.blockquote ||
    node.type === MarkupNodeType.image ||
    node.type === MarkupNodeType.gif
  ) {
    return undefined
  }
  if (node.type === MarkupNodeType.reference) {
    const text = getReferenceText(node)
    if (text.length === 0) return undefined
    return { type: MarkupNodeType.text, text: `@${text}`, marks: node.marks }
  }

  const content = node.content?.map(toQuoteNode).filter((node): node is MarkupNode => node !== undefined)
  if (node.content !== undefined && node.content.length > 0 && content?.length === 0) {
    if (node.type !== MarkupNodeType.paragraph) return undefined
  }
  return { ...node, ...(content !== undefined ? { content } : {}) }
}

/** Builds a sanitized quote with attribution, a source link and an empty paragraph for the reply. */
export function buildQuoteMarkup (message: Markup, attribution: string, link: string, linkLabel?: string): Markup {
  const content = (markupToJSON(message).content ?? [])
    .map(toQuoteNode)
    .filter((node): node is MarkupNode => node !== undefined)
  const quotedContent = content.slice(0, QUOTE_BLOCK_LIMIT)
  if (content.length > QUOTE_BLOCK_LIMIT) {
    quotedContent.push({
      type: MarkupNodeType.paragraph,
      content: [{ type: MarkupNodeType.text, text: '…' }]
    })
  }

  return jsonToMarkup({
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
                text: linkLabel ?? link,
                marks: [{ type: MarkupMarkType.link, attrs: { href: link } }]
              }
            ]
          },
          ...quotedContent
        ]
      },
      { type: MarkupNodeType.paragraph, content: [] }
    ]
  })
}
