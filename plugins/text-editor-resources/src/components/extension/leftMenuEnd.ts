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

import { type Node } from '@tiptap/pm/model'
import { type Transaction } from '@tiptap/pm/state'

export const endZoneClassName = 'tiptap-left-menu-end-zone'

export function createEndZone (height: number): HTMLElement {
  // The absolute hover area must not add permanent vertical space after the document.
  const zone = document.createElement('div')
  zone.classList.add(endZoneClassName)
  zone.contentEditable = 'false'
  zone.style.position = 'absolute'
  zone.style.width = '100%'
  zone.style.height = `${height}px`
  zone.style.lineHeight = `${height}px`
  return zone
}

/**
 * The left menu inserts content before the hovered block, so an empty trailing
 * paragraph is the slot for inserting at the end of the document.
 */
export function hasInsertSlotAtEnd (doc: Node): boolean {
  const lastChild = doc.lastChild
  return lastChild !== null && lastChild.type.name === 'paragraph' && lastChild.content.size === 0
}

/**
 * Makes sure the document ends with an empty paragraph, appending one to `tr` if needed,
 * and returns the position before that paragraph to be used as the insert position.
 */
export function prepareInsertAtEnd (tr: Transaction): number {
  const { doc } = tr
  const lastChild = doc.lastChild
  if (lastChild !== null && hasInsertSlotAtEnd(doc)) {
    return doc.content.size - lastChild.nodeSize
  }

  const pos = doc.content.size
  tr.insert(pos, doc.type.schema.nodes.paragraph.create())
  return pos
}
