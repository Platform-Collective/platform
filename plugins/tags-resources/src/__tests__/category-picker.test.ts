// SPDX-License-Identifier: EPL-2.0

import type { Ref } from '@hcengineering/core'
import type { TagCategory, TagElement } from '@hcengineering/tags'
import { groupTagElements } from '../tag-category-groups'

test('the label picker includes labels whose category is no longer loaded', () => {
  const known = { _id: 'known' as Ref<TagCategory> } as TagCategory
  const objects = [
    { _id: 'known-label', category: known._id } as TagElement,
    { _id: 'orphan', category: 'deleted' as Ref<TagCategory> } as TagElement
  ]

  const visible = groupTagElements([known], objects, 'tags:category:NoCategory' as Ref<TagCategory>).flatMap(
    (group) => group.elements
  )
  expect(visible.map((item) => item._id).sort()).toEqual(['known-label', 'orphan'])
})
