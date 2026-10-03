//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { deepEqual } from 'fast-equals'
import { ISSUE_DUE_SOURCE, ISSUE_START_SOURCE, parseSourceId, type DateSelection } from '../roadmap/dates'
import { isCalendarMode, type CalendarMode } from './grid'

/**
 * Settings of a calendar view. They are stored in the view options under `CALENDAR_OPTION_KEY`, like the settings of
 * the roadmap, so that they are saved with the saved view, restored when it is opened and take part in its
 * unsaved-changes tracking. Which month or week is shown is navigation, not a setting, and is not stored.
 */
export interface CalendarConfig {
  mode: CalendarMode
  // Id of the date source of the start of an item (see roadmap/dates.ts), or NO_DATE_SOURCE
  start: string
  // Id of the date source of the end of an item, or NO_DATE_SOURCE
  target: string
}

export const CALENDAR_OPTION_KEY = 'calendar'

/** A date field that is switched off: an item then takes its day from the other field only. */
export const NO_DATE_SOURCE = 'none'

export const DEFAULT_CALENDAR_MODE: CalendarMode = 'month'

export const DEFAULT_CALENDAR_CONFIG: Readonly<CalendarConfig> = {
  mode: DEFAULT_CALENDAR_MODE,
  start: ISSUE_START_SOURCE,
  target: ISSUE_DUE_SOURCE
}

function validSource (raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  return raw === NO_DATE_SOURCE || parseSourceId(raw) !== undefined ? raw : fallback
}

/**
 * Turns whatever is stored in the view options into a valid config; missing or damaged parts get the defaults.
 * A calendar needs at least one date field, so two switched off fields give the default pair.
 */
export function normalizeCalendarConfig (raw: unknown): CalendarConfig {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_CALENDAR_CONFIG }
  const r = raw as Record<string, unknown>
  const start = validSource(r.start, DEFAULT_CALENDAR_CONFIG.start)
  const target = validSource(r.target, DEFAULT_CALENDAR_CONFIG.target)
  const mode = isCalendarMode(r.mode) ? r.mode : DEFAULT_CALENDAR_CONFIG.mode
  if (start === NO_DATE_SOURCE && target === NO_DATE_SOURCE) {
    return { mode, start: DEFAULT_CALENDAR_CONFIG.start, target: DEFAULT_CALENDAR_CONFIG.target }
  }
  return { mode, start, target }
}

export function readCalendarConfig (viewOptions: Record<string, any> | undefined): CalendarConfig {
  return normalizeCalendarConfig(viewOptions?.[CALENDAR_OPTION_KEY])
}

export function isDefaultCalendarConfig (config: CalendarConfig): boolean {
  return deepEqual(config, DEFAULT_CALENDAR_CONFIG)
}

/**
 * The view options with the calendar config stored in them. The default config is not stored at all, so that
 * a view that was never customized stays equal to its saved state (no false "unsaved changes" dot).
 */
export function withCalendarConfig<O extends Record<string, any>> (options: O, config: CalendarConfig): O {
  const next: Record<string, any> = { ...options }
  if (isDefaultCalendarConfig(config)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[CALENDAR_OPTION_KEY]
  } else {
    next[CALENDAR_OPTION_KEY] = { ...config }
  }
  return next as O
}

/** The start and target sources of a view; a switched off field has no source and gives no day. */
export function calendarSelection (config: CalendarConfig): DateSelection {
  return { start: config.start, target: config.target }
}

/**
 * Drops what no longer exists (a deleted field) from the config. A source that is gone falls back to the default;
 * when that leaves no field at all the default pair is used.
 */
export function sanitizeCalendarConfig (config: CalendarConfig, sourceIds: ReadonlySet<string>): CalendarConfig {
  const keep = (id: string, fallback: string): string => (id === NO_DATE_SOURCE || sourceIds.has(id) ? id : fallback)
  const start = keep(config.start, DEFAULT_CALENDAR_CONFIG.start)
  const target = keep(config.target, DEFAULT_CALENDAR_CONFIG.target)
  if (start === NO_DATE_SOURCE && target === NO_DATE_SOURCE) {
    return { ...config, start: DEFAULT_CALENDAR_CONFIG.start, target: DEFAULT_CALENDAR_CONFIG.target }
  }
  return { ...config, start, target }
}
