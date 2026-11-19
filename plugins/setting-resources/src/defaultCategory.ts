// SPDX-License-Identifier: EPL-2.0

import type { SettingsCategory } from '@hcengineering/setting'

/**
 * Returns the category to navigate to, or undefined when the current selection should be kept.
 * - On a floating (narrow/mobile) navigator the category list itself is the landing view: nothing is selected.
 * - A category that is not among the visible ones (unknown or no longer available) falls back to the first one.
 * - An empty selection falls back to the first category only when allowEmptyFallback is set, so that
 *   deselecting the current category by clicking it again keeps the content area empty.
 */
export function getDefaultCategoryName (
  categories: Array<Pick<SettingsCategory, 'name'>>,
  currentCategory: string | undefined,
  floatNavigator: boolean,
  allowEmptyFallback: boolean
): string | undefined {
  if (floatNavigator || categories.length === 0) return undefined
  if (currentCategory === undefined || currentCategory === '') {
    return allowEmptyFallback ? categories[0].name : undefined
  }
  return categories.some((c) => c.name === currentCategory) ? undefined : categories[0].name
}

export interface DefaultCategorySelection {
  name: string | undefined
  allowEmptyFallback: boolean
}

export function getDefaultCategorySelection (
  categories: Array<Pick<SettingsCategory, 'name'>>,
  currentCategory: string | undefined,
  floatNavigator: boolean,
  allowEmptyFallback: boolean
): DefaultCategorySelection {
  const name = getDefaultCategoryName(categories, currentCategory, floatNavigator, allowEmptyFallback)
  if (name !== undefined) return { name, allowEmptyFallback: false }
  return {
    name,
    allowEmptyFallback: categories.some((c) => c.name === currentCategory) ? false : allowEmptyFallback
  }
}
