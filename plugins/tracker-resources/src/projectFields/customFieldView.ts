//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { SortingOrder, type CategoryType, type Doc, type Ref } from '@hcengineering/core'
import type { Project, ProjectField } from '@hcengineering/tracker'
import { ProjectFieldType } from '@hcengineering/tracker'
import type { ClientViewExtension } from '@hcengineering/view-resources'
import { writable, type Writable } from 'svelte/store'

import tracker from '../plugin'
import CustomFieldGroupHeader from './CustomFieldGroupHeader.svelte'
import {
  buildFieldComparator,
  buildGroupCategories,
  CUSTOM_FIELD_KEY_PREFIX,
  isGroupableType,
  isSortableType,
  parseCustomFieldViewKey,
  toCustomFieldViewKey,
  type CustomFieldFilter
} from './query'
import type { ProjectFieldRegistry } from './registry'

export interface CustomFieldViewParams {
  registry: ProjectFieldRegistry
  scanLimit: number
  // Custom-field sort/group are switched off, e.g. because the view holds more issues than the scan limit
  disabled: boolean
  // "No <field>" group labels by field key
  emptyLabels: ReadonlyMap<string, string>
}

type IssueLike = Doc & { customFields?: Record<string, unknown> }

function headerPresenterFor (field: ProjectField): any {
  const options = field.options ?? []
  // The list renders the header as `new Presenter({ props: { value, ... } })`, so the options are bound here
  return class extends CustomFieldGroupHeader {
    constructor (opts: any) {
      super({ ...opts, props: { ...opts.props, options } })
    }
  }
}

/**
 * View extension that exposes the custom fields of a project to the issue list as optional columns
 * and as group-by / order-by keys. Grouping and ordering are evaluated on the client (plan D1).
 */
export function createCustomFieldViewExtension (params: CustomFieldViewParams): ClientViewExtension {
  const { registry, scanLimit, disabled, emptyLabels } = params
  const fieldOf = (key: string): ProjectField | undefined => {
    const fieldKey = parseCustomFieldViewKey(key)
    return fieldKey === undefined ? undefined : registry.byKey.get(fieldKey)
  }
  const headers = new Map<string, any>()

  return {
    // Any key of this form is ours, even if its field does not exist (any more), so a saved
    // group/order choice can never reach the server as an unknown attribute
    handlesKey: (key) => key.startsWith(CUSTOM_FIELD_KEY_PREFIX),
    groupByKeys: () =>
      registry.fields
        .filter((f) => isGroupableType(f.type))
        .map((f) => ({ id: toCustomFieldViewKey(f.key), label: f.label })),
    orderByKeys: () =>
      registry.fields
        .filter((f) => isSortableType(f.type))
        .map((f) => ({ id: toCustomFieldViewKey(f.key), label: f.label })),
    columns: () =>
      registry.fields
        .filter((f) => f.type !== ProjectFieldType.Iteration)
        .map((f) => ({
          key: {
            key: '',
            presenter: tracker.component.CustomFieldColumn,
            props: { fieldKey: f.key },
            displayProps: { key: `cf_${f.key}`, optional: true }
          },
          label: f.label
        })),
    projectionKey: () => 'customFields',
    getCategories: (key, docs, viewOptions): CategoryType[] => {
      const field = fieldOf(key)
      if (field === undefined || disabled || !isGroupableType(field.type)) return [undefined]
      return buildGroupCategories(field, docs as IssueLike[], viewOptions.shouldShowAll === true)
    },
    getGroupHeader: (key) => {
      const field = fieldOf(key)
      if (field === undefined) return undefined
      let presenter = headers.get(key)
      if (presenter === undefined) {
        presenter = headerPresenterFor(field)
        headers.set(key, presenter)
      }
      return presenter
    },
    emptyGroupLabel: (key) => {
      const fieldKey = parseCustomFieldViewKey(key)
      return fieldKey === undefined ? undefined : emptyLabels.get(fieldKey)
    },
    compare: (key, order: SortingOrder) => {
      const field = fieldOf(key)
      if (field === undefined || disabled || !isSortableType(field.type)) return undefined
      const cmp = buildFieldComparator(field, order === SortingOrder.Ascending ? 1 : -1)
      return (a, b) => cmp(a as IssueLike, b as IssueLike)
    },
    scanLimit
  }
}

const filterStores = new Map<Ref<Project>, Writable<CustomFieldFilter[]>>()
const storageKey = (project: Ref<Project>): string => `tracker.customFieldFilters.${project}`

function loadFilters (project: Ref<Project>): CustomFieldFilter[] {
  try {
    const raw = localStorage.getItem(storageKey(project))
    const parsed = raw !== null ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((f) => typeof f?.fieldKey === 'string') : []
  } catch {
    return []
  }
}

/**
 * Custom-field filter rules of a project view. Kept for the session and mirrored to local storage
 * so that a reload does not silently drop the filter.
 */
export function customFieldFilterStore (project: Ref<Project>): Writable<CustomFieldFilter[]> {
  let store = filterStores.get(project)
  if (store === undefined) {
    store = writable<CustomFieldFilter[]>(loadFilters(project))
    store.subscribe((value) => {
      try {
        if (value.length === 0) localStorage.removeItem(storageKey(project))
        else localStorage.setItem(storageKey(project), JSON.stringify(value))
      } catch {
        // Storage can be unavailable (private mode, quota); the in-memory state still works
      }
    })
    filterStores.set(project, store)
  }
  return store
}
