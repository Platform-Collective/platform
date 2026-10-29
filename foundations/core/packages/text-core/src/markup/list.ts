// SPDX-License-Identifier: EPL-2.0

import type { Attrs } from './model'

/**
 * Read the editor's start attribute, using legacy order only when start is nullish.
 * Accept safe integers and signed decimal integer strings (including zero).
 * A missing or invalid selected value defaults to 1, even when order is valid.
 * @public
 */
export function getOrderedListStart (attrs?: Attrs): number {
  const value = attrs?.start ?? attrs?.order
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim()))) {
    return 1
  }

  const start = Number(value)
  return Number.isSafeInteger(start) ? start : 1
}
