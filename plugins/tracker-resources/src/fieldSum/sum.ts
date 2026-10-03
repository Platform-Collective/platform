//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { SummableField } from './config'

/** Sum of one field over a list of documents. */
export interface FieldSumResult {
  key: string
  label: string
  sum: number
  // Documents that have a number in the field
  count: number
}

/** The number a raw value stands for; anything that is not a finite number (also `NaN`, text, empty) is none. */
export function toSummable (raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * Sum of the numbers among the values. The values that are not numbers are ignored, they neither poison the sum
 * nor count. The sum is compensated (Neumaier), so that `0.1 + 0.2` is `0.3` and long lists do not drift.
 */
export function sumNumbers (values: Iterable<unknown>): { sum: number, count: number } {
  let sum = 0
  let compensation = 0
  let count = 0
  for (const raw of values) {
    const n = toSummable(raw)
    if (n === undefined) continue
    count++
    // A sum that overflowed stays infinite (it never turns into NaN), the rest is only counted
    if (!Number.isFinite(sum)) continue
    const t = sum + n
    if (!Number.isFinite(t)) {
      sum = t
      continue
    }
    compensation += Math.abs(sum) >= Math.abs(n) ? sum - t + n : n - t + sum
    sum = t
  }
  return { sum: Number.isFinite(sum) ? sum + compensation : sum, count }
}

/** Sums of the fields over the documents, one result per field, in the order of the fields. */
export function computeFieldSums (docs: readonly unknown[], fields: readonly SummableField[]): FieldSumResult[] {
  return fields.map((field) => {
    const { sum, count } = sumNumbers(docs.map((doc) => field.read(doc)))
    return { key: field.key, label: field.label, sum, count }
  })
}

/**
 * Sums per group. `groupOf` gives the group of a document; the documents of a group are summed over their own,
 * a document is in exactly one group.
 */
export function computeFieldSumsByGroup<T> (
  docs: readonly T[],
  fields: readonly SummableField[],
  groupOf: (doc: T) => string
): Map<string, FieldSumResult[]> {
  const groups = new Map<string, T[]>()
  for (const doc of docs) {
    const group = groupOf(doc)
    const list = groups.get(group)
    if (list === undefined) groups.set(group, [doc])
    else list.push(doc)
  }
  const res = new Map<string, FieldSumResult[]>()
  for (const [group, list] of groups) res.set(group, computeFieldSums(list, fields))
  return res
}

/** A sum as text: at most two decimals, no trailing zeros, no `-0`. */
export function formatSumValue (value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : value < 0 ? '-∞' : '0'
  // Beyond 2^53 / 100 there are no decimals left to round
  const rounded = Math.abs(value) >= 1e13 ? value : Math.round(value * 100) / 100
  const text = String(Object.is(rounded, -0) ? 0 : rounded)
  // Very large or small numbers print in exponent form; show them in full
  return /e/i.test(text) ? rounded.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 2 }) : text
}

/**
 * The sums as one line, e.g. `Estimation: 12 · Story points: 5`. Nothing for no fields, so that a view without
 * sums shows nothing.
 */
export function formatFieldSums (results: readonly FieldSumResult[], withLabels: boolean = true): string | undefined {
  if (results.length === 0) return undefined
  return results.map((r) => (withLabels ? `${r.label}: ${formatSumValue(r.sum)}` : formatSumValue(r.sum))).join(' · ')
}
