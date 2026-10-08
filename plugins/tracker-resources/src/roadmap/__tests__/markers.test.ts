//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType } from '@hcengineering/tracker'
import { buildDateSources, type DateLookups } from '../dates'
import {
  collectMarkers,
  DEFAULT_MARKER_SETTINGS,
  hasAnyMarker,
  markersInRange,
  toggleMarker,
  type MarkerParams
} from '../markers'
import { toDay } from '../timeScale'

const local = (y: number, m: number, d: number): number => new Date(y, m - 1, d).getTime()
const day = (y: number, m: number, d: number): number => toDay(local(y, m, d))

const iterations = [
  { _id: 'i1', label: 'Sprint 1', startDate: local(2026, 10, 5), duration: 7 },
  { _id: 'brk', label: 'Break', startDate: local(2026, 10, 12), duration: 3, isBreak: true },
  { _id: 'i2', label: 'Sprint 2', startDate: local(2026, 10, 15), duration: 7 }
]
const lookups: DateLookups = { milestone: () => undefined, iterations: () => iterations }
const sources = new Map(
  buildDateSources([{ key: 'release', label: 'Release', type: ProjectFieldType.Date }], {
    startDate: 'Start date',
    dueDate: 'Due date',
    deadline: 'Deadline',
    milestoneStart: 'MS',
    milestoneTarget: 'MT'
  }).map((s) => [s.id, s])
)

function params (over: Partial<MarkerParams>): MarkerParams {
  return {
    settings: DEFAULT_MARKER_SETTINGS,
    milestones: [
      { _id: 'm1', label: 'Beta', targetDate: local(2026, 11, 30), color: 3 },
      { _id: 'm2', label: 'GA', targetDate: local(2026, 10, 20) }
    ],
    iterationFields: [{ key: 'sprint', label: 'Sprint' }],
    iterations: () => iterations,
    sources,
    issues: [],
    lookups,
    ...over
  }
}

describe('collectMarkers', () => {
  it('shows nothing by default', () => {
    expect(collectMarkers(params({}))).toEqual([])
  })

  it('flags milestones at their target date, ordered by day', () => {
    const res = collectMarkers(params({ settings: { ...DEFAULT_MARKER_SETTINGS, milestones: true } }))
    expect(res.map((m) => [m.kind, m.label, m.day])).toEqual([
      ['milestone', 'GA', day(2026, 10, 20)],
      ['milestone', 'Beta', day(2026, 11, 30)]
    ])
    expect(res[1].color).toBe(3)
  })

  it('marks the iterations of the chosen fields, without breaks, with their span', () => {
    const res = collectMarkers(params({ settings: { ...DEFAULT_MARKER_SETTINGS, iterations: ['sprint'] } }))
    expect(res.map((m) => [m.label, m.day, m.endDay])).toEqual([
      ['Sprint 1', day(2026, 10, 5), day(2026, 10, 11)],
      ['Sprint 2', day(2026, 10, 15), day(2026, 10, 21)]
    ])
  })

  it('ignores an iteration field that does not exist', () => {
    expect(collectMarkers(params({ settings: { ...DEFAULT_MARKER_SETTINGS, iterations: ['gone'] } }))).toEqual([])
  })

  it('marks the dates of the items with how many items fall on a day', () => {
    const res = collectMarkers(
      params({
        settings: { ...DEFAULT_MARKER_SETTINGS, dates: ['issue:dueDate'] },
        issues: [
          { dueDate: local(2026, 10, 9) },
          { dueDate: local(2026, 10, 9) },
          { dueDate: local(2026, 10, 12) },
          { dueDate: null }
        ]
      })
    )
    expect(res.map((m) => [m.kind, m.label, m.day, m.count])).toEqual([
      ['date', 'Due date', day(2026, 10, 9), 2],
      ['date', 'Due date', day(2026, 10, 12), 1]
    ])
  })

  it('reads custom Date fields and skips unknown or iteration sources', () => {
    const res = collectMarkers(
      params({
        settings: { ...DEFAULT_MARKER_SETTINGS, dates: ['field:release', 'field:gone', 'iteration:sprint'] },
        issues: [{ customFields: { release: local(2026, 12, 1) } }]
      })
    )
    expect(res.map((m) => m.label)).toEqual(['Release'])
  })

  it('combines all kinds in day order', () => {
    const res = collectMarkers(
      params({
        settings: { milestones: true, iterations: ['sprint'], dates: ['issue:dueDate'] },
        issues: [{ dueDate: local(2026, 10, 6) }]
      })
    )
    expect(res.map((m) => m.kind)).toEqual(['iteration', 'date', 'iteration', 'milestone', 'milestone'])
    for (let i = 1; i < res.length; i++) expect(res[i].day).toBeGreaterThanOrEqual(res[i - 1].day)
  })

  it('caps the number of date markers, keeping the busiest days', () => {
    const issues = Array.from({ length: 150 }, (_, i) => ({ dueDate: local(2026, 1, 1) + i * 86400000 * 2 }))
    // Day 0 gets three more items
    issues.push({ dueDate: local(2026, 1, 1) }, { dueDate: local(2026, 1, 1) }, { dueDate: local(2026, 1, 1) })
    const res = collectMarkers(params({ settings: { ...DEFAULT_MARKER_SETTINGS, dates: ['issue:dueDate'] }, issues }))
    expect(res).toHaveLength(100)
    expect(res.some((m) => m.day === day(2026, 1, 1) && m.count === 4)).toBe(true)
  })
})

describe('markersInRange', () => {
  const markers = [
    { id: 'a', kind: 'date' as const, day: 5, label: 'a' },
    { id: 'b', kind: 'iteration' as const, day: 8, endDay: 14, label: 'b' },
    { id: 'c', kind: 'date' as const, day: 20, label: 'c' }
  ]

  it('keeps markers whose line or span touches the range', () => {
    expect(markersInRange(markers, 10, 18).map((m) => m.id)).toEqual(['b'])
    expect(markersInRange(markers, 0, 6).map((m) => m.id)).toEqual(['a'])
    expect(markersInRange(markers, 20, 21).map((m) => m.id)).toEqual(['c'])
    expect(markersInRange(markers, 21, 30)).toEqual([])
  })
})

describe('toggleMarker', () => {
  it('flips milestones', () => {
    expect(toggleMarker(DEFAULT_MARKER_SETTINGS, { kind: 'milestones' }).milestones).toBe(true)
  })

  it('adds and removes list members without touching the original', () => {
    const on = toggleMarker(DEFAULT_MARKER_SETTINGS, { kind: 'iterations', id: 'sprint' })
    expect(on.iterations).toEqual(['sprint'])
    expect(DEFAULT_MARKER_SETTINGS.iterations).toEqual([])
    expect(toggleMarker(on, { kind: 'iterations', id: 'sprint' }).iterations).toEqual([])
    expect(toggleMarker(on, { kind: 'dates', id: 'issue:dueDate' }).dates).toEqual(['issue:dueDate'])
  })

  it('tells whether anything is marked', () => {
    expect(hasAnyMarker(DEFAULT_MARKER_SETTINGS)).toBe(false)
    expect(hasAnyMarker({ milestones: false, iterations: [], dates: ['x'] })).toBe(true)
  })
})
