//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Pure logic of project saved views (GitHub-Projects style view tabs). Kept free of UI and
// platform imports so that it can be unit tested.

import type { BuildModelKey, ViewOptions } from '@hcengineering/view'
import { deepEqual } from 'fast-equals'

export type ViewColumns = Array<BuildModelKey | string>

/**
 * One layer of view configuration: the saved view, or the unsaved local edits on top of it.
 * Every field is optional; an absent field means "not specified by this layer".
 */
export interface ViewConfigLayer {
  // Layout (viewlet) of the view
  viewletId?: string | null
  // JSON of Filter[]
  filters?: string
  viewOptions?: ViewOptions
  // Ordered visible columns
  config?: ViewColumns
  // JSON of host-specific filter state
  extra?: string
  // GitHub-style filter string
  filterQuery?: string
}

export interface EffectiveViewConfig {
  viewletId?: string | null
  filters: string
  viewOptions?: ViewOptions
  config?: ViewColumns
  extra?: string
  filterQuery: string
}

export interface EffectiveViewConfigParams {
  // Built-in defaults of the viewlet
  defaults?: ViewConfigLayer
  // Global per-viewlet column preference (ViewletPreference.config)
  preference?: ViewColumns
  // The active saved view
  saved?: ViewConfigLayer
  // Unsaved local edits of the active view
  local?: ViewConfigLayer
  // Viewlet that is actually displayed. When it differs from the layout the layers were authored
  // for, their layout specific parts (columns, view options) are ignored
  currentViewletId?: string | null
}

export const EMPTY_FILTERS = '[]'

// Id of the view that is shown for a project without any saved view
export const DEFAULT_VIEW_ID = 'default-view'

function hasColumns (config: ViewColumns | undefined): config is ViewColumns {
  return config !== undefined && config.length > 0
}

/**
 * The single accessor for what a view displays. Precedence, strongest first:
 * unsaved local edits, the saved view, the global ViewletPreference (columns only), the defaults.
 * An empty column list means "not specified".
 */
export function getEffectiveViewConfig (params: EffectiveViewConfigParams): EffectiveViewConfig {
  const { defaults, preference, saved, local, currentViewletId } = params
  const viewletId = local?.viewletId ?? saved?.viewletId ?? defaults?.viewletId
  const layoutMatches = currentViewletId === undefined || viewletId == null || viewletId === currentViewletId
  const layouts = layoutMatches ? [local, saved] : []

  let config: ViewColumns | undefined
  let viewOptions: ViewOptions | undefined
  for (const layer of layouts) {
    if (config === undefined && hasColumns(layer?.config)) config = layer?.config
    if (viewOptions === undefined && layer?.viewOptions !== undefined) viewOptions = layer.viewOptions
  }
  if (config === undefined && hasColumns(preference)) config = preference
  config ??= defaults?.config
  viewOptions ??= defaults?.viewOptions

  return {
    viewletId,
    filters: local?.filters ?? saved?.filters ?? defaults?.filters ?? EMPTY_FILTERS,
    viewOptions,
    config: hasColumns(config) ? config : undefined,
    extra: local?.extra ?? saved?.extra ?? defaults?.extra,
    filterQuery: local?.filterQuery ?? saved?.filterQuery ?? defaults?.filterQuery ?? ''
  }
}

function normalize (layer: ViewConfigLayer): Required<Pick<ViewConfigLayer, 'filters'>> & ViewConfigLayer {
  return {
    viewletId: layer.viewletId ?? undefined,
    filters: layer.filters === undefined || layer.filters === '' ? EMPTY_FILTERS : layer.filters,
    viewOptions: layer.viewOptions,
    config: hasColumns(layer.config) ? layer.config : undefined,
    extra: layer.extra === undefined || layer.extra === '' || layer.extra === '[]' ? undefined : layer.extra,
    // Whitespace around the filter string is not a change
    filterQuery: layer.filterQuery === undefined || layer.filterQuery.trim() === '' ? undefined : layer.filterQuery.trim()
  }
}

/**
 * A view has unsaved changes when its current state differs from the baseline it was applied or saved with.
 */
export function isViewDirty (baseline: ViewConfigLayer, current: ViewConfigLayer): boolean {
  return !deepEqual(normalize(baseline), normalize(current))
}

