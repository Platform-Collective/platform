// SPDX-License-Identifier: EPL-2.0

export interface MentionResult {
  id: string
}

export function prependUniqueMentionResults<T extends MentionResult> (members: T[], results: T[]): T[] {
  const memberIds = new Set(members.map(({ id }) => id))
  const resultById = new Map(results.map((result) => [result.id, result]))
  return [
    ...members.map((member) => resultById.get(member.id) ?? member),
    ...results.filter(({ id }) => !memberIds.has(id))
  ]
}
