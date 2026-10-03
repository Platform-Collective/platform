//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { deepEqual } from 'fast-equals'
import { isGroupableType, parseCustomFieldViewKey, toCustomFieldViewKey } from '../projectFields/query'
import type { ProjectField } from '@hcengineering/tracker'

/**
 * Settings of a board that are not part of the generic view options. They are stored in the view options under
 * `BOARD_OPTION_KEY`, so that they are saved with the saved view, restored when it is opened and take part in
 * its unsaved-changes tracking (the same way as the roadmap settings).
 *
 * Swimlanes are not stored here: like on GitHub they are the "Group by" of the view (`viewOptions.groupBy`).
 */
export interface BoardConfig {
  // View key of the field the columns come from: a built-in attribute (`status`) or `customFields.<key>`
  columnField: string
  // Advisory item limits of the columns, by column field and then by column key (see `categoryKey`)
  columnLimits: Record<string, Record<string, number>>
  // Keys of the columns that are hidden, by column field
  hiddenColumns: Record<string, string[]>
}

export const BOARD_OPTION_KEY = 'board'

/** Column field of a board that was never configured. */
export const DEFAULT_COLUMN_FIELD = 'status'

/** The "No grouping" value of the group-by view option (it is `noCategory` of the view plugin). */
export const NO_GROUPING = '#no_category'

/** Built-in attributes of an issue that can be the column field, in the order they are offered. */
export const BUILTIN_COLUMN_FIELDS: readonly string[] = ['status', 'assignee', 'priority', 'component', 'milestone']

export const DEFAULT_BOARD_CONFIG: Readonly<BoardConfig> = {
  columnField: DEFAULT_COLUMN_FIELD,
  columnLimits: {},
  hiddenColumns: {}
}

function isRecord (raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
}

/** A limit is a positive whole number; anything else means "no limit". */
export function normalizeLimit (raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined
}

function normalizeLimits (raw: unknown): Record<string, Record<string, number>> {
  const res: Record<string, Record<string, number>> = {}
  if (!isRecord(raw)) return res
  for (const [field, limits] of Object.entries(raw)) {
    if (!isRecord(limits)) continue
    const own: Record<string, number> = {}
    for (const [column, limit] of Object.entries(limits)) {
      const value = normalizeLimit(limit)
      if (value !== undefined) own[column] = value
    }
    if (Object.keys(own).length > 0) res[field] = own
  }
  return res
}

function normalizeHidden (raw: unknown): Record<string, string[]> {
  const res: Record<string, string[]> = {}
  if (!isRecord(raw)) return res
  for (const [field, columns] of Object.entries(raw)) {
    if (!Array.isArray(columns)) continue
    const own: string[] = []
    for (const column of columns) {
      if (typeof column === 'string' && !own.includes(column)) own.push(column)
    }
    if (own.length > 0) res[field] = own
  }
  return res
}

/** Turns whatever is stored in the view options into a valid config; missing or damaged parts get the defaults. */
export function normalizeBoardConfig (raw: unknown): BoardConfig {
  if (!isRecord(raw)) return cloneBoardConfig(DEFAULT_BOARD_CONFIG)
  return {
    columnField: typeof raw.columnField === 'string' && raw.columnField !== '' ? raw.columnField : DEFAULT_COLUMN_FIELD,
    columnLimits: normalizeLimits(raw.columnLimits),
    hiddenColumns: normalizeHidden(raw.hiddenColumns)
  }
}

export function cloneBoardConfig (config: Readonly<BoardConfig>): BoardConfig {
  const columnLimits: Record<string, Record<string, number>> = {}
  for (const [field, limits] of Object.entries(config.columnLimits)) columnLimits[field] = { ...limits }
  const hiddenColumns: Record<string, string[]> = {}
  for (const [field, columns] of Object.entries(config.hiddenColumns)) hiddenColumns[field] = [...columns]
  return { columnField: config.columnField, columnLimits, hiddenColumns }
}

export function readBoardConfig (viewOptions: Record<string, any> | undefined): BoardConfig {
  return normalizeBoardConfig(viewOptions?.[BOARD_OPTION_KEY])
}

export function isDefaultBoardConfig (config: BoardConfig): boolean {
  return deepEqual(config, DEFAULT_BOARD_CONFIG)
}

/**
 * The view options with the board config stored in them. The default config is not stored at all, so that
 * a view that was never customized stays equal to its saved state (no false "unsaved changes" dot).
 */
