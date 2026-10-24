// SPDX-License-Identifier: EPL-2.0

import type { Doc, Markup } from '@hcengineering/core'
import { jsonToMarkup, markupToJSON, markLink, nodeDoc, nodeParagraph, nodeText } from '@hcengineering/text-core'
import type { MarkupNode } from '@hcengineering/text-core'
import type { ToDo } from '@hcengineering/time'

export interface MessageToDoSource extends Doc {
  message: Markup
}

export function isMessageToDoSource (object?: Doc): object is MessageToDoSource {
  return object !== undefined && 'message' in object && typeof object.message === 'string'
}

/** Build a plain first-line title and a clickable message link without copying the message body. */
export function getMessageToDoContent (
  message: Markup,
  link: string,
  fallback: string
): Pick<ToDo, 'title' | 'description'> {
  function getText (node: MarkupNode): string {
    if (node.type === 'hardBreak') return '\n'
    if (node.type === 'reference') return String(node.attrs?.label ?? '')
    const text = node.text ?? (node.content ?? []).map(getText).join('')
    return ['paragraph', 'heading', 'codeBlock'].includes(node.type) ? `${text}\n` : text
  }

  const title = getText(markupToJSON(message)).trim().split(/\r?\n/, 1)[0].trim() || fallback
  return {
    title,
    description: jsonToMarkup(nodeDoc(nodeParagraph(markLink({ href: link, title }, nodeText(link)))))
  }
}

/**
 * Append the chosen time to the title. The planner list only shows the due date, so this keeps the
 * selected time visible without a schema change.
 */
export function withPlannedTime (title: string, dueDate: number, locale?: string): string {
  const time = new Date(dueDate).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return `${title} (${time})`
}
