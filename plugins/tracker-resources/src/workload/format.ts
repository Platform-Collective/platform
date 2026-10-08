//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { LoadMeasure } from './config'

/** A number for a cell or a tooltip: finite, with at most `digits` decimals and no trailing zeros. */
export function formatAmount (value: number, locale?: string, digits: number = 1): string {
  const safe = Number.isFinite(value) ? value : 0
  // Avoid "-0"
  const rounded = Math.round(safe * 10 ** digits) / 10 ** digits
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(rounded === 0 ? 0 : rounded)
}

/** An amount with its unit: hours for the estimate and the remaining time, a plain number for the others. */
export function formatLoadValue (value: number, measure: LoadMeasure, locale?: string, digits: number = 1): string {
  const safe = Number.isFinite(value) ? value : 0
  const hours = measure === 'estimate' || measure === 'remaining'
  if (!hours) return formatAmount(safe, locale, digits)
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'hour',
      unitDisplay: 'narrow',
      maximumFractionDigits: digits
    }).format(Math.round(safe * 10 ** digits) / 10 ** digits || 0)
  } catch {
    return `${formatAmount(safe, locale, digits)}h`
  }
}

/** A share of the capacity as a whole percent, "100%" for 1. */
export function formatPercent (ratio: number, locale?: string): string {
  const safe = Number.isFinite(ratio) ? ratio : 0
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(Math.round(safe * 100) / 100)
}
