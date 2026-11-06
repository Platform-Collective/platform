// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Tests for the editor's pure helpers. Every helper here is called from an
// actual Svelte component path - NO shadow re-implementation. Covers:
//   - the five regression cases MichaelUray flagged in the #244 rev-1
//     review (loops overwritten, opposite-endpoint corruption, incoming
//     duplicate bypass, first-TaskType-only, cross-project auth);
//   - the earlier P1 regressions (primary-only edit guard, candidate
//     filter, auto-match, allowed-loops default, loop validation).
//
// Component wiring:
//   - PairProjectEditor.svelte
//       * candidateProjects -> isCandidateTarget
//       * statusesOf        -> aggregateStatusesAcrossTaskTypes
//       * save()            -> resolveAllowedLoops + resolvePairLinkKinds
//   - WorkflowRulesPanel.svelte
//       * primary/incoming  -> classifyPairings
//       * canEditPair       -> canEditPair (pure)
//   - EditWorkflowRule.svelte
//       * statusesOf        -> aggregateStatusesAcrossTaskTypes (same path)

import { type AccountUuid, type Ref } from '@hcengineering/core'
import { type IssueStatus, type Project } from '@hcengineering/tracker'
import { type WorkflowRule } from '@hcengineering/workflow-rules'

import {
  aggregateStatusesAcrossTaskTypes,
  autoMatch,
  buildAllowedLoops,
  buildAutoMap,
  canEditFromHere,
  canEditPair,
  classifyPairings,
  isCandidateTarget,
  isMemberOf,
  loopsValid,
  resolveAllowedLoops,
  resolvePairLinkKinds,
  type AuthProject,
  type PairClassifierRule,
  type SiblingRule,
  type StatusLike
} from '../pure'

const ME = 'acc-me' as AccountUuid
const OTHER = 'acc-other' as AccountUuid

const PROJ_A = 'proj:a' as Ref<Project>
const PROJ_B = 'proj:b' as Ref<Project>
const PROJ_C = 'proj:c' as Ref<Project>

const RULE_1 = 'rule:1' as Ref<WorkflowRule>
const RULE_2 = 'rule:2' as Ref<WorkflowRule>
const RULE_3 = 'rule:3' as Ref<WorkflowRule>

function proj (over: Partial<AuthProject> = {}): AuthProject {
  return { _id: PROJ_B, members: [ME], owners: [], ...over }
}

describe('isMemberOf', () => {
  it('accepts a listed member', () => {
    expect(isMemberOf({ _id: PROJ_A, members: [ME] }, ME)).toBe(true)
  })

  it('accepts a listed owner even when not in members', () => {
    expect(isMemberOf({ _id: PROJ_A, members: [OTHER], owners: [ME] }, ME)).toBe(true)
  })

  it('refuses a non-member non-owner', () => {
    expect(isMemberOf({ _id: PROJ_A, members: [OTHER] }, ME)).toBe(false)
  })

  it('refuses when the project is undefined', () => {
    expect(isMemberOf(undefined, ME)).toBe(false)
  })

  it('tolerates missing members / owners arrays', () => {
    expect(isMemberOf({ _id: PROJ_A }, ME)).toBe(false)
  })
})

