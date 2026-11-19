// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, PersonId, Ref, Space } from '@hcengineering/core'
import type { Asset } from '@hcengineering/platform'
import type { TagCategory, TagElement } from '@hcengineering/tags'
import { getTagCategoryQuery, groupTagElements } from '../tag-category-groups'

const NO_CATEGORY = 'tags:category:NoCategory' as Ref<TagCategory>
const TARGET_CLASS = 'test:class:Issue' as Ref<Class<Doc>>
const metadata = {
  space: 'test:space:Workspace' as Ref<Space>,
  modifiedOn: 0,
  modifiedBy: 'test:person:Author' as PersonId
}

function category (id: string, isDefault = false): TagCategory {
  return {
    ...metadata,
    _id: id as Ref<TagCategory>,
    _class: 'tags:class:TagCategory' as Ref<Class<TagCategory>>,
    targetClass: TARGET_CLASS,
    icon: 'tags:icon:Tags' as Asset,
    label: id,
    tags: [],
    default: isDefault
  }
}

function element (id: string, category: Ref<TagCategory>): TagElement {
  return {
    ...metadata,
    _id: id as Ref<TagElement>,
    _class: 'tags:class:TagElement' as Ref<Class<TagElement>>,
    targetClass: TARGET_CLASS,
    title: id,
    description: '',
    color: 0,
    category
  }
}

describe('groupTagElements', () => {
  const other = category('other', true)
  const known = category('known')
  const noCategory = element('uncategorized', NO_CATEGORY)
  const emptyCategory = element('empty-category', '' as Ref<TagCategory>)
  const missing = element('missing', 'deleted-category' as Ref<TagCategory>)
  const foreign = element('foreign', 'another-target-category' as Ref<TagCategory>)
  const regular = element('regular', known._id)
  const defaultElement = element('default', other._id)

  it('keeps NoCategory, missing and foreign references visible in the target default group exactly once', () => {
    const groups = groupTagElements(
      [known, other],
      [noCategory, emptyCategory, regular, missing, foreign, defaultElement],
      NO_CATEGORY
    )

    expect(groups.map((group) => group._id)).toEqual([known._id, other._id])
    expect(groups[0].elements).toEqual([regular])
    expect(groups[1].elements).toEqual([noCategory, emptyCategory, missing, foreign, defaultElement])
    expect(groups.flatMap((group) => group.elements)).toHaveLength(6)
    // Keep original documents and IDs so the pickers' add/remove actions still refer to the stored labels.
    expect(groups[1].elements[0]).toBe(noCategory)
    expect(noCategory.category).toBe(NO_CATEGORY)
    expect(emptyCategory.category).toBe('')
    expect(missing.category).toBe('deleted-category')
    expect(foreign.category).toBe('another-target-category')
  })

  it('adds one fallback group when loaded categories have no default', () => {
    const groups = groupTagElements([known], [regular, noCategory, emptyCategory, missing, foreign], NO_CATEGORY)

    expect(groups).toHaveLength(2)
    expect(groups[0].elements).toEqual([regular])
    expect(groups[1]._id).toBe(NO_CATEGORY)
    expect(groups[1].label).toBeUndefined()
    expect(groups[1].elements).toEqual([noCategory, emptyCategory, missing, foreign])
  })

  it('shows all labels even when no category documents exist', () => {
    const groups = groupTagElements([], [noCategory, emptyCategory, missing, foreign], NO_CATEGORY)

    expect(groups).toHaveLength(1)
    expect(groups[0]._id).toBe(NO_CATEGORY)
    expect(groups[0].elements).toEqual([noCategory, emptyCategory, missing, foreign])
    expect(groups[0].query).toEqual({ category: { $nin: [] } })
  })

  it('does not add an empty fallback or move labels out of known categories', () => {
    const groups = groupTagElements([known], [regular], NO_CATEGORY)

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe(known.label)
    expect(groups[0].elements).toEqual([regular])
    expect(groups[0].query).toEqual({ category: known._id })
    expect(groupTagElements([], [], NO_CATEGORY)).toEqual([])
  })

  it('deduplicates draft and query results without inflating group counts', () => {
    const groups = groupTagElements(
      [other, known],
      [noCategory, { ...noCategory }, regular, { ...regular }, missing],
      NO_CATEGORY
    )

    expect(groups[0].elements).toEqual([noCategory, missing])
    expect(groups[1].elements).toEqual([regular])
    expect(groups.flatMap((group) => group.elements).map((label) => label._id)).toEqual([
      noCategory._id,
      missing._id,
      regular._id
    ])
  })

  it('uses the same fallback membership for category drill-down and view queries', () => {
    const unused = category('unused')
    const groups = groupTagElements([known, other, unused], [noCategory, regular, missing], NO_CATEGORY)

    expect(groups[0].query).toEqual({ category: known._id })
    // Exclude all other loaded categories, including categories with no currently displayed labels.
    expect(groups[1].query).toEqual({ category: { $nin: [known._id, unused._id] } })
    const withoutDefault = groupTagElements([known, unused], [noCategory, regular, missing], NO_CATEGORY)
    expect(withoutDefault[2].query).toEqual({ category: { $nin: [known._id, unused._id] } })
  })

  it('regroups results when search or loaded categories change without mutating the inputs', () => {
    const categories = [known]
    const searchResults = [missing]
    const before = groupTagElements(categories, searchResults, NO_CATEGORY)
    const restored = category('deleted-category')
    const after = groupTagElements([known, restored], searchResults, NO_CATEGORY)

    expect(before[1].elements).toEqual([missing])
    expect(after).toHaveLength(2)
    expect(after[1]._id).toBe(restored._id)
    expect(after[1].elements).toEqual([missing])
    expect(after[1].query).toEqual({ category: restored._id })
    expect(categories).toEqual([known])
    expect(searchResults).toEqual([missing])
  })

  it('keeps the fallback query independent of the currently displayed labels', () => {
    const unused = category('unused')

    expect(groupTagElements([known, unused], [regular], NO_CATEGORY).map((group) => group._id)).toEqual([known._id])
    expect(getTagCategoryQuery([known, unused], NO_CATEGORY, NO_CATEGORY)).toEqual({
      category: { $nin: [known._id, unused._id] }
    })
    expect(groupTagElements([known], [], NO_CATEGORY)).toEqual([])
    expect(getTagCategoryQuery([known], NO_CATEGORY, NO_CATEGORY)).toEqual({
      category: { $nin: [known._id] }
    })
  })
})
