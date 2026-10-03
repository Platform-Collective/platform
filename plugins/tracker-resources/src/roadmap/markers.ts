//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  iterationDays,
  parseSourceId,
  readSourceDay,
  type DateIssue,
  type DateLookups,
  type DateSource,
  type IterationDates
} from './dates'
import { toDay } from './timeScale'

export type RoadmapMarkerKind = 'milestone' | 'iteration' | 'date'

/** What is marked on the roadmap (the Markers menu); saved with the view. */
export interface MarkerSettings {
  // A flag at the target date of every milestone
  milestones: boolean
  // Keys of the Iteration fields whose iterations are marked
  iterations: string[]
  // Ids of the date sources (issue dates, Date fields) whose dates of the items are marked
  dates: string[]
}

export const DEFAULT_MARKER_SETTINGS: MarkerSettings = { milestones: false, iterations: [], dates: [] }

export interface RoadmapMarker {
  id: string
  kind: RoadmapMarkerKind
  // The day of the marker line (for an iteration its first day)
  day: number
  // Last day of an iteration, for shading its span
  endDay?: number
  label: string
  // Palette color index of a milestone
  color?: number
  // Items on a date marker's day
  count?: number
}

export interface MilestoneLike {
  _id: string
  label: string
  targetDate: number
  color?: number
}

export interface IterationFieldLike {
  key: string
  label: string
}

export interface MarkerParams {
  settings: MarkerSettings
  milestones: readonly MilestoneLike[]
  // Iteration fields and their iterations
  iterationFields: readonly IterationFieldLike[]
  iterations: (fieldKey: string) => readonly (IterationDates & { label: string })[]
  // Date sources by id
  sources: ReadonlyMap<string, DateSource>
  issues: readonly DateIssue[]
  lookups: DateLookups
}

// A marker for every date of every item would drown the roadmap: the busiest days win
const MAX_DATE_MARKERS = 100

/**
 * The vertical markers to draw, ordered by day: milestone flags, iteration boundaries and the dates of the items
 * of the chosen sources.
 */
export function collectMarkers (params: MarkerParams): RoadmapMarker[] {
  const { settings } = params
  const res: RoadmapMarker[] = []

  if (settings.milestones) {
    for (const m of params.milestones) {
      if (typeof m.targetDate !== 'number' || !Number.isFinite(m.targetDate)) continue
      res.push({ id: `milestone:${m._id}`, kind: 'milestone', day: toDay(m.targetDate), label: m.label, color: m.color })
    }
  }

  for (const key of settings.iterations) {
    if (!params.iterationFields.some((f) => f.key === key)) continue
    for (const it of params.iterations(key)) {
      if (it.isBreak === true) continue
      const { start, end } = iterationDays(it)
      res.push({ id: `iteration:${it._id}`, kind: 'iteration', day: start, endDay: end, label: it.label })
    }
  }

  for (const sourceId of settings.dates) {
    const source = params.sources.get(sourceId)
    const ref = parseSourceId(sourceId)
    if (source === undefined || ref === undefined || ref.kind === 'iteration') continue
    const counts = new Map<number, number>()
    for (const issue of params.issues) {
      const day = readSourceDay(issue, ref, 'start', params.lookups)
      if (day !== undefined) counts.set(day, (counts.get(day) ?? 0) + 1)
    }
    const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, MAX_DATE_MARKERS)
    for (const [day, count] of busiest) {
      res.push({ id: `date:${sourceId}:${day}`, kind: 'date', day, label: source.label, count })
    }
  }

  return res.sort((a, b) => a.day - b.day || a.id.localeCompare(b.id))
}

/** Markers whose line or span intersects the axis [startDay, endDay). */
export function markersInRange (markers: readonly RoadmapMarker[], startDay: number, endDay: number): RoadmapMarker[] {
  return markers.filter((m) => m.day < endDay && (m.endDay ?? m.day) >= startDay)
}

/** Flips one boolean or list member of the settings; returns a new object. */
export function toggleMarker (
  settings: MarkerSettings,
  target: { kind: 'milestones' } | { kind: 'iterations' | 'dates', id: string }
): MarkerSettings {
  if (target.kind === 'milestones') return { ...settings, milestones: !settings.milestones }
  const list = settings[target.kind]
  const next = list.includes(target.id) ? list.filter((it) => it !== target.id) : [...list, target.id]
  return { ...settings, [target.kind]: next }
}

export function hasAnyMarker (settings: MarkerSettings): boolean {
  return settings.milestones || settings.iterations.length > 0 || settings.dates.length > 0
}