describe('isCandidateTarget', () => {
  it('allows a writable, un-paired target (no incoming either)', () => {
    expect(isCandidateTarget(proj(), PROJ_A, ME, [], []).ok).toBe(true)
  })

  it('refuses self-pairing', () => {
    expect(isCandidateTarget(proj({ _id: PROJ_A }), PROJ_A, ME, [], []).ok).toBe(false)
  })

  it('refuses an archived target', () => {
    expect(isCandidateTarget(proj({ archived: true }), PROJ_A, ME, [], []).ok).toBe(false)
  })

  it('refuses a restricted TypedSpace', () => {
    expect(isCandidateTarget(proj({ restricted: true }), PROJ_A, ME, [], []).ok).toBe(false)
  })

  it('refuses a project the actor is not a member of', () => {
    expect(isCandidateTarget(proj({ members: [OTHER] }), PROJ_A, ME, [], []).ok).toBe(false)
  })

  it('refuses a project already paired with the current one (local side)', () => {
    const sibling: SiblingRule = { _id: RULE_1, space: PROJ_A, linkedProject: PROJ_B }
    const res = isCandidateTarget(proj(), PROJ_A, ME, [sibling], [])
    expect(res.ok).toBe(false)
    expect(res.pairedBy).toBe(RULE_1)
  })

  it('refuses a project that ALREADY pairs with us from its side (incoming duplicate)', () => {
    // Regression for Michael's rev-1 #3: A->B exists in A as a primary.
    // From B's editor, picking A must be refused, otherwise B creates a
    // second primary and both ends claim the (A, B) edge.
    const incoming: SiblingRule = { _id: RULE_2, space: PROJ_A, linkedProject: PROJ_B }
    const res = isCandidateTarget(
      // we are in B, offering A as target
      { _id: PROJ_A, members: [ME] },
      PROJ_B,
      ME,
      [],
      [incoming]
    )
    expect(res.ok).toBe(false)
    expect(res.pairedBy).toBe(RULE_2)
  })

  it('refuses other targets when some are already paired', () => {
    const sibling: SiblingRule = { _id: RULE_1, space: PROJ_A, linkedProject: PROJ_C }
    expect(isCandidateTarget(proj({ _id: PROJ_B }), PROJ_A, ME, [sibling], []).ok).toBe(true)
    expect(isCandidateTarget(proj({ _id: PROJ_C }), PROJ_A, ME, [sibling], []).ok).toBe(false)
  })
})

const s = (over: Partial<StatusLike> & { name: string, category?: string }): StatusLike => ({
  id: (`s:${over.name}:${over.category ?? '-'}`) as Ref<IssueStatus>,
  category: over.category,
  ...over
})

describe('autoMatch', () => {
  it('prefers category + exact name match', () => {
    const src = s({ name: 'Review', category: 'task:statusCategory:Active' })
    const t1 = s({ name: 'review', category: 'task:statusCategory:Active' })
    const t2 = s({ name: 'In progress', category: 'task:statusCategory:Active' })
    expect(autoMatch(src, [t2, t1])).toBe(t1.id)
  })

  it('falls back to the first same-category target when name differs', () => {
    const src = s({ name: 'Design', category: 'task:statusCategory:Active' })
    const t1 = s({ name: 'In progress', category: 'task:statusCategory:Active' })
    const t2 = s({ name: 'Review', category: 'task:statusCategory:Active' })
    expect(autoMatch(src, [t1, t2])).toBe(t1.id)
  })

  it('falls back to name across categories when no category match exists', () => {
    const src = s({ name: 'Backlog', category: 'task:statusCategory:UnStarted' })
    const t1 = s({ name: 'Backlog', category: 'task:statusCategory:ToDo' })
    expect(autoMatch(src, [t1])).toBe(t1.id)
  })

  it('returns undefined when nothing matches', () => {
    const src = s({ name: 'Alpha', category: 'task:statusCategory:Won' })
    const t1 = s({ name: 'Omega', category: 'task:statusCategory:Lost' })
    expect(autoMatch(src, [t1])).toBeUndefined()
  })
})

describe('buildAutoMap', () => {
  it('maps each source status that has a match', () => {
    const src: StatusLike[] = [
      s({ name: 'Backlog', category: 'task:statusCategory:UnStarted' }),
      s({ name: 'Done', category: 'task:statusCategory:Won' })
    ]
    const dst: StatusLike[] = [
      s({ name: 'Backlog', category: 'task:statusCategory:UnStarted' }),
      s({ name: 'Done', category: 'task:statusCategory:Won' })
    ]
    const map = buildAutoMap(src, dst)
    expect(map[src[0].id]).toBe(dst[0].id)
    expect(map[src[1].id]).toBe(dst[1].id)
  })

  it('omits sources with no match', () => {
    const src: StatusLike[] = [s({ name: 'Only here', category: 'task:statusCategory:Active' })]
    const dst: StatusLike[] = []
    const map = buildAutoMap(src, dst)
    expect(Object.keys(map)).toHaveLength(0)
  })
})

