// SPDX-License-Identifier: EPL-2.0

import { concatLink, type Markup, type WorkspaceUuid } from '@hcengineering/core'
import { htmlToJSON, jsonToMarkup, markupToJSON, MarkupNodeType, type MarkupNode } from '@hcengineering/text'
import { isMarkdownsEquals, MarkdownParser, MarkdownState, storeMarks, storeNodes } from '@hcengineering/text-markdown'
import { gitlabExtensions } from './extensions'

export interface MarkdownUrls {
  refUrl: string
  imageUrl: string
}

export interface MarkdownConverter {
  // Markdown that would not round-trip is kept verbatim as a raw-markdown node
  toMarkup: (markdown: string | null | undefined) => Markup
  toMarkdown: (markup: Markup) => string
}

export function markdownUrls (frontUrl: string, workspace: WorkspaceUuid): MarkdownUrls {
  return {
    refUrl: concatLink(frontUrl, `/browse/?workspace=${workspace}`),
    imageUrl: concatLink(frontUrl, `/files?workspace=${workspace}&file=`)
  }
}

export function parseMessageMarkdown (message: string, urls: MarkdownUrls): MarkupNode {
  const parser = new MarkdownParser({
    refUrl: urls.refUrl,
    imageUrl: urls.imageUrl,
    htmlParser: (html: string): MarkupNode => htmlToJSON(html, gitlabExtensions)
  })
  return parser.parse(message)
}

export function serializeMessage (node: MarkupNode, urls: MarkdownUrls): string {
  const state = new MarkdownState(storeNodes, storeMarks, { tightLists: true, refUrl: urls.refUrl, imageUrl: urls.imageUrl })
  state.renderContent(node)
  return state.out
}

function rawMarkdown (text: string): Markup {
  return jsonToMarkup({
    type: MarkupNodeType.doc,
    content: [{ type: MarkupNodeType.markdown, content: [{ type: MarkupNodeType.text, text }] }]
  })
}

export function createMarkdownConverter (urls: MarkdownUrls): MarkdownConverter {
  const toMarkdown = (markup: Markup): string => serializeMessage(markupToJSON(markup), urls)
  return {
    toMarkdown,
    toMarkup: (markdown) => {
      if (markdown == null || markdown === '') return ''
      const markup = jsonToMarkup(parseMessageMarkdown(markdown, urls))
      return isMarkdownsEquals(markdown, toMarkdown(markup)) ? markup : rawMarkdown(markdown)
    }
  }
}
