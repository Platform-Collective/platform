//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/** Key of the row of the items without an assignee. */
export const UNASSIGNED_ROW = '__unassigned__'

/** Key of the row an assignee belongs to. */
export function rowKeyOf (assignee: string | null | undefined): string {
  return typeof assignee === 'string' && assignee !== '' ? assignee : UNASSIGNED_ROW
}

/** The assignee a row stands for: the person, or null for the unassigned row. */
export function assigneeOfRow (row: string): string | null {
  return row === UNASSIGNED_ROW ? null : row
}

export interface RowInfo {
  key: string
  // Already translated; the key itself when the person is not known
  name: string
  unassigned: boolean
}

/** The rows of a workload: the people by name, the unassigned items last. */
export function orderRows (
  keys: Iterable<string>,
  nameOf: (key: string) => string | undefined,
  unassignedName: string,
  locale?: string
): RowInfo[] {
  const people: RowInfo[] = []
  let unassigned: RowInfo | undefined
  for (const key of keys) {
    if (key === UNASSIGNED_ROW) {
      unassigned = { key, name: unassignedName, unassigned: true }
      continue
    }
    const name = nameOf(key)
    people.push({ key, name: name !== undefined && name.trim() !== '' ? name : key, unassigned: false })
  }
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  people.sort((a, b) => collator.compare(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return unassigned !== undefined ? [...people, unassigned] : people
}