function nameKey (name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Default name of a new view: "View N" with the smallest free N, starting from the number of existing views + 1
 */
export function nextViewName (existing: readonly string[], prefix: string = 'View'): string {
  const taken = new Set(existing.map(nameKey))
  let n = existing.length + 1
  while (taken.has(nameKey(`${prefix} ${n}`))) n++
  return `${prefix} ${n}`
}

/**
 * Name of a duplicated view: "X (copy)", then "X (copy 2)", "X (copy 3)", ...
 */
export function duplicateViewName (name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map(nameKey))
  const first = `${name} (copy)`
  if (!taken.has(nameKey(first))) return first
  let n = 2
  while (taken.has(nameKey(`${name} (copy ${n})`))) n++
  return `${name} (copy ${n})`
}

export interface OrderedView {
  _id: string
  order?: number
  createdOn?: number
}

/**
 * Tab order: by `order`, views without one go last, ties by creation time
 */
export function compareViews (a: OrderedView, b: OrderedView): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY
  const bo = b.order ?? Number.POSITIVE_INFINITY
  if (ao !== bo) return ao < bo ? -1 : 1
  return (a.createdOn ?? 0) - (b.createdOn ?? 0)
}

export function sortViews<T extends OrderedView>(views: readonly T[]): T[] {
  return [...views].sort(compareViews)
}

/**
 * Order value for a view appended after all the others
 */
export function nextOrder (views: readonly OrderedView[]): number {
  let max = -1
  for (const v of views) {
    if (v.order !== undefined && v.order > max) max = v.order
  }
  return max + 1
}

/**
 * Order value for the view `id` after it is moved to index `toIndex` of the tab row.
 * Only the moved view needs to be updated: its order is placed between its new neighbours.
 * Returns undefined when nothing changes.
 */
export function orderForMove (views: readonly OrderedView[], id: string, toIndex: number): number | undefined {
  const sorted = sortViews(views)
  const from = sorted.findIndex((v) => v._id === id)
  if (from === -1) return undefined
  const target = Math.max(0, Math.min(toIndex, sorted.length - 1))
  if (target === from) return undefined

  const rest = sorted.filter((v) => v._id !== id)
  const prev = rest[target - 1]
  const next = rest[target]
  const prevOrder = prev?.order ?? (prev !== undefined ? target - 1 : undefined)
  const nextOrderValue = next?.order ?? (next !== undefined ? target : undefined)

  if (prevOrder !== undefined && nextOrderValue !== undefined) {
    // Neighbours without a stored order cannot be compared reliably, fall back to their index
    return prevOrder < nextOrderValue ? (prevOrder + nextOrderValue) / 2 : prevOrder + 1
  }
  if (prevOrder !== undefined) return prevOrder + 1
  if (nextOrderValue !== undefined) return nextOrderValue - 1
  return 0
}

/**
 * Safe parse of a stored Filter[] JSON; a corrupt value yields no filters instead of breaking the page
 */
export function parseStoredFilters (json: string | undefined): any[] {
  if (json === undefined || json === '') return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Name of the location query parameter that carries the id of a saved view (a link to a view). */
export const VIEW_LINK_PARAM = 'view'

/**
 * The saved view a location asks for (`?view=<id>`), `undefined` when it does not name one.
 */
export function viewIdFromQuery (query: Record<string, string | null | undefined> | undefined): string | undefined {
  const id = query?.[VIEW_LINK_PARAM]
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined
}

/**
 * The location query of a link to a view: the view id and nothing else. The default view that is not stored yet (no id)
 * is the project itself, so its link has no query.
 */
export function viewLinkQuery (viewId: string | undefined): Record<string, string> | undefined {
  return viewId === undefined || viewId === DEFAULT_VIEW_ID ? undefined : { [VIEW_LINK_PARAM]: viewId }
}

/**
 * The tab a link asks for, when the project has it. A link to a view that was deleted, or that belongs to another
 * project (the location query survives a switch of the project), gives nothing, so the caller falls back to its own choice.
 */
export function viewFromLink<T extends { _id: string }> (
  query: Record<string, string | null | undefined> | undefined,
  tabs: readonly T[]
): T | undefined {
  const id = viewIdFromQuery(query)
  return id === undefined ? undefined : tabs.find((tab) => tab._id === id)
}
