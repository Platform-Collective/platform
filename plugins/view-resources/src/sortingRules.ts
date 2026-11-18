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

import { type SortingOrder, type SortingRules } from '@hcengineering/core'

/**
 * Build sorting rules which order values by their position in sortedValues.
 * Values not listed are placed after all listed ones (for ascending order).
 * @public
 */
export function buildSortingRules<T> (order: SortingOrder, sortedValues: T[]): SortingRules<T> {
  return {
    order,
    default: sortedValues.length,
    cases: sortedValues.map((value, index) => ({ query: value as any, index }))
  }
}
