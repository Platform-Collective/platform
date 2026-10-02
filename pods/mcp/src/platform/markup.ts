// SPDX-License-Identifier: EPL-2.0

import { type Markup } from '@hcengineering/core'
import { jsonToMarkup, markupToJSON } from '@hcengineering/text-core'
import { markdownToMarkup, markupToMarkdown } from '@hcengineering/text-markdown'

/** Converts agent-supplied Markdown (or plain text) into Huly's stored rich-text format. */
export function toMarkup (markdown: string): Markup {
  return jsonToMarkup(markdownToMarkup(markdown))
}

/**
 * Renders stored rich text as Markdown for an agent.
 *
 * Huly stores rich text as ProseMirror JSON, which is noisy and wastes tokens.
 * Anything that is not valid markup (legacy plain text, an empty blob) is
 * returned unchanged instead of failing the tool call.
 */
export function fromMarkup (markup: string): string {
  if (markup.trim() === '') return ''
  try {
    return markupToMarkdown(markupToJSON(markup))
  } catch {
    return markup
  }
}
