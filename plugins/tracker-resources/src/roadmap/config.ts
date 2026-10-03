//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { deepEqual } from 'fast-equals'
import { ISSUE_DUE_SOURCE, ISSUE_START_SOURCE, parseSourceId, type DateSelection } from './dates'
import { DEFAULT_MARKER_SETTINGS, type MarkerSettings } from './markers'
import { DEFAULT_ROADMAP_ZOOM, isRoadmapZoom, type RoadmapZoom } from './timeScale'

/**
 * Settings of a roadmap view. They are stored in the view options under `ROADMAP_OPTION_KEY`, so that they are
 * saved with the saved view, restored when it is opened and take part in its unsaved-changes tracking.
 */
export interface RoadmapConfig {
  // Id of the date source of the start of an item (see dates.ts)
  start: string
  // Id of the date source of the target of an item
  target: string
  zoom: RoadmapZoom
  markers: MarkerSettings
  // Ids of the fields shown in the label of an item (see label.ts)
  fields: string[]
}

export const ROADMAP_OPTION_KEY = 'roadmap'

export const DEFAULT_LABEL_FIELDS: readonly string[] = ['identifier', 'title']

export const DEFAULT_ROADMAP_CONFIG: Readonly<RoadmapConfig> = {
  start: ISSUE_START_SOURCE,
  target: ISSUE_DUE_SOURCE,
  zoom: DEFAULT_ROADMAP_ZOOM,
  markers: DEFAULT_MARKER_SETTINGS,
  fields: [...DEFAULT_LABEL_FIELDS]
}

function stringList (raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const res: string[] = []
  for (const v of raw) {
    if (typeof v === 'string' && v !== '' && !res.includes(v)) res.push(v)
  }
  return res
}

function validSource (raw: unknown, fallback: string): string {
  return typeof raw === 'string' && parseSourceId(raw) !== undefined ? raw : fallback
}

/** Turns whatever is stored in the view options into a valid config; missing or damaged parts get the defaults. */
export function normalizeRoadmapConfig (raw: unknown): RoadmapConfig {
  if (raw === null || typeof raw !== 'object') return cloneConfig(DEFAULT_ROADMAP_CONFIG)
  const r = raw as Record<string, unknown>
  const markers = (r.markers ?? {}) as Record<string, unknown>
  return {
    start: validSource(r.start, DEFAULT_ROADMAP_CONFIG.start),
    target: validSource(r.target, DEFAULT_ROADMAP_CONFIG.target),
    zoom: isRoadmapZoom(r.zoom) ? r.zoom : DEFAULT_ROADMAP_CONFIG.zoom,
    markers: {
      milestones: markers.milestones === true,
      iterations: stringList(markers.iterations) ?? [],
      dates: stringList(markers.dates) ?? []
    },
    fields: stringList(r.fields) ?? [...DEFAULT_LABEL_FIELDS]
  }
}

export function cloneConfig (config: Readonly<RoadmapConfig>): RoadmapConfig {
  return {
    ...config,
    markers: {
      milestones: config.markers.milestones,
      iterations: [...config.markers.iterations],
      dates: [...config.markers.dates]
    },
    fields: [...config.fields]
  }
}

export function readRoadmapConfig (viewOptions: Record<string, any> | undefined): RoadmapConfig {
  return normalizeRoadmapConfig(viewOptions?.[ROADMAP_OPTION_KEY])
}

export function isDefaultConfig (config: RoadmapConfig): boolean {
  return deepEqual(config, DEFAULT_ROADMAP_CONFIG)
}

/**
 * The view options with the roadmap config stored in them. The default config is not stored at all, so that
 * a view that was never customized stays equal to its saved state (no false "unsaved changes" dot).
 */
export function withRoadmapConfig<O extends Record<string, any>> (options: O, config: RoadmapConfig): O {
  const next: Record<string, any> = { ...options }
  if (isDefaultConfig(config)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[ROADMAP_OPTION_KEY]
  } else {
    next[ROADMAP_OPTION_KEY] = cloneConfig(config)
  }
  return next as O
}

export function selectionOf (config: RoadmapConfig): DateSelection {
  return { start: config.start, target: config.target }
}

export interface ConfigAvailability {
  // Ids of the date sources that exist
  sourceIds: ReadonlySet<string>
  // Keys of the Iteration fields that exist
  iterationFieldKeys: ReadonlySet<string>
  // Ids of the label fields that exist
  labelFieldIds: ReadonlySet<string>
}

/**
 * Drops what no longer exists (a deleted field) from the config. A start or target source that is gone falls
 * back to the default.
 */
export function sanitizeConfig (config: RoadmapConfig, available: ConfigAvailability): RoadmapConfig {
  return {
    ...config,
    start: available.sourceIds.has(config.start) ? config.start : DEFAULT_ROADMAP_CONFIG.start,
    target: available.sourceIds.has(config.target) ? config.target : DEFAULT_ROADMAP_CONFIG.target,
    markers: {
      milestones: config.markers.milestones,
      iterations: config.markers.iterations.filter((k) => available.iterationFieldKeys.has(k)),
      dates: config.markers.dates.filter((id) => available.sourceIds.has(id))
    },
    fields: config.fields.filter((id) => available.labelFieldIds.has(id))
  }
}
