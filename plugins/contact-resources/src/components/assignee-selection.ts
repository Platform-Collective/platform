// SPDX-License-Identifier: EPL-2.0

/**
 * Result of picking a row in the assignee popup.
 *
 * - the picked item: assign it
 * - null: the current assignee was picked again and deselect is allowed, so clear the assignee
 * - undefined: nothing was picked (empty list), treat as cancel
 */
export function resolveAssigneeSelection<T extends { _id: string }> (
  item: T | undefined,
  selected: string | null | undefined,
  allowDeselect: boolean
): T | null | undefined {
  if (item === undefined) return undefined
  if (allowDeselect && selected != null && item._id === selected) return null
  return item
}
