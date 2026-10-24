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

interface NodeLike {
  type: { name: string }
  attrs: Record<string, any>
  nodeSize: number
}

interface DocLike {
  descendants: (f: (node: NodeLike, pos: number) => boolean | undefined) => void
}

/**
 * Ranges of the reference nodes pointing to the given object, in descending
 * order so that they can be deleted one by one without remapping positions.
 */
export function findReferenceRanges (doc: DocLike, id: Ref<Doc>): Array<{ from: number, to: number }> {
  const ranges: Array<{ from: number, to: number }> = []
  doc.descendants((node, pos) => {
    if (node.type.name === referenceNodeName && node.attrs.id === id) {
      ranges.push({ from: pos, to: pos + node.nodeSize })
    }
    return true
  })
  return ranges.sort((a, b) => b.from - a.from)
}

/**
 * Creating documents is allowed for workspace members (the same role the
 * "Create document" header button requires); guests can not create them,
 * even when they are allowed to edit a document they created themselves.
 */
export function canCreateSubpage (account: Account): boolean {
  return hasAccountRole(account, AccountRole.User)
}
