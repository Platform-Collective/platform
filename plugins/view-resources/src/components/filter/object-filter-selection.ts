// SPDX-License-Identifier: EPL-2.0

import type { Doc } from '@hcengineering/core'

/**
 * Whether a value is ticked in an object filter's dropdown.
 * "Not selected" (an empty value) is stored as undefined, and comes back as null
 * once the filter was saved and reloaded, so both count as the empty value.
 */
export function isObjectFilterValueSelected (value: Doc | undefined | null, values: any[]): boolean {
  if (value == null) {
    return values.some((p) => p == null)
  }
  return values.includes(value._id)
}

/**
 * Returns the filter values after ticking or unticking one value.
 */
export function toggleObjectFilterValue (value: Doc | undefined | null, values: any[], selected: boolean): any[] {
  if (selected) {
    return values.filter((p) => (value != null ? p !== value._id : p != null))
  }
  return [...values, value != null ? value._id : undefined]
}
