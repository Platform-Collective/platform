//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { deepEqual } from 'fast-equals'
import { NO_DATE_SOURCE } from '../calendar/config'
import { ISSUE_DUE_SOURCE, ISSUE_START_SOURCE, parseSourceId, type DateSelection } from '../roadmap/dates'
import { DEFAULT_WORKLOAD_ZOOM, isWorkloadZoom, type WorkloadZoom } from './axis'

/** What the load of an item is. */
export type LoadMeasure = 'estimate' | 'remaining' | 'count' | 'field'

export const LOAD_MEASURES: readonly LoadMeasure[] = ['estimate', 'remaining', 'count', 'field']

export function isLoadMeasure (value: unknown): value is LoadMeasure {
  return value === 'estimate' || value === 'remaining' || value === 'count' || value === 'field'
}

/**
 * Settings of a workload view. They are stored in the view options under `WORKLOAD_OPTION_KEY`, like the settings
 * of the roadmap and the calendar, so that they are saved with the saved view, restored when it is opened and take
 * part in its unsaved-changes tracking.
 */
export interface WorkloadConfig {
  // Id of the date source of the start of an item (see roadmap/dates.ts), or NO_DATE_SOURCE
  start: string
  // Id of the date source of the end of an item, or NO_DATE_SOURCE
  target: string
  zoom: WorkloadZoom
  measure: LoadMeasure
  // Key of the Number custom field when the measure is `field`
  field?: string
  // What one person can take per working day, in the unit of the measure (hours for the estimate and the remaining time)
  capacity: number
}

export const WORKLOAD_OPTION_KEY = 'workload'

export const DEFAULT_CAPACITY_PER_DAY = 8

export const MAX_CAPACITY_PER_DAY = 1000

export const DEFAULT_WORKLOAD_CONFIG: Readonly<WorkloadConfig> = {
  start: ISSUE_START_SOURCE,
  target: ISSUE_DUE_SOURCE,
  zoom: DEFAULT_WORKLOAD_ZOOM,
  measure: 'estimate',
  capacity: DEFAULT_CAPACITY_PER_DAY
}

/** A capacity that is a finite number above zero (and not absurdly large), or undefined. */
export function validCapacity (raw: unknown): number | undefined {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > MAX_CAPACITY_PER_DAY) return undefined
  // Two decimals are enough, a longer fraction is typing noise
  return Math.round(n * 100) / 100
}

function validSource (raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  return raw === NO_DATE_SOURCE || parseSourceId(raw) !== undefined ? raw : fallback
}

function build (partial: {
  start: string
  target: string
  zoom: WorkloadZoom
  measure: LoadMeasure
  field?: string
  capacity: number
}): WorkloadConfig {
  // Two switched off date fields leave an item without any day: the default pair is used
  const none = partial.start === NO_DATE_SOURCE && partial.target === NO_DATE_SOURCE
  const res: WorkloadConfig = {
    start: none ? DEFAULT_WORKLOAD_CONFIG.start : partial.start,
    target: none ? DEFAULT_WORKLOAD_CONFIG.target : partial.target,
    zoom: partial.zoom,
    measure: partial.measure,
    capacity: partial.capacity
  }
  if (partial.measure === 'field' && partial.field !== undefined) res.field = partial.field
  return res
}

/**
 * Turns whatever is stored in the view options into a valid config; missing or damaged parts get the defaults.
 * The measure `field` needs the key of a field, without it the default measure is used.
 */
export function normalizeWorkloadConfig (raw: unknown): WorkloadConfig {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_WORKLOAD_CONFIG }
  const r = raw as Record<string, unknown>
  const field = typeof r.field === 'string' && r.field !== '' ? r.field : undefined
  const wanted = isLoadMeasure(r.measure) ? r.measure : DEFAULT_WORKLOAD_CONFIG.measure
  const measure = wanted === 'field' && field === undefined ? DEFAULT_WORKLOAD_CONFIG.measure : wanted
  return build({
    start: validSource(r.start, DEFAULT_WORKLOAD_CONFIG.start),
    target: validSource(r.target, DEFAULT_WORKLOAD_CONFIG.target),
    zoom: isWorkloadZoom(r.zoom) ? r.zoom : DEFAULT_WORKLOAD_CONFIG.zoom,
    measure,
    field,
    capacity: validCapacity(r.capacity) ?? DEFAULT_WORKLOAD_CONFIG.capacity
  })
}

export function readWorkloadConfig (viewOptions: Record<string, any> | undefined): WorkloadConfig {
  return normalizeWorkloadConfig(viewOptions?.[WORKLOAD_OPTION_KEY])
}

export function isDefaultWorkloadConfig (config: WorkloadConfig): boolean {
  return deepEqual(normalizeWorkloadConfig(config), DEFAULT_WORKLOAD_CONFIG)
}

/**
 * The view options with the workload config stored in them. The default config is not stored at all, so that
 * a view that was never customized stays equal to its saved state (no false "unsaved changes" dot).
 */
export function withWorkloadConfig<O extends Record<string, any>> (options: O, config: WorkloadConfig): O {
  const next: Record<string, any> = { ...options }
  const normalized = normalizeWorkloadConfig(config)
  if (isDefaultWorkloadConfig(normalized)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[WORKLOAD_OPTION_KEY]
  } else {
    next[WORKLOAD_OPTION_KEY] = { ...normalized }
  }
  return next as O
}

/** The start and target sources of a view; a switched off field has no source and gives no day. */
export function workloadSelection (config: WorkloadConfig): DateSelection {
  return { start: config.start, target: config.target }
}

export interface WorkloadAvailability {
  // Ids of the date sources that exist
  sourceIds: ReadonlySet<string>
  // Keys of the Number fields that exist
  numberFieldKeys: ReadonlySet<string>
}

/**
 * Drops what no longer exists (a deleted field) from the config. A date source that is gone falls back to the
 * default, a measure on a number field that is gone falls back to the default measure.
 */
export function sanitizeWorkloadConfig (config: WorkloadConfig, available: WorkloadAvailability): WorkloadConfig {
  const keep = (id: string, fallback: string): string =>
    id === NO_DATE_SOURCE || available.sourceIds.has(id) ? id : fallback
  const fieldGone = config.measure === 'field' && (config.field === undefined || !available.numberFieldKeys.has(config.field))
  return build({
    ...config,
    start: keep(config.start, DEFAULT_WORKLOAD_CONFIG.start),
    target: keep(config.target, DEFAULT_WORKLOAD_CONFIG.target),
    measure: fieldGone ? DEFAULT_WORKLOAD_CONFIG.measure : config.measure,
    field: fieldGone ? undefined : config.field
  })
}