describe('buildAllowedLoops', () => {
  const nonTerminals: StatusLike[] = [
    s({ name: 'Backlog', category: 'task:statusCategory:UnStarted' }),
    s({ name: 'In Progress', category: 'task:statusCategory:Active' }),
    s({ name: 'Review', category: 'task:statusCategory:Active' })
  ]

  it('generates every pair (i>j) between non-terminal statuses', () => {
    const loops = buildAllowedLoops(nonTerminals)
    // 3 non-terminals -> (3*2)/2 = 3 pairs: (ip->backlog), (review->backlog), (review->ip)
    expect(loops).toHaveLength(3)
    const pairs = new Set(loops.map((l) => `${String(l.from)}->${String(l.to)}`))
    expect(pairs).toContain(`${String(nonTerminals[1].id)}->${String(nonTerminals[0].id)}`)
    expect(pairs).toContain(`${String(nonTerminals[2].id)}->${String(nonTerminals[0].id)}`)
    expect(pairs).toContain(`${String(nonTerminals[2].id)}->${String(nonTerminals[1].id)}`)
  })

  it('excludes terminal (Won/Lost) statuses so closed work stays closed', () => {
    const withTerminal = [
      ...nonTerminals,
      s({ name: 'Done', category: 'task:statusCategory:Won' }),
      s({ name: 'Cancelled', category: 'task:statusCategory:Lost' })
    ]
    const loops = buildAllowedLoops(withTerminal)
    const touchesTerminal = loops.some((l) => String(l.from).includes('Done') || String(l.to).includes('Done'))
    expect(touchesTerminal).toBe(false)
  })

  it('returns an empty list when nothing is non-terminal', () => {
    const onlyTerminal = [
      s({ name: 'Done', category: 'task:statusCategory:Won' }),
      s({ name: 'Lost', category: 'task:statusCategory:Lost' })
    ]
    expect(buildAllowedLoops(onlyTerminal)).toHaveLength(0)
  })
})

describe('canEditFromHere', () => {
  it('allows the create path (no existing rule)', () => {
    expect(canEditFromHere(undefined, PROJ_A)).toBe(true)
  })

  it('allows editing when the forward rule is in the current project (the primary side)', () => {
    expect(canEditFromHere({ space: PROJ_A as Ref<Project> }, PROJ_A)).toBe(true)
  })

  it('refuses editing when the forward rule is in another project (opened from the linked side)', () => {
    // This is the "editing from the opposite endpoint" case Michael flagged.
    expect(canEditFromHere({ space: PROJ_B as Ref<Project> }, PROJ_A)).toBe(false)
  })
})

describe('loopsValid', () => {
  const S1 = 's1' as Ref<IssueStatus>
  const S2 = 's2' as Ref<IssueStatus>
  const SG = 's-ghost' as Ref<IssueStatus>
  const known = new Set([S1, S2])

  it('accepts loops whose endpoints are distinct and known', () => {
    expect(loopsValid([{ from: S2, to: S1 }], known)).toBe(true)
  })

  it('rejects loops with equal endpoints', () => {
    expect(loopsValid([{ from: S1, to: S1 }], known)).toBe(false)
  })

  it('rejects loops referencing a status not in the target TaskType', () => {
    expect(loopsValid([{ from: S2, to: SG }], known)).toBe(false)
    expect(loopsValid([{ from: SG, to: S1 }], known)).toBe(false)
  })

  it('accepts the empty loop list', () => {
    expect(loopsValid([], known)).toBe(true)
  })
})

