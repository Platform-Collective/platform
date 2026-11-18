// SPDX-License-Identifier: EPL-2.0

import type { DocumentQuery, Ref } from '@hcengineering/core'
import type { TagCategory, TagElement } from '@hcengineering/tags'

export interface TagCategoryGroup {
  _id: Ref<TagCategory>
  label?: string
  elements: TagElement[]
  query: DocumentQuery<TagElement>
}

/** Resolve category membership independently of the labels currently referenced or displayed. */
export function getTagCategoryQuery (
  categories: TagCategory[],
  category: Ref<TagCategory>,
  noCategory: Ref<TagCategory>
): DocumentQuery<TagElement> {
  const fallback = categories.find((category) => category.default)?._id ?? noCategory
  if (category === fallback) {
    return {
      category: { $nin: categories.filter((category) => category._id !== fallback).map((category) => category._id) }
    }
  }
  return { category }
}

/** Group each label once, including labels whose category is not loaded for the target class. */
export function groupTagElements (
  categories: TagCategory[],
  elements: TagElement[],
  noCategory: Ref<TagCategory>
): TagCategoryGroup[] {
  const groups: TagCategoryGroup[] = categories.map((category) => ({
    _id: category._id,
    label: category.label,
    elements: [],
    query: { category: category._id }
  }))
  const byId = new Map(groups.map((group) => [group._id, group]))
  let fallback = byId.get(categories.find((category) => category.default)?._id ?? noCategory)
  const fallbackQuery = getTagCategoryQuery(categories, fallback?._id ?? noCategory, noCategory)
  if (fallback !== undefined) {
    fallback.query = fallbackQuery
  }

  const seen = new Set<Ref<TagElement>>()
  for (const element of elements) {
    if (seen.has(element._id)) continue
    seen.add(element._id)

    let group = byId.get(element.category)
    if (group === undefined) {
      if (fallback === undefined) {
        fallback = { _id: noCategory, elements: [], query: fallbackQuery }
        groups.push(fallback)
      }
      group = fallback
    }
    group.elements.push(element)
  }
  return groups
}
