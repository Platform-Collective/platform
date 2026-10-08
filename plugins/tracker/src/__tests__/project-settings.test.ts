//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  canMakeProjectPrivate,
  isDeleteConfirmed,
  isProjectItemLimitReached,
  itemsOverProjectLimit,
  MAX_PROJECT_ITEMS,
  MAX_PROJECT_README,
  MAX_PROJECT_SHORT_DESCRIPTION,
  projectShortDescription,
  validateProjectDetails
} from '../projectSettings'

describe('project item limit', () => {
  it('is GitHub 50,000', () => {
    expect(MAX_PROJECT_ITEMS).toBe(50000)
  })

  it('is reached when the project is full', () => {
    expect(isProjectItemLimitReached(0)).toBe(false)
    expect(isProjectItemLimitReached(MAX_PROJECT_ITEMS - 1)).toBe(false)
    expect(isProjectItemLimitReached(MAX_PROJECT_ITEMS)).toBe(true)
    expect(isProjectItemLimitReached(MAX_PROJECT_ITEMS + 10)).toBe(true)
    expect(isProjectItemLimitReached(3, 3)).toBe(true)
  })

  it('gives back the newest created items beyond the limit', () => {
    const created = ['a', 'b', 'c']
    expect(itemsOverProjectLimit(created, 10, 10)).toEqual([])
    expect(itemsOverProjectLimit(created, 11, 10)).toEqual(['c'])
    expect(itemsOverProjectLimit(created, 12, 10)).toEqual(['b', 'c'])
    expect(itemsOverProjectLimit(created, 13, 10)).toEqual(['a', 'b', 'c'])
    // older items are never removed, even when the project is far over the limit
    expect(itemsOverProjectLimit(created, 50, 10)).toEqual(['a', 'b', 'c'])
    expect(itemsOverProjectLimit([], 50, 10)).toEqual([])
  })
})

describe('project details', () => {
  it('limits the short description to 256 characters', () => {
    expect(MAX_PROJECT_SHORT_DESCRIPTION).toBe(256)
    expect(validateProjectDetails({ shortDescription: 'a'.repeat(256) })).toBeUndefined()
    expect(validateProjectDetails({ shortDescription: 'a'.repeat(257) })).toBe('shortDescriptionTooLong')
  })

  it('limits the README', () => {
    expect(validateProjectDetails({ readme: 'a'.repeat(MAX_PROJECT_README) })).toBeUndefined()
    expect(validateProjectDetails({ readme: 'a'.repeat(MAX_PROJECT_README + 1) })).toBe('readmeTooLong')
    expect(validateProjectDetails({})).toBeUndefined()
  })

  it('shows the short description, or the old description of the space', () => {
    expect(projectShortDescription({ shortDescription: ' Plan ', description: 'old' })).toBe('Plan')
    expect(projectShortDescription({ description: ' old ' })).toBe('old')
    expect(projectShortDescription({ shortDescription: '  ', description: 'old' })).toBe('old')
    expect(projectShortDescription({ description: '' })).toBe('')
  })

  it('asks for the name to delete a project', () => {
    expect(isDeleteConfirmed('Roadmap', 'Roadmap')).toBe(true)
    expect(isDeleteConfirmed('Roadmap', ' Roadmap ')).toBe(true)
    expect(isDeleteConfirmed('Roadmap', 'roadmap')).toBe(false)
    expect(isDeleteConfirmed('Roadmap', '')).toBe(false)
    expect(isDeleteConfirmed('', '')).toBe(false)
  })
})

describe('project visibility', () => {
  it('needs an owner among the members to become private', () => {
    expect(canMakeProjectPrivate({ members: ['a'], owners: ['a'] } as any)).toBe(true)
    expect(canMakeProjectPrivate({ members: ['a', 'b'], owners: ['b'] } as any)).toBe(true)
    expect(canMakeProjectPrivate({ members: [], owners: ['a'] } as any)).toBe(false)
    expect(canMakeProjectPrivate({ members: ['a'], owners: ['b'] } as any)).toBe(false)
    expect(canMakeProjectPrivate({ members: ['a'], owners: [] } as any)).toBe(false)
    expect(canMakeProjectPrivate({ members: ['a'] } as any)).toBe(false)
  })
})
