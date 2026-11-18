// SPDX-License-Identifier: EPL-2.0

import { getDefaultCategorySelection } from '../defaultCategory'

describe('Settings default navigation', () => {
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
