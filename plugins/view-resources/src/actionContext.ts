// SPDX-License-Identifier: EPL-2.0

import { type Doc } from '@hcengineering/core'

/**
 * Collapses a single-element array to the element, otherwise returns the original value.
 *
 * @public
 */
export function normalizeActionContext<T extends Doc> (doc: T | T[] | undefined): T | T[] | undefined {
  if (Array.isArray(doc) && doc.length === 1) {
    return doc[0]
  }
  return doc
}

export function getActionPopupValue (docs: Doc[]): Doc | Doc[] {
  return normalizeActionContext(docs) ?? []
}
