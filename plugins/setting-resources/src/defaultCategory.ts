//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

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
