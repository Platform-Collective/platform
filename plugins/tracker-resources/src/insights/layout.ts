//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { InsightLayout } from '@hcengineering/tracker'
import { formatSumValue } from '../fieldSum/sum'
import type { ChartData } from './aggregate'
import { isHorizontalLayout, isStackedLayout } from './config'

// The geometry of a chart in pixels: scales, ticks, bars, lines and areas. Pure, so that the drawing component only
// has to put the shapes on the page and the layouts can be tested without a browser.

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Tick {
  value: number
  // Position along the value axis (x for a horizontal layout, y otherwise)
  position: number
  label: string
}

export interface CategoryTick {
  index: number
  // Centre of the band of the category along the category axis
  center: number
  // Size of the band of the category
  band: number
  // The label is shown; with many categories only every n-th one is
  visible: boolean
}

/** A bar, or the segment of a stacked bar. */
export interface BarMark extends Rect {
  series: number
  category: number
  value: number
}

export interface PointMark {
  x: number
  y: number
  series: number
  category: number
  value: number
}

/** A line of a series: the points drawn as one path, a gap (no value, "No <field>") starts a new one. */
export interface LineMark {
  series: number
  segments: string[]
  points: PointMark[]
}

/** A band of a stacked area: closed paths, one per run of categories. */
export interface AreaMark {
  series: number
  paths: string[]
}

export interface ChartGeometry {
  layout: InsightLayout
  horizontal: boolean
  plot: Rect
  valueTicks: Tick[]
  categoryTicks: CategoryTick[]
  // Position of the value 0 along the value axis
  baseline: number
  bars: BarMark[]
  lines: LineMark[]
  areas: AreaMark[]
}

export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

// ---- scales ----

function niceNumber (raw: number): number {
  const exp = Math.floor(Math.log10(raw))
  const f = raw / Math.pow(10, exp)
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nice * Math.pow(10, exp)
}

export interface NiceScale {
  min: number
  max: number
  step: number
  ticks: number[]
}

/**
 * A value axis that covers [min, max] and always contains 0: round bounds, a round step, about `target` ticks.
 * An empty range (all values 0) becomes 0..1.
 */
export function niceScale (min: number, max: number, target: number = 5): NiceScale {
  let lo = Math.min(0, min)
  let hi = Math.max(0, max)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    lo = 0
    hi = 1
  }
  const step = niceNumber((hi - lo) / Math.max(1, target))
  const niceMin = Math.floor(lo / step) * step
  const niceMax = Math.ceil(hi / step) * step
  const ticks: number[] = []
  const count = Math.round((niceMax - niceMin) / step)
  for (let i = 0; i <= count; i++) {
    // Rounding keeps 0.1 + 0.2 style noise out of the labels
    ticks.push(Number((niceMin + i * step).toPrecision(12)))
  }
  return { min: niceMin, max: niceMax, step, ticks }
}

/** A number as an axis label. */
export function formatTick (value: number): string {
  return formatSumValue(value)
}

/** The shortest `max` characters of a label, with an ellipsis when it was cut. */
export function truncateLabel (label: string, max: number): string {
  if (max < 1) return ''
  const chars = [...label]
  if (chars.length <= max) return label
  return max === 1 ? '…' : `${chars.slice(0, max - 1).join('')}…`
}

/** Pixels of a character of the axis labels; the estimate sizes the margins for the longest label. */
export const CHAR_WIDTH = 6.5

/** Width the labels of the category axis need (horizontal layouts), within sane bounds. */
export function categoryLabelWidth (labels: readonly string[], min: number = 40, max: number = 180): number {
  const longest = labels.reduce((m, l) => Math.max(m, [...l].length), 0)
  return Math.min(max, Math.max(min, Math.ceil(longest * CHAR_WIDTH) + 12))
}

// ---- data ----

interface Stack {
  // Sum of the positive values and of the negative ones by category
  positive: number[]
  negative: number[]
}

