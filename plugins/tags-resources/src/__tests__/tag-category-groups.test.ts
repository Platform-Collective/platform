// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, DocumentQuery, PersonId, Ref, Space } from '@hcengineering/core'
import type { Asset } from '@hcengineering/platform'
import type { TagCategory, TagElement } from '@hcengineering/tags'
import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import * as ts from 'typescript'
import * as tagGroups from '../tag-category-groups'
import type { TagCategoryGroup } from '../tag-category-groups'

const { groupTagElements } = tagGroups

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

// Execute the components' production statements and event handlers without a DOM or application services.
// This covers their query/selection wiring as well as the shared grouping helper.
function createCategoryView (categories: TagCategory[]): {
  bar: {
    categories: TagCategory[]
    visibleCategories: TagCategoryGroup[]
    category: Ref<TagCategory> | undefined
    selected: Ref<TagElement>[]
  }
  view: {
    search: string
    category: Ref<TagCategory> | undefined
    resultQuery: DocumentQuery<TagElement>
  }
  refresh: (elements: TagElement[]) => void
  selectFallback: () => void
  canClear: () => boolean
  clear: () => void
} {
  const barSource = readFileSync(join(__dirname, '../components/CategoryBar.svelte'), 'utf8')
  const viewSource = readFileSync(join(__dirname, '../components/TagsView.svelte'), 'utf8')

  function statement (source: string, predicate: (node: ts.Statement) => boolean): string {
    const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1]
    if (script === undefined) throw new Error('Missing component script')
    const node = ts.createSourceFile('component.ts', script, ts.ScriptTarget.Latest, true).statements.find(predicate)
    if (node === undefined) throw new Error('Missing production statement')
    return node.getText()
  }

  function execute (code: string, state: object): unknown {
    return runInNewContext(ts.transpileModule(code, {}).outputText, state)
  }

  function viewEvent (event: string, detail: unknown): void {
    const handler = viewSource.match(new RegExp(`on:${event}=\\{(\\(evt\\) => \\{[\\s\\S]*?\\n  \\})\\}`))?.[1]
    if (handler === undefined) throw new Error(`Missing ${event} handler`)
    execute(`(${handler})(evt)`, Object.assign(view, { evt: { detail } }))
  }

  const shared = { ...tagGroups, tags: { category: { NoCategory: NO_CATEGORY } } }
  const resultQuery: DocumentQuery<TagElement> = {}
  const view = {
    ...shared,
    targetClass: TARGET_CLASS,
    search: '',
    category: undefined as Ref<TagCategory> | undefined,
    categories: [] as TagCategory[],
    visibleCategories: [] as TagCategoryGroup[],
    resultQuery
  }
  const bar = {
    ...shared,
    categories,
    elements: [] as TagElement[],
    visibleCategories: [] as TagCategoryGroup[],
    category: undefined as Ref<TagCategory> | undefined,
    selected: [] as Ref<TagElement>[],
    dispatch: viewEvent
  }

  execute(
    statement(viewSource, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'updateResultQuery'),
    view
  )
  execute(
    statement(
      barSource,
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((declaration) => declaration.name.getText() === 'selectItem')
    ),
    bar
  )

  const updateQuery = statement(
    viewSource,
    (node) => ts.isLabeledStatement(node) && node.statement.getText().startsWith('updateResultQuery(')
  )
  const updateGroups = statement(
    barSource,
    (node) => ts.isLabeledStatement(node) && node.statement.getText().startsWith('visibleCategories =')
  )
  const updateSelection = statement(
    barSource,
    (node) => ts.isLabeledStatement(node) && node.statement.getText().startsWith('if (selected.length > 0')
  )
  const emitCategories = statement(
    barSource,
    (node) => ts.isLabeledStatement(node) && node.statement.getText().startsWith("dispatch('categories',")
  )

  return {
    bar,
    view,
    refresh (elements: TagElement[]): void {
      bar.elements = elements
      execute(updateGroups, bar)
      execute(updateSelection, bar)
      execute(emitCategories, bar)
      execute(updateQuery, view)
    },
    selectFallback (): void {
      execute('selectItem(visibleCategories.find((group) => group._id === tags.category.NoCategory))', bar)
      execute(updateQuery, view)
    },
    canClear (): boolean {
      const condition = barSource.match(/\{#if (.*)\}/)?.[1]
      if (condition === undefined) throw new Error('Missing category bar condition')
      return execute(condition, bar) as boolean
    },
    clear (): void {
      const handler = barSource.match(/<ModernButton[\s\S]*?on:click=\{(\(\) => \{[\s\S]*?\n {6}\})\}/)?.[1]
      if (handler === undefined) throw new Error('Missing AllCategories handler')
      execute(`(${handler})()`, bar)
      execute(updateQuery, view)
    }
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

  it('keeps the selected virtual fallback query after its last attachments are removed', () => {
    const unused = category('unused')
    const stored = [noCategory, emptyCategory, missing, foreign, regular]
    const component = createCategoryView([known, unused])
    component.refresh(stored)
    component.selectFallback()
    expect(component.view.resultQuery).toEqual({
      targetClass: TARGET_CLASS,
      category: { $nin: [known._id, unused._id] }
    })

    // Only attachment-derived input changes: all five label documents still exist in storage.
    component.view.search = 'repro-'
    component.refresh([regular])

    expect(component.bar.visibleCategories.map((group) => group._id)).toEqual([known._id])
    expect(component.view.category).toBe(NO_CATEGORY)
    expect(component.view.resultQuery).toEqual({
      $search: 'repro-',
      targetClass: TARGET_CLASS,
      category: { $nin: [known._id, unused._id] }
    })

    // Removing an unused category must also update the selected predicate.
    component.bar.categories = [known]
    component.refresh([regular])
    expect(component.view.resultQuery.category).toEqual({ $nin: [known._id] })
  })

  it('keeps AllCategories available and clears the filter after all attachments are removed', () => {
    const component = createCategoryView([known])
    component.refresh([regular, missing])
    component.selectFallback()
    component.refresh([])

    expect(component.canClear()).toBe(true)
    expect(component.bar.category).toBe(NO_CATEGORY)
    expect(component.bar.visibleCategories).toEqual([])
    expect(component.view.resultQuery).toEqual({
      targetClass: TARGET_CLASS,
      category: { $nin: [known._id] }
    })

    component.clear()
    expect(component.canClear()).toBe(false)
    component.refresh([regular, missing])
    expect(component.bar.category).toBeUndefined()
    expect(component.bar.selected).toEqual([])
    expect(component.view.category).toBeUndefined()
    expect(component.view.resultQuery).toEqual({ targetClass: TARGET_CLASS })
    expect(component.canClear()).toBe(true)
  })
})
