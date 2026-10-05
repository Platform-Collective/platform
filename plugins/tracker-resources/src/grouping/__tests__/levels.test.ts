//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  collapsedGroupsStorageKey,
  groupStateScope,
  MAX_BOARD_GROUP_LEVELS,
  MAX_TABLE_GROUP_LEVELS,
  resolveGroupLevels
} from '../levels'

describe('resolveGroupLevels', () => {
  const max = MAX_TABLE_GROUP_LEVELS

  it('gives the single level of a stored single group-by as it always was', () => {
    expect(resolveGroupLevels(['status'], { max })).toEqual(['status'])
    expect(resolveGroupLevels(['#no_category'], { max })).toEqual([])
    expect(resolveGroupLevels(undefined, { max })).toEqual([])
    expect(resolveGroupLevels([], { max })).toEqual([])
  })

  it('keeps the levels in order and caps them', () => {
    expect(resolveGroupLevels(['status', 'assignee'], { max })).toEqual(['status', 'assignee'])
    expect(resolveGroupLevels(['a', 'b', 'c', 'd'], { max })).toEqual(['a', 'b', 'c'])
    expect(resolveGroupLevels(['a', 'b', 'c'], { max: MAX_BOARD_GROUP_LEVELS })).toEqual(['a', 'b'])
  })

  it('ends at "No grouping"', () => {
    expect(resolveGroupLevels(['status', '#no_category', 'assignee'], { max })).toEqual(['status'])
    expect(resolveGroupLevels(['#no_category', 'status'], { max })).toEqual([])
  })

  it('skips a repeated key, an excluded key and an unavailable key', () => {
    expect(resolveGroupLevels(['status', 'status', 'priority'], { max })).toEqual(['status', 'priority'])
    expect(resolveGroupLevels(['status', 'assignee', 'priority'], { max, exclude: ['status'] })).toEqual([
      'assignee',
      'priority'
    ])
    const isAvailable = (key: string): boolean => key !== 'customFields.gone'
    expect(resolveGroupLevels(['customFields.gone', 'priority'], { max, isAvailable })).toEqual(['priority'])
  })

  it('ignores damaged entries', () => {
    expect(resolveGroupLevels(['status', 5 as unknown as string, 'priority'], { max })).toEqual(['status'])
  })
})

describe('group state keys', () => {
  it('identify the view of a project', () => {
    expect(groupStateScope('p1', 'v1')).toBe('p1.v1')
    expect(groupStateScope(undefined, 'v1')).toBe('all.v1')
    expect(groupStateScope('p1', undefined)).toBeUndefined()
    expect(collapsedGroupsStorageKey('roadmap', 'p1.v1')).not.toBe(collapsedGroupsStorageKey('board', 'p1.v1'))
    expect(collapsedGroupsStorageKey('board', 'p1.v1')).not.toBe(collapsedGroupsStorageKey('board', 'p1.v2'))
  })
})