function stackTotals (data: ChartData): Stack {
  const n = data.categories.length
  const positive = new Array<number>(n).fill(0)
  const negative = new Array<number>(n).fill(0)
  for (const row of data.values) {
    row.forEach((v, i) => {
      if (v === null) return
      if (v >= 0) positive[i] += v
      else negative[i] += v
    })
  }
  return { positive, negative }
}

/** The range of the values the layout draws, before it is rounded to an axis. */
export function valueRange (data: ChartData, layout: InsightLayout): { min: number, max: number } {
  if (isStackedLayout(layout)) {
    const { positive, negative } = stackTotals(data)
    return { min: Math.min(0, ...negative), max: Math.max(0, ...positive) }
  }
  let min = 0
  let max = 0
  for (const row of data.values) {
    for (const v of row) {
      if (v === null) continue
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
  }
  return { min, max }
}

function labelStep (count: number, room: number, each: number): number {
  const fits = Math.max(1, Math.floor(room / each))
  return Math.max(1, Math.ceil(count / fits))
}

// ---- geometry ----

function pointText (x: number, y: number): string {
  return `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`
}

/**
 * Places everything of a chart in a box. The plot is the box less the margins (room for the labels); the caller
 * decides the margins, see `categoryLabelWidth` and `formatTick`.
 */
export function computeGeometry (data: ChartData, layout: InsightLayout, size: Size, margins: Margins): ChartGeometry {
  const horizontal = isHorizontalLayout(layout)
  const stacked = isStackedLayout(layout)
  const plot: Rect = {
    x: margins.left,
    y: margins.top,
    width: Math.max(1, size.width - margins.left - margins.right),
    height: Math.max(1, size.height - margins.top - margins.bottom)
  }
  const range = valueRange(data, layout)
  const scale = niceScale(range.min, range.max)
  const span = scale.max - scale.min
  // Position of a value along the value axis
  const at = (v: number): number =>
    horizontal ? plot.x + ((v - scale.min) / span) * plot.width : plot.y + plot.height - ((v - scale.min) / span) * plot.height

  const valueTicks = scale.ticks.map((value) => ({ value, position: at(value), label: formatTick(value) }))
  const count = data.categories.length
  const length = horizontal ? plot.height : plot.width
  const band = count > 0 ? length / count : length
  const start = horizontal ? plot.y : plot.x
  const step = labelStep(count, length, horizontal ? 16 : 56)
  const categoryTicks: CategoryTick[] = data.categories.map((_c, index) => ({
    index,
    center: start + band * (index + 0.5),
    band,
    visible: index % step === 0
  }))

  const geometry: ChartGeometry = {
    layout,
    horizontal,
    plot,
    valueTicks,
    categoryTicks,
    baseline: at(0),
    bars: [],
    lines: [],
    areas: []
  }
  if (count === 0) return geometry

  const isLine = layout === 'line'
  const isArea = layout === 'stackedArea'
  if (!isLine && !isArea) {
    geometry.bars = barMarks(data, stacked, horizontal, plot, band, at)
    return geometry
  }

  const centers = categoryTicks.map((t) => t.center)
  if (isLine) {
    geometry.lines = data.values.map((row, series) => lineMark(row, series, centers, data, at))
    return geometry
  }

  // Stacked area: the items without a value cannot be joined to the dates, they stand as a stacked bar
  const stack = areaStack(data)
  geometry.areas = data.values.map((_row, series) => ({
    series,
    paths: areaPaths(series, stack, data, centers, band, at)
  }))
  const noneIndex = data.categories.findIndex((c) => c.none)
  if (noneIndex !== -1) geometry.bars = noneBars(data, noneIndex, band, plot, at)
  return geometry
}

function barMarks (
  data: ChartData,
  stacked: boolean,
  horizontal: boolean,
  plot: Rect,
  band: number,
  at: (v: number) => number
): BarMark[] {
  const bars: BarMark[] = []
  const seriesCount = data.series.length
  const groupSize = band * 0.7
  const positive = new Array<number>(data.categories.length).fill(0)
  const negative = new Array<number>(data.categories.length).fill(0)
  data.values.forEach((row, series) => {
    row.forEach((value, category) => {
      if (value === null || value === 0) return
      const origin = (horizontal ? plot.y : plot.x) + band * category + (band - groupSize) / 2
      const size = stacked ? groupSize : groupSize / seriesCount
      const offset = stacked ? 0 : size * series
      let from: number
      let to: number
      if (stacked) {
        const base = value >= 0 ? positive[category] : negative[category]
        from = base
        to = base + value
        if (value >= 0) positive[category] = to
        else negative[category] = to
      } else {
        from = 0
        to = value
      }
      const a = at(from)
      const b = at(to)
      const low = Math.min(a, b)
      const length = Math.abs(a - b)
      bars.push(
        horizontal
          ? { x: low, y: origin + offset, width: length, height: size, series, category, value }
          : { x: origin + offset, y: low, width: size, height: length, series, category, value }
      )
    })
  })
  return bars
}

function lineMark (
  row: ReadonlyArray<number | null>,
  series: number,
  centers: readonly number[],
  data: ChartData,
  at: (v: number) => number
): LineMark {
  const points: PointMark[] = []
  const segments: string[] = []
  let current: string[] = []
  const flush = (): void => {
    // A run of one point is only a marker, it has no path
    if (current.length > 1) segments.push(`M${current.join('L')}`)
    current = []
  }
  row.forEach((value, category) => {
    if (value === null) {
      flush()
      return
    }
    const x = centers[category]
    const y = at(value)
    points.push({ x, y, series, category, value })
    if (data.categories[category].none) {
      flush()
      return
    }
    current.push(pointText(x, y))
  })
  flush()
  return { series, segments, points }
}

interface AreaStack {
  // Top of each series by category: the sum of the values of the series up to it
  tops: number[][]
}

function areaStack (data: ChartData): AreaStack {
  const n = data.categories.length
  const running = new Array<number>(n).fill(0)
  const tops: number[][] = []
  for (const row of data.values) {
    const top = row.map((v, i) => {
      running[i] += v ?? 0
      return running[i]
    })
    tops.push(top)
  }
  return { tops }
}

function areaPaths (
  series: number,
  stack: AreaStack,
  data: ChartData,
  centers: readonly number[],
  band: number,
  at: (v: number) => number
): string[] {
  const paths: string[] = []
  const tops = stack.tops[series]
  const bottoms = series === 0 ? tops.map(() => 0) : stack.tops[series - 1]
  let run: number[] = []
  const flush = (): void => {
    if (run.length === 1) {
      // A single date has no neighbour to join: it is drawn as a narrow column
      const i = run[0]
      const left = centers[i] - band * 0.15
      const right = centers[i] + band * 0.15
      paths.push(`M${pointText(left, at(tops[i]))}L${pointText(right, at(tops[i]))}L${pointText(right, at(bottoms[i]))}L${pointText(left, at(bottoms[i]))}Z`)
    } else if (run.length > 1) {
      const upper = run.map((i) => pointText(centers[i], at(tops[i])))
      const lower = [...run].reverse().map((i) => pointText(centers[i], at(bottoms[i])))
      paths.push(`M${upper.join('L')}L${lower.join('L')}Z`)
    }
    run = []
  }
  data.categories.forEach((c, i) => {
    if (c.none) flush()
    else run.push(i)
  })
  flush()
  return paths
}

function noneBars (data: ChartData, category: number, band: number, plot: Rect, at: (v: number) => number): BarMark[] {
  const bars: BarMark[] = []
  const width = band * 0.5
  let top = 0
  data.values.forEach((row, series) => {
    const value = row[category]
    if (value === null || value <= 0) return
    const a = at(top)
    const b = at(top + value)
    top += value
    bars.push({ x: plot.x + band * category + (band - width) / 2, y: Math.min(a, b), width, height: Math.abs(a - b), series, category, value })
  })
  return bars
}
