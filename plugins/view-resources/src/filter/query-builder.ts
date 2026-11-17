//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//
import type { Doc, DocumentQuery, Hierarchy, Ref } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import type { Resource } from '@hcengineering/platform'
import type { Filter, FilterMode } from '@hcengineering/view'
import { FilterQueryLifetime } from './lifecycle'

/**
 * Helper without Svelte dependencies, extracted from FilterBar. Composes
 * `filters` into a `DocumentQuery<Doc>` by chaining each filter's mode-result
 * onto the existing `base`. FilterBar uses it through createFilterQueryComposer,
 * including when Tracker renders its chips separately from the SaveAs container.
 *
 * NOTE: `mode.result` is a `Resource<>` (platform registry id), NOT a
 * callable function. We resolve it via `getResource(mode.result)` before
 * invocation. Calling
 * `mode.result(filter)` directly would throw at runtime.
 *
 * The composer's cancellable variant returns undefined; callers must check the
 * captured lifetime again before dispatching, since removal can also happen after this promise settles.
 *
 * AND-semantics across filters on the same key: when two filters target the
 * same attribute, their result-operators are merged (intersection on $in,
 * union on $nin, tighter bound on $lt/$gt). Matches FilterBar's reduce loop.
 */
export type FilterModeResolver = (id: Ref<FilterMode>) => Promise<FilterMode | undefined>
export type ResourceResolver = <T>(resource: Resource<T>) => Promise<T>
type ResultFn = (filter: Filter, refresh: () => void) => Promise<unknown>

/**
 * Default resource resolver — uses the platform's getResource. Exposed as a
 * parameter so unit tests can inject a mock without spinning up the full
 * plugin runtime.
 */
const defaultResolveResource: ResourceResolver = async <T> (r: Resource<T>) => await getResource(r)

/**
 * Keys that must never be written through dynamic property assignment:
 * they would reach `Object.prototype` (prototype pollution).
 */
function isUnsafeKey (key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

function isPlainObject (value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-clone a query so the helper never mutates the caller's `base`.
 * Prefers `hierarchy.clone()` when available (it knows about huly's
 * domain model and may preserve special types); falls back to
 * `structuredClone` (Node 17+, all modern browsers), and finally to a
 * JSON-roundtrip for the simple `DocumentQuery` shape that filters
 * actually compose against. FilterBar supplies its client's hierarchy.
 */
function cloneQuery (base: DocumentQuery<Doc>, hierarchy?: Hierarchy): DocumentQuery<Doc> {
  if (hierarchy !== undefined) return hierarchy.clone(base)
  if (typeof structuredClone === 'function') return structuredClone(base)
  return JSON.parse(JSON.stringify(base))
}

export async function makeFilterQuery (
  base: DocumentQuery<Doc>,
  filters: Filter[],
  resolveMode: FilterModeResolver,
  resolveResource: ResourceResolver = defaultResolveResource,
  hierarchy?: Hierarchy,
  refresh: () => void = (): void => {}
): Promise<DocumentQuery<Doc>> {
  return (await makeFilterQueryWithLifetime(
    base,
    filters,
    resolveMode,
    resolveResource,
    hierarchy,
    refresh,
    new FilterQueryLifetime([])
  )) as DocumentQuery<Doc>
}

export async function makeFilterQueryWithLifetime (
  base: DocumentQuery<Doc>,
  filters: Filter[],
  resolveMode: FilterModeResolver,
  resolveResource: ResourceResolver = defaultResolveResource,
  hierarchy?: Hierarchy,
  refresh: () => void = (): void => {},
  lifetime = new FilterQueryLifetime(filters.map((filter) => filter.index))
): Promise<DocumentQuery<Doc> | undefined> {
  // Composition cancellation includes siblings, but a retained subscription's
  // refresh belongs only to its own generation. Capture both before any await.
  const filterLifetimes = filters.map((filter) => new FilterQueryLifetime([filter.index]))
  const out: DocumentQuery<Doc> = cloneQuery(base, hierarchy)
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i]
    if (!lifetime.isActive()) return undefined
    const mode = await lifetime.waitFor(resolveMode(filter.mode))
    if (!lifetime.isActive()) return undefined
    if (mode === undefined) continue
    const resultFn = await lifetime.waitFor(resolveResource<ResultFn>(mode.result))
    if (resultFn === undefined || !lifetime.isActive()) return undefined
    const result: any = await lifetime.waitFor(
      resultFn(filter, () => {
        if (filterLifetimes[i].isActive()) refresh()
      })
    )
    if (!lifetime.isActive()) return undefined

    let filterKey = filter.key.key
    if (hierarchy !== undefined) {
      const attr = hierarchy.getAttribute(filter.key._class, filter.key.key)
      if (hierarchy.isMixin(attr.attributeOf)) {
        filterKey = (attr.attributeOf as string) + '.' + filter.key.key
      }
    }

    if (isUnsafeKey(filterKey)) continue

    const target = out as Record<string, any>
    const existing = Object.prototype.hasOwnProperty.call(target, filterKey) ? target[filterKey] : undefined
    if (existing == null) {
      target[filterKey] = result
      continue
    }
    if (!isPlainObject(result)) continue

    const resultKeys = Object.keys(result).filter((key) => !isUnsafeKey(key))
    if (typeof existing === 'string') {
      // A literal value can only be narrowed by `$in`; anything else leaves it as is.
      if (Array.isArray(result.$in)) {
        target[filterKey] = { $in: result.$in.filter((p) => p === existing) }
      }
      continue
    }
    if (!isPlainObject(existing)) continue

    for (const key of resultKeys) {
      const next = result[key]
      if (!Object.prototype.hasOwnProperty.call(existing, key) || existing[key] === undefined) {
        existing[key] = next
        continue
      }
      const prev = existing[key]
      switch (key) {
        case '$in':
          existing[key] = (prev as any[]).filter((p) => (next as any[]).includes(p))
          break
        case '$nin':
          existing[key] = [...(prev as any[]), ...(next as any[])]
          break
        case '$lt':
        case '$lte':
          // Tighter upper bound wins (date filters emit $lte/$gte).
          existing[key] = prev < next ? prev : next
          break
        case '$gt':
        case '$gte':
          // Tighter lower bound wins.
          existing[key] = prev > next ? prev : next
          break
        default:
          existing[key] = next
      }
    }
  }
  return lifetime.isActive() ? out : undefined
}
