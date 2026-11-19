// SPDX-License-Identifier: EPL-2.0

import core from '@hcengineering/core'
import type { AnyAttribute } from '@hcengineering/core'
import { isEmptyMarkup } from '@hcengineering/text'

/**
 * Tells whether a value does not satisfy a required attribute: `null`/`undefined`, whitespace-only text,
 * empty markup, a non-finite number or an empty array. `0` and `false` count as filled.
 * @public
 */
export function isRequiredValueEmpty (attribute: Pick<AnyAttribute, 'type'>, value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (attribute.type._class === core.class.TypeMarkup) {
    return typeof value !== 'string' || isEmptyMarkup(value)
  }
  if (typeof value === 'string') return value.trim().length === 0
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.length === 0
  return false
}
