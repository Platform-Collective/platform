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

/**
 * Minimal `WorkflowRule` subset used to detect duplicate pairings. The
 * editor considers both "my rules" (`space === currentSpace`) and incoming
 * rules (`linkedProject === currentSpace`), so we need both endpoints to
 * decide uniqueness.
 */
export interface SiblingRule {
  _id: Ref<WorkflowRule>
  space: Ref<Project>
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
 * not already paired with the current project in EITHER direction.
 *
 * - `localRules` are rules in `currentSpace`. One already pointing at
 *   `target._id` means we have already paired with the target.
 * - `incomingRules` are rules in other spaces pointing at `currentSpace`. One
 *   whose `space` is `target._id` means the target has already paired with
 *   us, and allowing a second pair from our side would produce two primaries
 *   on the same edge (the "incoming-only pair bypasses duplicate detection"
 *   case Michael flagged).
 *
 * Returns the matching sibling rule when the project IS already paired, so
 * the caller can keep it in the dropdown when the editor is in edit-mode on
 * that pair (the picker is disabled in edit mode, but the Dropdown still has
 * to resolve the selected id's label).
 */
export function isCandidateTarget (
  target: AuthProject,
  currentSpace: Ref<Project>,
  me: AccountUuid,
  localRules: SiblingRule[],
  incomingRules: SiblingRule[] = []
): { ok: boolean, pairedBy?: Ref<WorkflowRule> } {
  if (target._id === currentSpace) return { ok: false }
  if (target.archived === true) return { ok: false }
  if (target.restricted === true) return { ok: false }
  if (!isMemberOf(target, me)) return { ok: false }
  const already = localRules.find((r) => r.linkedProject === target._id)
  if (already !== undefined) return { ok: false, pairedBy: already._id }
  const incoming = incomingRules.find((r) => r.space === target._id)
  if (incoming !== undefined) return { ok: false, pairedBy: incoming._id }
  return { ok: true }
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
export function buildAutoMap (src: StatusLike[], dst: StatusLike[]): Record<string, Ref<IssueStatus>> {
  const out: Record<string, Ref<IssueStatus>> = {}
  for (const s of src) {
    const t = autoMatch(s, dst)
    if (t !== undefined) out[s.id] = t
  }
  return out
}

const TERMINAL_CATEGORIES = new Set<string>(['task:statusCategory:Won', 'task:statusCategory:Lost'])

/**
 * Build the default `allowedLoops` for a target status list. Terminal
 * categories (Won/Lost) stay one-way to prevent accidental resurrection of
 * closed work. Every non-terminal pair `(i, j)` with `i > j` by rank is an
 * allowed backward move.
 */
export function buildAllowedLoops (dstStatuses: StatusLike[]): Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }> {
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

/**
 * Pair-level classification used by the Rules panel. A pair's "primary"
 * endpoint is the side whose rule carries `linkKind === 'subIssue'`; the
 * other side (`parentIssue`) is the reverse endpoint. Opening the editor
 * from the reverse endpoint has to be routed back to the primary side -
 * saving from there would otherwise flip the mirrored rule's `linkKind`
 * (producing two `parentIssue` rules on the same edge, Michael's rev-1
 * reproducer).
 *
 * The two input arrays are:
 *   - `localRules`: every rule stored in `currentSpace` (space === current)
 *   - `incomingRules`: every rule from other spaces whose `linkedProject`
 *      is `currentSpace`
 */
export interface PairClassifierRule {
  _id: Ref<WorkflowRule>
  space: Ref<Project>
  linkedProject: Ref<Project>
  linkKind: 'subIssue' | 'parentIssue'
}
export interface PrimaryPairSummary {
  kind: 'primary'
  other: Ref<Project>
  forwardId: Ref<WorkflowRule>
  reverseId: Ref<WorkflowRule> | undefined
}
export interface IncomingPairSummary {
  kind: 'incoming'
  other: Ref<Project>
  inboundId: Ref<WorkflowRule>
  hasReverseHere: boolean
}

export function classifyPairings (
  currentSpace: Ref<Project>,
  localRules: PairClassifierRule[],
  incomingRules: PairClassifierRule[]
): { primary: PrimaryPairSummary[], incoming: IncomingPairSummary[] } {
  const primary: PrimaryPairSummary[] = []
  for (const r of localRules) {
    if (r.linkKind !== 'subIssue') continue
    const reverse = incomingRules.find(
      (rr) => rr.space === r.linkedProject && rr.linkedProject === currentSpace && rr.linkKind === 'parentIssue'
    )
    primary.push({ kind: 'primary', other: r.linkedProject, forwardId: r._id, reverseId: reverse?._id })
  }
  const incoming: IncomingPairSummary[] = []
  const primaryOthers = new Set(primary.map((p) => p.other as string))
  for (const r of localRules) {
    if (r.linkKind === 'subIssue') continue
    incoming.push({ kind: 'incoming', other: r.linkedProject, inboundId: r._id, hasReverseHere: true })
  }
  for (const r of incomingRules) {
    if (primaryOthers.has(r.space)) continue
    const mirrored = localRules.some((lr) => lr.linkedProject === r.space && lr.linkKind !== 'subIssue')
    if (mirrored) continue
    incoming.push({ kind: 'incoming', other: r.space, inboundId: r._id, hasReverseHere: false })
  }
  return { primary, incoming }
}

/**
 * Decide the `allowedLoops` to persist on save. Preserve the already-stored
 * list across pair-level edits (rename, retoggle bidirectionality, remap
 * statuses) unless the user explicitly asked for a reset OR the stored
 * value is missing on the rule.
 *
 * An EMPTY array is a valid persisted state: clearing every loop in the
 * Advanced editor is how a user forbids all backward moves for a pair.
 * Earlier revisions treated `stored.length === 0` as permission to
 * regenerate the defaults, which silently restored "InProgress -> Backlog"
 * on the next pair-level edit without Reset (Michael's round-3 P2
 * reproduction). The guard is now `existingLoops === undefined` so:
 * - `undefined` on the rule (first save / rows written before the field
 *   existed): regenerate defaults.
 * - `[]` on the rule: preserve `[]` and keep all backward moves forbidden.
 * - any populated array: preserve as-is.
 * - `opts.isCreate`: regenerate defaults for the new rule.
 * - `opts.resetRequested`: regenerate defaults after the user clicks
 *   Reset.
 */
export function resolveAllowedLoops (
  existingLoops: Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }> | undefined,
  dstStatuses: StatusLike[],
  opts: { isCreate: boolean, resetRequested: boolean }
): Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }> {
  const shouldRegen = opts.isCreate || opts.resetRequested || existingLoops === undefined
  return shouldRegen ? buildAllowedLoops(dstStatuses) : existingLoops
}

/**
 * Link-kind coherence for the pairing wizard's `save`. The primary endpoint
 * is always `subIssue`; the reverse is always `parentIssue`. Fix this at the
 * client to defend against stale stored values and against a future refactor
 * in which the editor opens from either side - the panel refuses to open the
 * editor from the reverse endpoint, and this function enforces the matching
 * invariant at persistence time.
 */
export function resolvePairLinkKinds (): { forward: 'subIssue', reverse: 'parentIssue' } {
  return { forward: 'subIssue', reverse: 'parentIssue' }
}

/**
 * Can the current actor edit (toggle / delete / save) BOTH sides of a
 * bidirectional pair? Toggle writes to forward.space AND reverse.space;
 * if the actor is a non-member of the linked project, the server authz
 * check on the reverse write rejects and the pair ends up half-flipped.
 * Hiding the action is cleaner than recovering from a partial write.
 */
export function canEditPair (
  current: AuthProject | undefined,
  other: AuthProject | undefined,
  me: AccountUuid,
  hasReverse: boolean
): boolean {
  if (!isMemberOf(current, me)) return false
  if (!hasReverse) return true
  return isMemberOf(other, me)
}

/**
 * Aggregate statuses across every TaskType declared on a ProjectType.
 * Previously only the first TaskType was loaded, which meant:
 *   - multi-type projects could not map or loop against later types'
 *     statuses;
 *   - stored loops and mappings referencing those statuses silently
 *     failed `loopsValid` and were treated as stale.
 * Deduplicate by status id - a TaskType can theoretically repeat an
 * `IssueStatus` reference, and the editor only needs it once.
 */
export function aggregateStatusesAcrossTaskTypes (
  tasks: Array<{ statuses: Array<Ref<IssueStatus>> }>,
  resolve: (id: Ref<IssueStatus>) => StatusLike | undefined
): StatusLike[] {
  const out: StatusLike[] = []
  const seen = new Set<string>()
  for (const tt of tasks) {
    for (const sid of tt.statuses ?? []) {
      if (seen.has(sid)) continue
      seen.add(sid)
      const resolved = resolve(sid)
      if (resolved !== undefined) out.push(resolved)
    }
  }
  return out
}

/**
 * Compute the apply-scope key for a pairing create / edit. The scope must
 * key on the UNORDERED pair so an A->B save and a B->A save from two
 * editors serialize against the same key. `ApplyTxMiddleware` also skips
 * predicate evaluation entirely when `scope` is undefined, so the scope
 * must be a non-empty string.
 *
 * This is a pure helper so `pure.spec.ts` can prove the unordered-key
 * invariant without a DOM.
 */
export function computePairApplyScope (endpointA: string, endpointB: string): string {
  const endpoints = [endpointA, endpointB].sort()
  return `workflow-rules.pair:${JSON.stringify(endpoints)}`
}

/**
 * Shape of the duplicate-prevention `notMatch` filters an editor must
 * attach to the apply when a new rule is being inserted. The filters are
 * emitted per-direction, so edits that only add one side (e.g. turning on
 * bidirectionality for an existing one-way pair) still guard that side.
 *
 * - `createForward` flags whether the apply creates the forward rule
 *   (A -> B). When true, add a filter that rejects the apply if any
 *   forward rule already exists between the same ordered pair.
 * - `createReverse` flags whether the apply creates the reverse rule
 *   (B -> A). Same shape, swapped endpoints.
 *
 * Returns the empty array when neither direction is being created
 * (pure edit of existing rules). The caller attaches each filter with
 * `ops.notMatch(WorkflowRule, filter)`.
 */
export function computeDuplicateNotMatchFilters (
  currentSpace: string,
  linkedProject: string,
  opts: { createForward: boolean, createReverse: boolean }
): Array<{ space: string, linkedProject: string }> {
  const filters: Array<{ space: string, linkedProject: string }> = []
  if (opts.createForward) {
    filters.push({ space: currentSpace, linkedProject })
  }
  if (opts.createReverse) {
    filters.push({ space: linkedProject, linkedProject: currentSpace })
  }
  return filters
}
