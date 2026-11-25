// SPDX-License-Identifier: EPL-2.0

import { type Doc } from '@hcengineering/core'
import { type ViewActionInput } from '@hcengineering/view'

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

export function filterActionsByInput<T extends { input: ViewActionInput }> (
  actions: readonly T[],
  doc: Doc | Doc[]
): T[] {
  const input = (['none'] as ViewActionInput[])
    .concat(Array.isArray(doc) && doc.length > 0 ? ['selection', 'any'] : [])
    .concat(!Array.isArray(doc) || doc.length === 1 ? ['focus', 'any'] : [])

  return actions.filter((it) => input.includes(it.input))
}
