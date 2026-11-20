// SPDX-License-Identifier: EPL-2.0

import { getDefaultCategoryName, getDefaultCategorySelection } from '../defaultCategory'

describe('getDefaultCategoryName', () => {
  const categories = [{ name: 'profile' }, { name: 'password' }]

  it('selects the first category when none is selected', () => {
    expect(getDefaultCategoryName(categories, undefined, false, true)).toBe('profile')
    expect(getDefaultCategoryName(categories, '', false, true)).toBe('profile')
  })

  it('keeps an empty selection when the empty fallback is not allowed (user deselected)', () => {
    expect(getDefaultCategoryName(categories, undefined, false, false)).toBeUndefined()
    expect(getDefaultCategoryName(categories, '', false, false)).toBeUndefined()
  })

  it('keeps a valid selected category', () => {
    expect(getDefaultCategoryName(categories, 'password', false, true)).toBeUndefined()
    expect(getDefaultCategoryName(categories, 'password', false, false)).toBeUndefined()
  })

  it('falls back to the first category for an unknown or unavailable category', () => {
    expect(getDefaultCategoryName(categories, 'unknown', false, true)).toBe('profile')
    expect(getDefaultCategoryName(categories, 'unknown', false, false)).toBe('profile')
  })

  it('does not select anything on a floating navigator', () => {
    expect(getDefaultCategoryName(categories, undefined, true, true)).toBeUndefined()
    expect(getDefaultCategoryName(categories, 'unknown', true, true)).toBeUndefined()
  })

  it('returns undefined when there are no categories', () => {
    expect(getDefaultCategoryName([], undefined, false, true)).toBeUndefined()
    expect(getDefaultCategoryName([], 'unknown', false, true)).toBeUndefined()
  })
})

describe('getDefaultCategorySelection', () => {
  const categories = [{ name: 'profile' }, { name: 'password' }]

  it('opens the first available category on a docked navigator', () => {
    expect(getDefaultCategorySelection(categories, undefined, false, true)).toEqual({
      name: 'profile',
      allowEmptyFallback: false
    })
  })

  it('replaces an unavailable category with the first visible category', () => {
    expect(getDefaultCategorySelection(categories, 'unavailable', false, true)).toEqual({
      name: 'profile',
      allowEmptyFallback: false
    })
  })

  it('preserves a valid category and disables the initial fallback', () => {
    expect(getDefaultCategorySelection(categories, 'password', false, true)).toEqual({
      name: undefined,
      allowEmptyFallback: false
    })
  })

  it('keeps the category list as the floating navigator landing view', () => {
    expect(getDefaultCategorySelection(categories, undefined, true, true)).toEqual({
      name: undefined,
      allowEmptyFallback: true
    })
  })

  it('does not navigate before categories are available', () => {
    expect(getDefaultCategorySelection([], undefined, false, true)).toEqual({
      name: undefined,
      allowEmptyFallback: true
    })
  })

  it('keeps an intentional empty selection after the initial navigation', () => {
    expect(getDefaultCategorySelection(categories, undefined, false, false)).toEqual({
      name: undefined,
      allowEmptyFallback: false
    })
  })
})
