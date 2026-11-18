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

import { SortingOrder } from '@hcengineering/core'
import { buildSortingRules } from '../sortingRules'

describe('buildSortingRules', () => {
  it('maps each value to its position', () => {
    expect(buildSortingRules(SortingOrder.Ascending, ['backlog', 'todo', 'done'])).toEqual({
      order: SortingOrder.Ascending,
      default: 3,
      cases: [
        { query: 'backlog', index: 0 },
        { query: 'todo', index: 1 },
        { query: 'done', index: 2 }
      ]
    })
  })

  it('keeps the requested order', () => {
    const rules = buildSortingRules(SortingOrder.Descending, ['a'])
    expect(rules.order).toBe(SortingOrder.Descending)
    expect(rules.default).toBe(1)
  })

  it('handles an empty list', () => {
    expect(buildSortingRules(SortingOrder.Ascending, [])).toEqual({
      order: SortingOrder.Ascending,
      default: 0,
      cases: []
    })
  })
})
