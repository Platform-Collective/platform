//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/**
 * Slice by ("Slice by" panel of GitHub Projects): the panel lists the values of one field and the view shows only
 * the items with the chosen values. The settings are stored in the view options under `SLICE_OPTION_KEY`, so that
 * they are saved with the saved view, restored when it is opened and take part in its unsaved-changes tracking.
 * The panel is open while the key exists.
 */
export interface SliceConfig {
  // Id of the field, see `sliceFieldId` (fields.ts)
  field: string
  // Ids of the chosen values; `SLICE_NONE` stands for the items without a value. Empty means "All"
  value: string[]
}

export const SLICE_OPTION_KEY = 'slice'

/** Value id of the items that have no value in the field ("No <field>"). */
export const SLICE_NONE = '__none__'

function isRecord (raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
}

function uniqueStrings (raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const res: string[] = []
  for (const v of list) {
    if (typeof v === 'string' && v !== '' && !res.includes(v)) res.push(v)
  }
  return res
}

/** Turns whatever is stored in the view options into a config; undefined when no panel is configured. */
export function normalizeSliceConfig (raw: unknown): SliceConfig | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.field !== 'string' || raw.field === '') return undefined
  return { field: raw.field, value: uniqueStrings(raw.value) }
}

export function readSliceConfig (viewOptions: Record<string, any> | undefined): SliceConfig | undefined {
  return normalizeSliceConfig(viewOptions?.[SLICE_OPTION_KEY])
}

/**
 * The view options with the slice stored; `undefined` closes the panel and removes the key, so that a view that
 * never used the panel stays clean.
 */
export function withSliceConfig<O extends Record<string, any>> (options: O, config: SliceConfig | undefined): O {
  const next: Record<string, any> = { ...options }
  if (config === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[SLICE_OPTION_KEY]
  } else {
    next[SLICE_OPTION_KEY] = { field: config.field, value: [...config.value] }
  }
  return next as O
}

/** The config for another field; the chosen values belong to the old field, so they are dropped. */
export function withSliceField (config: SliceConfig | undefined, field: string): SliceConfig {
  return config?.field === field ? config : { field, value: [] }
}

/** The config with "All" chosen. */
export function selectAllValues (config: SliceConfig): SliceConfig {
  return { field: config.field, value: [] }
}

/**
 * The config after a click on a value. A plain click chooses that value alone, and a click on the only chosen value
 * goes back to "All". With `multi` (Cmd/Ctrl) the value is added to or removed from the chosen ones.
 */
export function toggleSliceValue (config: SliceConfig, id: string, multi: boolean): SliceConfig {
  if (multi) {
    const value = config.value.includes(id) ? config.value.filter((it) => it !== id) : [...config.value, id]
    return { field: config.field, value }
  }
  const only = config.value.length === 1 && config.value[0] === id
  return { field: config.field, value: only ? [] : [id] }
}

/**
 * The chosen values that still exist; a value that was deleted (an option, an iteration) is dropped, so that a view
 * never ends up showing nothing for a value nobody can see or clear.
 */
export function sanitizeSliceValues (value: readonly string[], existing: ReadonlySet<string>): string[] {
  return value.filter((id) => id === SLICE_NONE || existing.has(id))
}