describe('resolveAllowedLoops', () => {
  // Backs the "custom loops are still overwritten" regression (rev-1 #1).
  const dst: StatusLike[] = [
    s({ name: 'Backlog', category: 'task:statusCategory:UnStarted' }),
    s({ name: 'In Progress', category: 'task:statusCategory:Active' })
  ]
  const existing = [{ from: dst[1].id, to: dst[0].id }, { from: dst[0].id, to: dst[1].id }]

  it('preserves the stored loops on edit when no reset was requested', () => {
    const got = resolveAllowedLoops(existing, dst, { isCreate: false, resetRequested: false })
    expect(got).toBe(existing)
  })

  it('regenerates when the user explicitly resets', () => {
    const got = resolveAllowedLoops(existing, dst, { isCreate: false, resetRequested: true })
    // Default has 1 pair (i>j) between two non-terminal statuses.
    expect(got).toHaveLength(1)
    expect(got).not.toBe(existing)
  })

  it('regenerates on create (no existing loops to preserve)', () => {
    const got = resolveAllowedLoops(undefined, dst, { isCreate: true, resetRequested: false })
    expect(got).toHaveLength(1)
  })

  it('regenerates when the stored list is empty (nothing custom to preserve)', () => {
    const got = resolveAllowedLoops([], dst, { isCreate: false, resetRequested: false })
    expect(got).toHaveLength(1)
  })
})

describe('resolvePairLinkKinds', () => {
  // Backs the "opposite-endpoint editing corrupts a pair" regression (rev-1
  // #2). Forward is ALWAYS subIssue, reverse is ALWAYS parentIssue - a save
  // from any endpoint must not flip them.
  it('always returns subIssue forward and parentIssue reverse', () => {
    const got = resolvePairLinkKinds()
    expect(got).toEqual({ forward: 'subIssue', reverse: 'parentIssue' })
  })
})

describe('classifyPairings', () => {
  // Backs the pair classification used by the Rules panel. The primary
  // endpoint is the subIssue side; the reverse (parentIssue) side must be
  // routed to the primary project to edit.

  it('a local subIssue rule with a matching reverse in the other project is primary', () => {
    const local: PairClassifierRule[] = [
      { _id: RULE_1, space: PROJ_A, linkedProject: PROJ_B, linkKind: 'subIssue' }
    ]
    const incoming: PairClassifierRule[] = [
      { _id: RULE_2, space: PROJ_B, linkedProject: PROJ_A, linkKind: 'parentIssue' }
    ]
    const got = classifyPairings(PROJ_A, local, incoming)
    expect(got.primary).toHaveLength(1)
    expect(got.incoming).toHaveLength(0)
    expect(got.primary[0].forwardId).toBe(RULE_1)
    expect(got.primary[0].reverseId).toBe(RULE_2)
    expect(got.primary[0].other).toBe(PROJ_B)
  })

  it('a local parentIssue rule is INCOMING, not primary (reverse endpoint)', () => {
    // Michael's rev-1 reproducer: opening project B which stores the
    // parentIssue rule must classify it as incoming so the editor is NOT
    // offered here.
    const local: PairClassifierRule[] = [
      { _id: RULE_2, space: PROJ_B, linkedProject: PROJ_A, linkKind: 'parentIssue' }
    ]
    const incoming: PairClassifierRule[] = [
      { _id: RULE_1, space: PROJ_A, linkedProject: PROJ_B, linkKind: 'subIssue' }
    ]
    const got = classifyPairings(PROJ_B, local, incoming)
    expect(got.primary).toHaveLength(0)
    expect(got.incoming).toHaveLength(1)
    expect(got.incoming[0].inboundId).toBe(RULE_2)
    expect(got.incoming[0].hasReverseHere).toBe(true)
    expect(got.incoming[0].other).toBe(PROJ_A)
  })

  it('a pure one-way inbound rule (no local counterpart) is incoming', () => {
    const local: PairClassifierRule[] = []
    const incoming: PairClassifierRule[] = [
      { _id: RULE_3, space: PROJ_C, linkedProject: PROJ_A, linkKind: 'subIssue' }
    ]
    const got = classifyPairings(PROJ_A, local, incoming)
    expect(got.primary).toHaveLength(0)
    expect(got.incoming).toHaveLength(1)
    expect(got.incoming[0].hasReverseHere).toBe(false)
  })

  it('does not double-count a bidirectional edge (reverse here + incoming)', () => {
    // We're in B. The parentIssue rule lives here; the matching subIssue
    // rule is incoming. Only one incoming entry should surface.
    const local: PairClassifierRule[] = [
      { _id: RULE_2, space: PROJ_B, linkedProject: PROJ_A, linkKind: 'parentIssue' }
    ]
    const incoming: PairClassifierRule[] = [
      { _id: RULE_1, space: PROJ_A, linkedProject: PROJ_B, linkKind: 'subIssue' }
    ]
    const got = classifyPairings(PROJ_B, local, incoming)
    expect(got.incoming).toHaveLength(1)
  })

  it('does not treat a local subIssue rule as its own incoming', () => {
    const local: PairClassifierRule[] = [
      { _id: RULE_1, space: PROJ_A, linkedProject: PROJ_B, linkKind: 'subIssue' }
    ]
    const got = classifyPairings(PROJ_A, local, [])
    expect(got.primary).toHaveLength(1)
    expect(got.incoming).toHaveLength(0)
  })
})

