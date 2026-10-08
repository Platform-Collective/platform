//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  HIERARCHY_OPTION_KEY,
  isHierarchyEnabled,
  isHierarchySwitchedOn,
  newViewHierarchyOptions,
  withHierarchy
} from '../config'
import {
  expansionStorageKey,
  MAX_EXPANDED_IDS,
  parseExpanded,
  serializeExpanded,
  toggleExpanded
} from '../expansion'
import { buildProgressIndex, formatProgress, progressOf, progressRatio } from '../progress'

describe('hierarchy switch', () => {
  it('is off for views that never stored it (legacy and unsaved views)', () => {
    expect(isHierarchyEnabled(undefined)).toBe(false)
    expect(isHierarchyEnabled({ groupBy: ['status'] })).toBe(false)
    expect(isHierarchyEnabled({ [HIERARCHY_OPTION_KEY]: false })).toBe(false)
    expect(isHierarchyEnabled({ [HIERARCHY_OPTION_KEY]: 'yes' })).toBe(false)
  })

  it('is on when stored, unless the list hides its sub-issues', () => {
    expect(isHierarchyEnabled({ [HIERARCHY_OPTION_KEY]: true })).toBe(true)
    expect(isHierarchyEnabled({ [HIERARCHY_OPTION_KEY]: true, shouldShowSubIssues: true })).toBe(true)
    expect(isHierarchyEnabled({ [HIERARCHY_OPTION_KEY]: true, shouldShowSubIssues: false })).toBe(false)
    expect(isHierarchySwitchedOn({ [HIERARCHY_OPTION_KEY]: true, shouldShowSubIssues: false })).toBe(true)
  })

  it('does not store the off state, so that on and off again leaves the view clean', () => {
    const base = { groupBy: ['status'], orderBy: ['rank', 1] }
    const on = withHierarchy<Record<string, any>>(base, true)
    expect(on[HIERARCHY_OPTION_KEY]).toBe(true)
    expect(withHierarchy(on, false)).toEqual(base)
    expect(base).toEqual({ groupBy: ['status'], orderBy: ['rank', 1] })
  })

  it('starts new table views with the hierarchy and nothing else', () => {
    expect(newViewHierarchyOptions(true)).toEqual({ [HIERARCHY_OPTION_KEY]: true })
    expect(newViewHierarchyOptions(false)).toBeUndefined()
  })
})

describe('expansion state', () => {
  it('is kept per project and view', () => {
    expect(expansionStorageKey('p1', 'v1')).not.toBe(expansionStorageKey('p1', 'v2'))
    expect(expansionStorageKey('p1', 'v1')).not.toBe(expansionStorageKey('p2', 'v1'))
  })

  it('round-trips', () => {
    const ids = new Set(['a', 'b'])
    expect(parseExpanded(serializeExpanded(ids))).toEqual(ids)
  })

  it('survives damaged storage', () => {
    for (const raw of [null, undefined, '', '{', 'null', '{"a":1}', '"x"', '5']) {
      expect(parseExpanded(raw)).toEqual(new Set())
    }
    expect(parseExpanded('["a",1,null,"","b"]')).toEqual(new Set(['a', 'b']))
  })

  it('toggles without changing the given set', () => {
    const start = new Set(['a'])
    const added = toggleExpanded(start, 'b')
    expect([...added]).toEqual(['a', 'b'])
    expect([...start]).toEqual(['a'])
    expect([...toggleExpanded(added, 'a')]).toEqual(['b'])
  })

  it('forgets the oldest ids above the cap', () => {
    const ids = new Set(['a', 'b', 'c'])
    expect([...toggleExpanded(ids, 'd', 3)]).toEqual(['b', 'c', 'd'])
    const many = new Set(Array.from({ length: MAX_EXPANDED_IDS + 50 }, (_, i) => `i${i}`))
    expect(parseExpanded(serializeExpanded(many)).size).toBe(MAX_EXPANDED_IDS)
    expect(parseExpanded(serializeExpanded(many)).has('i49')).toBe(false)
    expect(parseExpanded(serializeExpanded(many)).has(`i${MAX_EXPANDED_IDS + 49}`)).toBe(true)
  })
})

describe('sub-issue progress', () => {
  const closed = new Set(['done', 'canceled'])
  const NO_PARENT = 'tracker:ids:NoParent'
  const subs = [
    { attachedTo: 'p1', status: 'done' },
    { attachedTo: 'p1', status: 'todo' },
    { attachedTo: 'p1', status: 'canceled' },
    { attachedTo: 'p2', status: 'todo' },
    { attachedTo: NO_PARENT, status: 'done' }
  ]

  it('counts the done and all sub-issues of every parent', () => {
    const index = buildProgressIndex(subs, closed, NO_PARENT)
    expect(progressOf(index, 'p1')).toEqual({ done: 2, total: 3 })
    expect(progressOf(index, 'p2')).toEqual({ done: 0, total: 1 })
    expect(index.size).toBe(2)
  })

  it('has no progress for an issue without sub-issues or for no data', () => {
    expect(progressOf(buildProgressIndex(subs, closed, NO_PARENT), 'p3')).toBeUndefined()
    expect(buildProgressIndex([], closed, NO_PARENT).size).toBe(0)
  })

  it('formats and measures the progress', () => {
    expect(formatProgress({ done: 2, total: 5 })).toBe('2/5')
    expect(progressRatio({ done: 2, total: 5 })).toBeCloseTo(0.4)
    expect(progressRatio({ done: 0, total: 0 })).toBe(0)
    expect(progressRatio(undefined)).toBe(0)
    expect(progressRatio({ done: 7, total: 5 })).toBe(1)
  })
})
