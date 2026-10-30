// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Pure helpers used by the Svelte editors. Kept out of the components so a
// Jest spec can exercise them without a Svelte / DOM runtime.

import { type AccountUuid, type Ref } from '@hcengineering/core'
import { type IssueStatus, type Project } from '@hcengineering/tracker'
import { type WorkflowRule } from '@hcengineering/workflow-rules'

/** Minimal `Project` subset the UI needs for the authorization gate. */
export interface AuthProject {
  _id: Ref<Project>
  members?: AccountUuid[]
  owners?: AccountUuid[]
  archived?: boolean
  // Platform-core marks TypedSpace with `restricted: true`.
  restricted?: boolean
}

/** Minimal `WorkflowRule` subset used to detect duplicate pairings. */
export interface SiblingRule {
  _id: Ref<WorkflowRule>
  linkedProject: Ref<Project>
}

/**
 * Is the current actor a member or owner of this project? Non-members never
 * see editor controls - the server would refuse to mirror a rule they
 * authored anyway.
 */
export function isMemberOf (p: AuthProject | undefined, me: AccountUuid): boolean {
  if (p === undefined) return false
  const members = Array.isArray(p.members) ? p.members : []
  const owners = Array.isArray(p.owners) ? p.owners : []
  return members.includes(me) || owners.includes(me)
}

/**
 * Can the current actor pair the current project with this target? The target
 * must be writable (not archived, not restricted, actor is member/owner) and
 * not already paired with the current project. Returns the matching sibling
 * rule when the project IS already paired, so the caller can keep it in the
 * dropdown when the editor is in edit-mode on that pair.
 */
export function isCandidateTarget (
  target: AuthProject,
  currentSpace: Ref<Project>,
  me: AccountUuid,
  siblingRules: SiblingRule[]
): { ok: boolean, pairedBy?: Ref<WorkflowRule> } {
  if (target._id === currentSpace) return { ok: false }
  if (target.archived === true) return { ok: false }
  if (target.restricted === true) return { ok: false }
  if (!isMemberOf(target, me)) return { ok: false }
  const already = siblingRules.find((r) => r.linkedProject === target._id)
  return already === undefined ? { ok: true } : { ok: false, pairedBy: already._id }
}

/** Minimal status row the UI consumes to render the mapping table. */
export interface StatusLike {
  id: Ref<IssueStatus>
  name: string
  category: string | undefined
}

/**
 * Auto-match a source status against a list of target statuses. Prefers a
 * category match (semantic hint, survives renames); within a category
 * prefers a case-insensitive name match; falls back to the first category
 * match; finally falls back to a cross-category name match.
 */
export function autoMatch (src: StatusLike, targets: StatusLike[]): Ref<IssueStatus> | undefined {
  const sameCategory = targets.filter((t) => t.category === src.category)
  if (sameCategory.length > 0) {
    const sameName = sameCategory.find((t) => t.name.toLowerCase() === src.name.toLowerCase())
    return (sameName ?? sameCategory[0]).id
  }
  const nameOnly = targets.find((t) => t.name.toLowerCase() === src.name.toLowerCase())
  return nameOnly?.id
}

/** Build the default forward map by auto-matching every source status. */
export function buildAutoMap (
  src: StatusLike[],
  dst: StatusLike[]
): Record<string, Ref<IssueStatus>> {
  const out: Record<string, Ref<IssueStatus>> = {}
  for (const s of src) {
    const t = autoMatch(s, dst)
    if (t !== undefined) out[s.id] = t
  }
  return out
}

const TERMINAL_CATEGORIES = new Set<string>([
  'task:statusCategory:Won',
  'task:statusCategory:Lost'
])

/**
 * Build the default `allowedLoops` for a target status list. Terminal
 * categories (Won/Lost) stay one-way to prevent accidental resurrection of
 * closed work. Every non-terminal pair `(i, j)` with `i > j` by rank is an
 * allowed backward move.
 */
export function buildAllowedLoops (
  dstStatuses: StatusLike[]
): Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }> {
  const nonTerminal = dstStatuses.filter((s) => s.category === undefined || !TERMINAL_CATEGORIES.has(s.category))
  const loops: Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }> = []
  for (let i = 0; i < nonTerminal.length; i++) {
    for (let j = 0; j < i; j++) {
      loops.push({ from: nonTerminal[i].id, to: nonTerminal[j].id })
    }
  }
  return loops
}

/**
 * Decide whether an `existingForward` rule can be edited from the given
 * current project. The editor is strictly single-primary: a pair is only
 * editable from the project that holds its forward rule. Opening the editor
 * on the linked side would silently flip `linkKind` and corrupt the pair.
 */
export function canEditFromHere (
  existingForward: Pick<WorkflowRule, 'space'> | undefined,
  currentSpace: Ref<Project>
): boolean {
  if (existingForward === undefined) return true
  return existingForward.space === currentSpace
}

/**
 * Reject loops whose endpoints are equal (identity move) or that reference
 * a status that is not in the target TaskType. The server guard would
 * ignore those anyway, but keeping them in the stored doc leaks stale
 * references and makes the Advanced editor's state confusing.
 */
export function loopsValid (
  loops: Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }>,
  targetStatusIds: Set<Ref<IssueStatus>>
): boolean {
  return loops.every((l) => l.from !== l.to && targetStatusIds.has(l.from) && targetStatusIds.has(l.to))
}
