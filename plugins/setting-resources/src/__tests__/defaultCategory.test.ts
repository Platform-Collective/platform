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

import { getDefaultCategoryName } from '../defaultCategory'

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
