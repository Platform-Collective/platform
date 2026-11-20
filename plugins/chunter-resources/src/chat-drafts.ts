// SPDX-License-Identifier: EPL-2.0
import { isEmptyMarkup } from '@hcengineering/text'

export interface ChatDraftTarget {
  key: string
  target: string
  thread: boolean
}

// Read the existing composer keys without changing the shared draft persistence API.
export function getChatDrafts (drafts: Record<string, unknown>): ChatDraftTarget[] {
  const result: ChatDraftTarget[] = []
  for (const [key, value] of Object.entries(drafts)) {
    const match = /^(.*?)_chunter:class:(ChatMessage|ThreadMessage)$/.exec(key)
    if (match === null || match[1] === '' || value === null || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }
    const draft = value as { message?: unknown, attachments?: unknown }
    if (!(typeof draft.attachments === 'number' && draft.attachments > 0) && !hasContent(draft.message)) continue
    result.push({ key, target: match[1], thread: match[2] === 'ThreadMessage' })
  }
  return result
}

function hasContent (markup: unknown): boolean {
  if (typeof markup !== 'string') return false
  try {
    return !isEmptyMarkup(markup)
  } catch {
    // A malformed local-storage entry must not break the navigator.
    return false
  }
}
