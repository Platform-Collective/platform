// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Tests for the editor's authorization gate, candidate filter, auto-match,
// allowed-loops default, primary-only edit guard, and loop validation.
// Covers the regression paths MichaelUray flagged in the #244 review.

import { type AccountUuid, type Ref } from '@hcengineering/core'
import { type IssueStatus, type Project } from '@hcengineering/tracker'
import { type WorkflowRule } from '@hcengineering/workflow-rules'

import {
  autoMatch,
  buildAllowedLoops,
  buildAutoMap,
  canEditFromHere,
  isCandidateTarget,
  isMemberOf,
  loopsValid,
  type AuthProject,
  type SiblingRule,
  type StatusLike
} from '../pure'

const ME = 'acc-me' as AccountUuid
const OTHER = 'acc-other' as AccountUuid

const PROJ_A = 'proj:a' as Ref<Project>
const PROJ_B = 'proj:b' as Ref<Project>
const PROJ_C = 'proj:c' as Ref<Project>

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
  it('allows a writable, un-paired target', () => {
    expect(isCandidateTarget(proj(), PROJ_A, ME, []).ok).toBe(true)
  })

  it('refuses self-pairing', () => {
    expect(isCandidateTarget(proj({ _id: PROJ_A }), PROJ_A, ME, []).ok).toBe(false)
  })

  it('refuses an archived target', () => {
    expect(isCandidateTarget(proj({ archived: true }), PROJ_A, ME, []).ok).toBe(false)
  })

  it('refuses a restricted TypedSpace', () => {
    expect(isCandidateTarget(proj({ restricted: true }), PROJ_A, ME, []).ok).toBe(false)
  })

  it('refuses a project the actor is not a member of', () => {
    expect(isCandidateTarget(proj({ members: [OTHER] }), PROJ_A, ME, []).ok).toBe(false)
  })

  it('refuses a project already paired with the current one', () => {
    const sibling: SiblingRule = { _id: 'rule:1' as Ref<WorkflowRule>, linkedProject: PROJ_B }
    const res = isCandidateTarget(proj(), PROJ_A, ME, [sibling])
    expect(res.ok).toBe(false)
    expect(res.pairedBy).toBe('rule:1')
  })

  it('refuses other targets when some are already paired', () => {
    const sibling: SiblingRule = { _id: 'rule:1' as Ref<WorkflowRule>, linkedProject: PROJ_C }
    expect(isCandidateTarget(proj({ _id: PROJ_B }), PROJ_A, ME, [sibling]).ok).toBe(true)
    expect(isCandidateTarget(proj({ _id: PROJ_C }), PROJ_A, ME, [sibling]).ok).toBe(false)
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