export function withBoardConfig<O extends Record<string, any>> (options: O, config: BoardConfig): O {
  const next: Record<string, any> = { ...options }
  if (isDefaultBoardConfig(config)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[BOARD_OPTION_KEY]
  } else {
    next[BOARD_OPTION_KEY] = cloneBoardConfig(config)
  }
  return next as O
}

/** Limits of the columns of one column field, by column key. */
export function limitsOf (config: BoardConfig, columnField: string): Readonly<Record<string, number>> {
  return config.columnLimits[columnField] ?? {}
}

/** Keys of the hidden columns of one column field. */
export function hiddenOf (config: BoardConfig, columnField: string): readonly string[] {
  return config.hiddenColumns[columnField] ?? []
}

/** The config with the limit of one column set; `undefined` removes the limit. */
export function withColumnLimit (
  config: BoardConfig,
  columnField: string,
  columnKey: string,
  limit: number | undefined
): BoardConfig {
  const next = cloneBoardConfig(config)
  const own = { ...(next.columnLimits[columnField] ?? {}) }
  const value = normalizeLimit(limit)
  if (value === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete own[columnKey]
  } else {
    own[columnKey] = value
  }
  if (Object.keys(own).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next.columnLimits[columnField]
  } else {
    next.columnLimits[columnField] = own
  }
  return next
}

/** The config with all limits of one column field removed. */
export function withoutColumnLimits (config: BoardConfig, columnField: string): BoardConfig {
  const next = cloneBoardConfig(config)
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete next.columnLimits[columnField]
  return next
}

/** The config with one column hidden or shown. */
export function withColumnHidden (
  config: BoardConfig,
  columnField: string,
  columnKey: string,
  hidden: boolean
): BoardConfig {
  const next = cloneBoardConfig(config)
  const rest = (next.hiddenColumns[columnField] ?? []).filter((it) => it !== columnKey)
  const own = hidden ? [...rest, columnKey] : rest
  if (own.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next.hiddenColumns[columnField]
  } else {
    next.hiddenColumns[columnField] = own
  }
  return next
}

/** The config with every column of one column field shown. */
export function withAllColumnsShown (config: BoardConfig, columnField: string): BoardConfig {
  const next = cloneBoardConfig(config)
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete next.hiddenColumns[columnField]
  return next
}

/** The config with another column field. Limits and hidden columns are kept per field, so they stay with it. */
export function withColumnField (config: BoardConfig, columnField: string): BoardConfig {
  return { ...cloneBoardConfig(config), columnField }
}

/** What the board needs to know about the project to check the view keys. */
export interface BoardFieldAvailability {
  // Custom fields of the project that exist
  fields: ReadonlyArray<Pick<ProjectField, 'key' | 'type'>>
}

/** A view key that can be the column field, with the project's fields at hand. */
export function isAvailableColumnField (key: string, available: BoardFieldAvailability): boolean {
  if (BUILTIN_COLUMN_FIELDS.includes(key)) return true
  const fieldKey = parseCustomFieldViewKey(key)
  if (fieldKey === undefined) return false
  return available.fields.some((f) => f.key === fieldKey && isGroupableType(f.type))
}

/** View keys that can be the column field, in the order they are offered: built-in first, then the custom fields. */
export function columnFieldKeys (available: BoardFieldAvailability): string[] {
  return [
    ...BUILTIN_COLUMN_FIELDS,
    ...available.fields.filter((f) => isGroupableType(f.type)).map((f) => toCustomFieldViewKey(f.key))
  ]
}

export interface BoardDimensions {
  // Field the columns come from
  columnKey: string
  // Field the swimlanes come from; undefined when the board has no swimlanes
  laneKey?: string
}

/**
 * The fields the board is laid out by. A column field that does not exist (a deleted custom field) falls back to
 * the status. The swimlanes are the first "Group by" of the view; the same field as the columns would only give
 * one swimlane per column, so it is ignored, and so is a custom field that does not exist.
 */
export function resolveBoardDimensions (
  config: BoardConfig,
  groupBy: readonly string[] | undefined,
  available: BoardFieldAvailability
): BoardDimensions {
  const columnKey = isAvailableColumnField(config.columnField, available) ? config.columnField : DEFAULT_COLUMN_FIELD
  const first = groupBy?.[0]
  const noLanes = first === undefined || first === '' || first === NO_GROUPING || first === columnKey
  // A custom field that is gone (or cannot be grouped by) gives no swimlanes
  const gone = first !== undefined && parseCustomFieldViewKey(first) !== undefined && !isAvailableColumnField(first, available)
  return { columnKey, laneKey: noLanes || gone ? undefined : first }
}
