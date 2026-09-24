//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//
import type { Doc, DocumentQuery, Hierarchy, Ref } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import type { Resource } from '@hcengineering/platform'
import type { Filter, FilterMode } from '@hcengineering/view'

/**
 * Pure (no Svelte) helper extracted from FilterBar.svelte:81-142. Composes
 * `filters` into a `DocumentQuery<Doc>` by chaining each filter's mode-result
 * onto the existing `base`. Used by InlineFilterChips and the slim FilterBar
 * SaveAs container so both render-paths share a single source of truth.
 *
 * NOTE: `mode.result` is a `Resource<>` (platform registry id), NOT a
 * callable function. We resolve it via `getResource(mode.result)` before
 * invocation. This mirrors FilterBar.svelte:87 exactly. Calling
 * `mode.result(filter)` directly would throw at runtime.
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
const defaultResolveResource: ResourceResolver = async <T>(r: Resource<T>) => await getResource(r)

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
 * actually compose against. This mirrors `FilterBar.svelte:83` which
 * always did `hierarchy.clone(query)` before mutating.
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
  refresh: () => void = () => {}
): Promise<DocumentQuery<Doc>> {
  const out: DocumentQuery<Doc> = cloneQuery(base, hierarchy)
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i]
    const mode = await resolveMode(filter.mode)
    if (mode === undefined) continue
    const resultFn = await resolveResource<ResultFn>(mode.result as unknown as Resource<ResultFn>)
    const result: any = await resultFn(filter, refresh)

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
  return out
}
