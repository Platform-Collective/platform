// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, PersonId, Ref, Space } from '@hcengineering/core'
import type { Asset } from '@hcengineering/platform'
import type { TagCategory, TagElement } from '@hcengineering/tags'
import { groupTagElements } from '../tag-category-groups'

const TARGET_CLASS = 'test:class:Issue' as Ref<Class<Doc>>
const metadata = {
  space: 'test:space:Workspace' as Ref<Space>,
  modifiedOn: 0,
  modifiedBy: 'test:person:Author' as PersonId
}

test('the label picker includes labels whose category is no longer loaded', () => {
  const known: TagCategory = {
    ...metadata,
    _id: 'known' as Ref<TagCategory>,
    _class: 'tags:class:TagCategory' as Ref<Class<TagCategory>>,
    targetClass: TARGET_CLASS,
    icon: 'tags:icon:Tags' as Asset,
    label: 'Known',
    tags: [],
    default: false
  }
  const objects: TagElement[] = [
    {
      ...metadata,
      _id: 'known-label' as Ref<TagElement>,
      _class: 'tags:class:TagElement' as Ref<Class<TagElement>>,
      targetClass: TARGET_CLASS,
      title: 'Known label',
      description: '',
      color: 0,
      category: known._id
    },
    {
      ...metadata,
      _id: 'orphan' as Ref<TagElement>,
      _class: 'tags:class:TagElement' as Ref<Class<TagElement>>,
      targetClass: TARGET_CLASS,
      title: 'Orphan',
      description: '',
      color: 0,
      category: 'deleted' as Ref<TagCategory>
    }
  ]

  const visible = groupTagElements([known], objects, 'tags:category:NoCategory' as Ref<TagCategory>).flatMap(
    (group) => group.elements
  )
  expect(visible.map((item) => item._id).sort()).toEqual(['known-label', 'orphan'])
})
