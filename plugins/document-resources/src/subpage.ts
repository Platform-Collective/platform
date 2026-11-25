// SPDX-License-Identifier: EPL-2.0

import { AccountRole, type Account, type Class, type Doc, type Ref, hasAccountRole } from '@hcengineering/core'

/** Id of the "Subpage" editor command */
export const SubpageCommandId = 'document-subpage'

/** Name of the editor node used for object mentions / document links */
const referenceNodeName = 'reference'

export interface ReferenceContent {
  type: string
  attrs?: Record<string, any>
  text?: string
  content?: ReferenceContent[]
}

/**
 * Editor content that links to a document: a reference (mention) node
 * followed by a space, the same shape the "@" mention popup inserts.
 * When the target position is between blocks (e.g. the side "+" menu),
 * the link is wrapped into a paragraph of its own.
 */
export function makeReferenceContent (
  id: Ref<Doc>,
  objectclass: Ref<Class<Doc>>,
  label: string,
  inline = true
): ReferenceContent[] {
  const content: ReferenceContent[] = [
    { type: referenceNodeName, attrs: { id, objectclass, label } },
    { type: 'text', text: ' ' }
  ]
  return inline ? content : [{ type: 'paragraph', content }]
}

/** Use the same workspace role and creation permission as the navigator. */
export function canCreateSubpage (account: Account, allowed = false): boolean {
  return hasAccountRole(account, AccountRole.User) && allowed
}
