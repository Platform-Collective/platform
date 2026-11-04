// SPDX-License-Identifier: EPL-2.0

export interface MentionSearchItem {
  num: number
  item: { id: string }
}

/**
 * Builds one employee section with the space members first, followed by the full-text employees
 * who are not members, and keeps the other categories after it in their order. The section is
 * numbered from 0 again, so it gets exactly one category header.
 */
export function mergeMemberResults<T extends MentionSearchItem> (
  members: T[],
  results: T[],
  isEmployee: (item: T) => boolean
): T[] {
  if (members.length === 0) return results
  const employees = results.filter(isEmployee)
  const employeeById = new Map(employees.map((it) => [it.item.id, it]))
  const memberIds = new Set(members.map((it) => it.item.id))
  const section = [
    ...members.map((member) => employeeById.get(member.item.id) ?? member),
    ...employees.filter((it) => !memberIds.has(it.item.id))
  ].map((it, num) => ({ ...it, num }))
  return [...section, ...results.filter((it) => !isEmployee(it))]
}
