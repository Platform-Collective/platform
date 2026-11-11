//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { type Attachment } from '@hcengineering/attachment'
import { type Doc, type Markup, type Ref } from '@hcengineering/core'
import { areEqualMarkups } from '@hcengineering/text'

export interface DraftContent {
  message: Markup
  attachments?: number
  /** Attachments the input shows; when both sides list them, they are compared instead of the count. */
  attachmentIds?: readonly string[]
}

function sameAttachments (a: DraftContent, b: DraftContent): boolean {
  if (a.attachmentIds !== undefined && b.attachmentIds !== undefined) {
    const ids = new Set(a.attachmentIds)
    return ids.size === new Set(b.attachmentIds).size && b.attachmentIds.every((id) => ids.has(id))
  }
  return (a.attachments ?? 0) === (b.attachments ?? 0)
}

function sameContent (a: DraftContent, b: DraftContent): boolean {
  return areEqualMarkups(a.message, b.message) && sameAttachments(a, b)
}

/**
 * An input's shared draft was sent from another input showing the same draft.
 * Decide whether this input still holds something the user has not sent.
 *
 * Only content changed in this input since it loaded the draft counts as unsent:
 * a copy that was never edited here is stale and is dropped, even when the sent
 * message differs from it (it was edited further in the other input).
 *
 * Attachments are compared by their IDs when both sides list them (replacing one
 * file with another is a change), otherwise by their count. The created message
 * only has a count.
 *
 * @param current - what this input shows now
 * @param loaded - what this input showed when it loaded the draft (or was last cleared or renewed)
 * @param sent - the message that was created
 */
export function keepsUnsentDraft (current: DraftContent, loaded: DraftContent, sent: DraftContent): boolean {
  return !sameContent(current, sent) && !sameContent(current, loaded)
}

/**
 * Keep the unsent content of an input under a new message ID after another input sent the shared draft.
 *
 * Files are moved to the new ID. Files listed in `excluded` are dropped: those already sent with the
 * old message, and those that came with the loaded copy of the draft (they were sent, or removed and
 * deleted, by the other input).
 *
 * @returns the renewed draft, the baseline to compare later sends against, and the files to keep
 */
export function renewSharedDraft<T extends DraftContent & { _id: Ref<Doc> }> (
  current: T,
  attachments: ReadonlyMap<Ref<Attachment>, Attachment>,
  nextId: T['_id'],
  excluded: ReadonlySet<Ref<Attachment>> = new Set()
): { draft: T, loaded: T, attachments: Map<Ref<Attachment>, Attachment> } {
  const keptAttachments = new Map<Ref<Attachment>, Attachment>()
  for (const [id, attachment] of attachments) {
    if (!excluded.has(id)) {
      keptAttachments.set(id, { ...attachment, attachedTo: nextId })
    }
  }
  const draft = { ...current, _id: nextId, attachments: keptAttachments.size }
  return {
    draft,
    loaded: { ...draft, attachmentIds: Array.from(keptAttachments.keys()) },
    attachments: keptAttachments
  }
}
