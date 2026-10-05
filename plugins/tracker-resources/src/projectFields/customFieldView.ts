//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { SortingOrder, type CategoryType, type Doc, type Ref } from '@hcengineering/core'
import type { Iteration, Project, ProjectField } from '@hcengineering/tracker'
import { buildIterationGroupCategories, ProjectFieldType } from '@hcengineering/tracker'
import type { ClientGroupSummary, ClientHierarchy, ClientViewExtension } from '@hcengineering/view-resources'
import { writable, type Writable } from 'svelte/store'

import IterationGroupExtras from '../iterations/IterationGroupExtras.svelte'
import IterationGroupHeader from '../iterations/IterationGroupHeader.svelte'
import { iterationsByFieldKey } from '../iterations/iterationsStore'
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
  type CustomFieldFilter,
  type IterationContext
} from './query'
import type { ProjectFieldRegistry } from './registry'

export interface CustomFieldViewParams {
  registry: ProjectFieldRegistry
  scanLimit: number
  // Custom-field sort/group are switched off, e.g. because the view holds more issues than the scan limit
  disabled: boolean
  // "No <field>" group labels by field key
  emptyLabels: ReadonlyMap<string, string>
  // Iterations of the Iteration fields; empty when the project has none
  iterations?: readonly Iteration[]
  // Timestamp that `current` refers to; defaults to the time of the call
  now?: number
  // Nests sub-issues under their parents in lists whose view options turn it on
  hierarchy?: ClientHierarchy
  // Totals in the group headers of lists whose view options turn it on
  groupSummary?: ClientGroupSummary
  // Identity of the displayed saved view; lists that group on several levels keep their collapsed groups under it
  groupStateScope?: string
}

type IssueLike = Doc & { customFields?: Record<string, unknown> }

function headerPresenterFor (field: ProjectField, iterations: readonly Iteration[]): any {
  if (field.type === ProjectFieldType.Iteration) {
    const own = iterations.filter((it) => it.field === field._id)
    return class extends IterationGroupHeader {
      constructor (opts: any) {
        super({ ...opts, props: { ...opts.props, iterations: own } })
      }
    }
  }
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
  const iterations = params.iterations ?? []
  const byKey = iterationsByFieldKey(iterations, registry.fields)
  const iterationContext: IterationContext = {
    iterations: (fieldKey) => byKey.get(fieldKey) ?? [],
    now: params.now ?? Date.now()
  }
  const extras = new Map<string, any>()
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
    // Totals in the header of an iteration group need the status and the estimation
    extraProjection: (key) => (fieldOf(key)?.type === ProjectFieldType.Iteration ? ['status', 'estimation'] : []),
    getCategories: (key, docs, viewOptions): CategoryType[] => {
      const field = fieldOf(key)
      if (field === undefined || disabled || !isGroupableType(field.type)) return [undefined]
      if (field.type === ProjectFieldType.Iteration) {
        return buildIterationGroupCategories(
          byKey.get(field.key) ?? [],
          docs as IssueLike[],
          field.key,
          viewOptions.shouldShowAll === true
        )
      }
      return buildGroupCategories(field, docs as IssueLike[], viewOptions.shouldShowAll === true)
    },
    getGroupHeader: (key) => {
      const field = fieldOf(key)
      if (field === undefined) return undefined
      let presenter = headers.get(key)
      if (presenter === undefined) {
        presenter = headerPresenterFor(field, iterations)
        headers.set(key, presenter)
      }
      return presenter
    },
    getGroupExtras: (key) => {
      const field = fieldOf(key)
      if (field === undefined || field.type !== ProjectFieldType.Iteration) return undefined
      let component = extras.get(key)
      if (component === undefined) {
        const own = byKey.get(field.key) ?? []
        // The list renders the extras as `new Component({ props: { value, docs, space } })`
        component = class extends IterationGroupExtras {
          constructor (opts: any) {
            super({ ...opts, props: { ...opts.props, field, iterations: own } })
          }
        }
        extras.set(key, component)
      }
      return component
    },
    emptyGroupLabel: (key) => {
      const fieldKey = parseCustomFieldViewKey(key)
      return fieldKey === undefined ? undefined : emptyLabels.get(fieldKey)
    },
    compare: (key, order: SortingOrder) => {
      const field = fieldOf(key)
      if (field === undefined || disabled || !isSortableType(field.type)) return undefined
      const cmp = buildFieldComparator(field, order === SortingOrder.Ascending ? 1 : -1, iterationContext)
      return (a, b) => cmp(a as IssueLike, b as IssueLike)
    },
    scanLimit,
    hierarchy: params.hierarchy,
    groupSummary: params.groupSummary,
    groupStateScope: params.groupStateScope
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
