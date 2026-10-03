//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { DateUnit, IterationInfo, Scalar } from './types'

// Pure helpers for the value syntaxes of the grammar: dates, iterations and wildcards.

/** Start of the local calendar day containing the timestamp. */
export function startOfDay (ts: number): number {
  return new Date(ts).setHours(0, 0, 0, 0)
}

/** Last millisecond of the local calendar day containing the timestamp. */
export function endOfDay (ts: number): number {
  return new Date(ts).setHours(23, 59, 59, 999)
}

const ABSOLUTE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const RELATIVE_DATE = /^@today(?:([+-])(\d+)([dwmy]))?$/
const ITERATION = /^@(current|next|previous)(?:([+-])(\d+))?$/

/**
 * Parses `YYYY-MM-DD`, `@today` or `@today[+-]N(d|w|m|y)`. Returns undefined for anything else,
 * including calendar dates that do not exist (2024-02-31).
 * @public
 */
export function parseDateScalar (text: string): Scalar | undefined {
  const abs = ABSOLUTE_DATE.exec(text)
  if (abs !== null) {
    const [y, m, d] = [Number(abs[1]), Number(abs[2]), Number(abs[3])]
    const date = new Date(y, m - 1, d)
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return undefined
    return { kind: 'date', abs: date.getTime(), amount: 0, unit: 'd' }
  }
  const rel = RELATIVE_DATE.exec(text)
  if (rel !== null) {
    if (rel[1] === undefined) return { kind: 'date', amount: 0, unit: 'd' }
    const amount = Number(rel[2]) * (rel[1] === '-' ? -1 : 1)
    return { kind: 'date', amount, unit: rel[3] as DateUnit }
  }
  return undefined
}

function shiftDate (base: number, amount: number, unit: DateUnit): number {
  const date = new Date(base)
  switch (unit) {
    case 'd':
      date.setDate(date.getDate() + amount)
      break
    case 'w':
      date.setDate(date.getDate() + amount * 7)
      break
    case 'm': {
      // Clamp to the end of a shorter month instead of overflowing into the next one
      const day = date.getDate()
      date.setDate(1)
      date.setMonth(date.getMonth() + amount)
      const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      date.setDate(Math.min(day, last))
      break
    }
    case 'y': {
      const day = date.getDate()
      date.setDate(1)
      date.setFullYear(date.getFullYear() + amount)
      const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      date.setDate(Math.min(day, last))
      break
    }
  }
  return date.getTime()
}

/**
 * Start of the day a date scalar refers to.
 * @public
 */
export function resolveDate (scalar: Extract<Scalar, { kind: 'date' }>, now: number): number {
  if (scalar.abs !== undefined) return scalar.abs
  return startOfDay(shiftDate(startOfDay(now), scalar.amount, scalar.unit))
}

/**
 * Parses `@current`, `@next`, `@previous` with optional `+N` / `-N` arithmetic.
 * @public
 */
export function parseIterationScalar (text: string): Scalar | undefined {
  const m = ITERATION.exec(text)
  if (m === null) return undefined
  const offset = m[2] === undefined ? 0 : Number(m[3]) * (m[2] === '-' ? -1 : 1)
  return { kind: 'iteration', keyword: m[1] as 'current' | 'next' | 'previous', offset }
}

/**
 * Resolves an iteration keyword against the iterations of a field. `@current` is the iteration that
 * contains `now`, `@next` and `@previous` its neighbours (in a gap between iterations the closest
 * upcoming / finished one), `+N` / `-N` steps over further iterations. Undefined when there is none.
 * @public
 */
export function resolveIteration (
  scalar: Extract<Scalar, { kind: 'iteration' }>,
  iterations: readonly IterationInfo[],
  now: number
): IterationInfo | undefined {
  const sorted = [...iterations].sort((a, b) => a.start - b.start)
  const current = sorted.findIndex((it) => it.start <= now && now <= it.end)
  let base: number
  if (current >= 0) {
    base = scalar.keyword === 'current' ? current : scalar.keyword === 'next' ? current + 1 : current - 1
  } else if (scalar.keyword === 'current') {
    return undefined
  } else if (scalar.keyword === 'next') {
    base = sorted.findIndex((it) => it.start > now)
  } else {
    base = -1
    sorted.forEach((it, i) => {
      if (it.end < now) base = i
    })
  }
  if (base < 0) return undefined
  return sorted[base + scalar.offset]
}

/**
 * Case-insensitive match of a label against a pattern where `*` matches any run of characters.
 * Without a wildcard the whole label has to be equal.
 * @public
 */
export function matchGlob (pattern: string, label: string): boolean {
  const p = pattern.toLowerCase()
  const l = label.toLowerCase()
  if (!p.includes('*')) return p === l
  const parts = p.split('*')
  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === '') continue
    const idx = l.indexOf(part, pos)
    if (idx === -1) return false
    if (i === 0 && idx !== 0) return false
    pos = idx + part.length
  }
  const last = parts[parts.length - 1]
  return last === '' || l.endsWith(last)
}

/**
 * Case-insensitive substring match where `*` matches any run of characters.
 * @public
 */
export function containsGlob (pattern: string, text: string): boolean {
  return matchGlob(`*${pattern}*`, text)
}
