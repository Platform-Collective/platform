//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { parseDateScalar, resolveDate } from '../filter/grammar/values'

// Per-type parsing and formatting of cell text, used by paste, fill and clear.
// Empty text means "clear the value": every parser answers null (or an empty list) for it.

/** @public */
export type ParseFailure = 'invalid' | 'unknown' | 'ambiguous' | 'readonly' | 'notClearable' | 'noColumn'

/** @public */
export type ParseResult<T> = { ok: true, value: T } | { ok: false, reason: ParseFailure }

/** @public */
export interface ValueOption<Id extends string | number = string> {
  id: Id
  label: string
}

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value })
const fail = <T>(reason: ParseFailure): ParseResult<T> => ({ ok: false, reason })

export function parseTextValue (text: string): ParseResult<string | null> {
  const value = text.trim()
  return ok(value === '' ? null : value)
}

export interface NumberParseOptions {
  integer?: boolean
  min?: number
}

export function parseNumberValue (text: string, options: NumberParseOptions = {}): ParseResult<number | null> {
  const raw = text.trim()
  if (raw === '') return ok(null)
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw)) return fail('invalid')
  const value = Number(raw)
  if (!Number.isFinite(value)) return fail('invalid')
  if (options.integer === true && !Number.isInteger(value)) return fail('invalid')
  if (options.min !== undefined && value < options.min) return fail('invalid')
  return ok(value)
}

const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/
const SLASH_DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/

/**
 * A date as the start of its local day. Understands `YYYY-MM-DD` (also followed by a time), `YYYY/M/D`,
 * `@today` and `@today+3d`, the syntaxes of the filter string.
 */
export function parseDateValue (text: string, now: number = Date.now()): ParseResult<number | null> {
  let raw = text.trim()
  if (raw === '') return ok(null)
  const iso = ISO_PREFIX.exec(raw)
  if (iso !== null) raw = iso[1]
  const slash = SLASH_DATE.exec(raw)
  if (slash !== null) raw = `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`
  const scalar = parseDateScalar(raw.toLowerCase())
  if (scalar === undefined || scalar.kind !== 'date') return fail('invalid')
  return ok(resolveDate(scalar, now))
}

/** `YYYY-MM-DD` of the local day, or empty text for no date. */
export function formatDateValue (value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const d = new Date(value)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatNumberValue (value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '' : String(value)
}

const norm = (s: string): string => s.trim().toLowerCase()

/**
 * Pick one option by its label (case insensitive), or by its id. The label wins over an id of another option.
 */
export function parseOptionValue<Id extends string | number> (
  text: string,
  options: ReadonlyArray<ValueOption<Id>>
): ParseResult<Id | null> {
  const raw = norm(text)
  if (raw === '') return ok(null)
  const byLabel = options.filter((o) => norm(o.label) === raw)
  if (byLabel.length === 1) return ok(byLabel[0].id)
  if (byLabel.length > 1) return fail('ambiguous')
  const byId = options.filter((o) => norm(String(o.id)) === raw)
  if (byId.length === 1) return ok(byId[0].id)
  return fail('unknown')
}

/**
 * Several options separated by a comma or a semicolon. One unknown name rejects the whole cell,
 * so that a paste never silently drops part of a value.
 */
export function parseMultiOptionValue<Id extends string | number> (
  text: string,
  options: ReadonlyArray<ValueOption<Id>>
): ParseResult<Id[]> {
  if (text.trim() === '') return ok([])
  const res: Id[] = []
  for (const part of text.split(/[,;]/)) {
    if (part.trim() === '') continue
    const one = parseOptionValue(part, options)
    if (!one.ok) return fail(one.reason)
    if (one.value !== null && !res.includes(one.value)) res.push(one.value)
  }
  return ok(res)
}

export function formatOptionValue<Id extends string | number> (
  id: Id | null | undefined,
  options: ReadonlyArray<ValueOption<Id>>
): string {
  if (id === null || id === undefined) return ''
  return options.find((o) => o.id === id)?.label ?? ''
}

export function formatMultiOptionValue<Id extends string | number> (
  ids: readonly Id[] | null | undefined,
  options: ReadonlyArray<ValueOption<Id>>
): string {
  if (ids === null || ids === undefined) return ''
  return ids
    .map((id) => formatOptionValue(id, options))
    .filter((s) => s !== '')
    .join(', ')
}