describe('canEditPair', () => {
  // Backs the "paired toggle/delete actions only check the current project"
  // regression (rev-1 #5). A bidirectional pair writes to both endpoints;
  // the UI must gate on membership of BOTH.
  const current: AuthProject = { _id: PROJ_A, members: [ME] }
  const otherMember: AuthProject = { _id: PROJ_B, members: [ME] }
  const otherNonMember: AuthProject = { _id: PROJ_B, members: [OTHER] }

  it('one-way pair only needs current-project membership', () => {
    expect(canEditPair(current, otherNonMember, ME, false)).toBe(true)
  })

  it('bidirectional pair requires membership of BOTH projects', () => {
    expect(canEditPair(current, otherMember, ME, true)).toBe(true)
  })

  it('bidirectional pair is denied when the actor is not a member of the paired project', () => {
    expect(canEditPair(current, otherNonMember, ME, true)).toBe(false)
  })

  it('denies when the current project itself is not writable by the actor', () => {
    expect(canEditPair({ _id: PROJ_A, members: [OTHER] }, otherMember, ME, true)).toBe(false)
  })

  it('denies when the current project is undefined', () => {
    expect(canEditPair(undefined, otherMember, ME, false)).toBe(false)
  })

  it('denies when the other project is undefined on a bidirectional pair', () => {
    expect(canEditPair(current, undefined, ME, true)).toBe(false)
  })
})

describe('aggregateStatusesAcrossTaskTypes', () => {
  // Backs the "only the first TaskType is supported" regression (rev-1 #4).
  // The editor now aggregates statuses across every TaskType on the
  // ProjectType, dedup-ed by status id.
  const SID_A = 's:issueA' as Ref<IssueStatus>
  const SID_B = 's:issueB' as Ref<IssueStatus>
  const SID_C = 's:bugC' as Ref<IssueStatus>

  const resolve = (id: Ref<IssueStatus>): StatusLike | undefined => ({
    id,
    name: String(id),
    category: undefined
  })

  it('returns an empty list when there are no task types', () => {
    expect(aggregateStatusesAcrossTaskTypes([], resolve)).toHaveLength(0)
  })

  it('collects statuses from every task type, in declaration order', () => {
    const got = aggregateStatusesAcrossTaskTypes(
      [{ statuses: [SID_A, SID_B] }, { statuses: [SID_C] }],
      resolve
    )
    expect(got.map((s) => s.id)).toEqual([SID_A, SID_B, SID_C])
  })

  it('deduplicates a status shared between multiple task types', () => {
    const got = aggregateStatusesAcrossTaskTypes(
      [{ statuses: [SID_A, SID_B] }, { statuses: [SID_B, SID_C] }],
      resolve
    )
    expect(got.map((s) => s.id)).toEqual([SID_A, SID_B, SID_C])
  })

  it('skips statuses the resolver cannot find', () => {
    const got = aggregateStatusesAcrossTaskTypes(
      [{ statuses: [SID_A, SID_B] }],
      (id) => (id === SID_A ? { id, name: 'A', category: undefined } : undefined)
    )
    expect(got.map((s) => s.id)).toEqual([SID_A])
  })
})
