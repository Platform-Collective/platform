//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { FieldSpec, FieldValue, FilterContext, IterationInfo, Node, Scalar } from './types'
import { containsGlob, endOfDay, matchGlob, resolveDate, resolveIteration } from './values'

// Client-side evaluation of a parsed filter over a document. It defines the semantics of the
// grammar; the server query built by compile.ts must select the same documents.

/**
 * Whether a document is archived: it has an archive timestamp (`archivedAt`), a restored one carries `null`.
 * @public
 */
export function isArchivedDoc (doc: any): boolean {
  return doc?.archivedAt !== undefined && doc?.archivedAt !== null
}

/**
 * Raw value of a field in a document.
 * @public
 */
export function readFieldValue (field: FieldSpec, doc: any): unknown {
  if (field.read !== undefined) return field.read(doc)
  if (field.source === 'custom') return doc?.customFields?.[field.key]
  return doc?.[field.key]
}

/**
 * A value counts as empty when it is missing, null, an empty string or an empty list.
 * @public
 */
export function isEmptyValue (value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/**
 * Option ids a select / user / multi value refers to. A text value is matched against the option
 * labels (`*` wildcards) and, as a fallback, against the ids themselves.
 * @public
 */
export function optionIdsFor (field: FieldSpec, scalar: Scalar, ctx: FilterContext): Array<string | number> {
  if (scalar.kind === 'me') return ctx.me !== undefined ? [ctx.me] : []
  if (scalar.kind !== 'text') return []
  const options = field.options ?? []
  const byName = options.filter((o) => matchGlob(scalar.text, o.name)).map((o) => o.id)
  if (byName.length > 0) return byName
  return options.filter((o) => String(o.id) === scalar.text).map((o) => o.id)
}

/**
 * Inclusive bounds of the days a date scalar covers; for one day they are its first and last millisecond.
 */
function dayBounds (scalar: Scalar, ctx: FilterContext): { start: number, end: number } | undefined {
  if (scalar.kind !== 'date') return undefined
  const start = resolveDate(scalar, ctx.now)
  return { start, end: endOfDay(start) }
}

function numberOf (scalar: Scalar | undefined): number | undefined {
  return scalar?.kind === 'number' ? scalar.value : undefined
}

function iterationOf (
  field: FieldSpec,
  scalar: Scalar | undefined,
  ctx: FilterContext
): IterationInfo | undefined {
  if (scalar === undefined) return undefined
  const list = ctx.iterations?.(field.key) ?? []
  if (scalar.kind === 'iteration') return resolveIteration(scalar, list, ctx.now)
  if (scalar.kind === 'text') return list.find((it) => matchGlob(scalar.text, it.title) || it.id === scalar.text)
  return undefined
}

/**
 * The window of the value a bound-based match works on: [lo, hi] where a missing bound is open.
 * `exclusiveLo` / `exclusiveHi` are not needed, because every bound is expressed inclusively.
 */
interface Window {
  lo?: number
  hi?: number
}

function windowOf (field: FieldSpec, value: FieldValue, ctx: FilterContext): Window | 'none' {
  if (field.type === 'number') {
    switch (value.kind) {
      case 'eq':
        return numberOf(value.value) === undefined ? 'none' : { lo: numberOf(value.value), hi: numberOf(value.value) }
      case 'compare': {
        const n = numberOf(value.value)
        if (n === undefined) return 'none'
        // Strict comparisons are expressed on the closed window by the caller
        return value.op === '>' || value.op === '>=' ? { lo: n } : { hi: n }
      }
      case 'range':
        return { lo: numberOf(value.from), hi: numberOf(value.to) }
    }
  }
  // Dates: whole calendar days
  switch (value.kind) {
    case 'eq': {
      const d = dayBounds(value.value, ctx)
      return d === undefined ? 'none' : { lo: d.start, hi: d.end }
    }
    case 'compare': {
      const d = dayBounds(value.value, ctx)
      if (d === undefined) return 'none'
      switch (value.op) {
        case '>':
          return { lo: d.end + 1 }
        case '>=':
          return { lo: d.start }
        case '<':
          return { hi: d.start - 1 }
        default:
          return { hi: d.end }
      }
    }
    case 'range': {
      const from = value.from !== undefined ? dayBounds(value.from, ctx) : undefined
      const to = value.to !== undefined ? dayBounds(value.to, ctx) : undefined
      if ((value.from !== undefined && from === undefined) || (value.to !== undefined && to === undefined)) return 'none'
      return { lo: from?.start, hi: to?.end }
    }
  }
}

/**
 * Window of numeric / date comparisons for the compiler. Numbers compare exactly (so `>5` is `> 5`),
 * which needs a flag; dates are widened to whole days and need none.
 * @public
 */
export interface NumericMatch {
  lo?: number
  hi?: number
  // Bounds exclude their value (numbers only)
  loExclusive?: boolean
  hiExclusive?: boolean
}

/**
 * Bounds of a number / date value, or undefined when the value cannot match anything.
 * @public
 */
export function numericMatch (field: FieldSpec, value: FieldValue, ctx: FilterContext): NumericMatch | undefined {
  const w = windowOf(field, value, ctx)
  if (w === 'none') return undefined
  const res: NumericMatch = { lo: w.lo, hi: w.hi }
  if (field.type === 'number' && value.kind === 'compare') {
    if (value.op === '>') res.loExclusive = true
    if (value.op === '<') res.hiExclusive = true
  }
  return res
}

function inWindow (v: number, m: NumericMatch): boolean {
  if (m.lo !== undefined && (m.loExclusive === true ? v <= m.lo : v < m.lo)) return false
  if (m.hi !== undefined && (m.hiExclusive === true ? v >= m.hi : v > m.hi)) return false
  return true
}

function matchValue (field: FieldSpec, value: FieldValue, raw: unknown, ctx: FilterContext): boolean {
  switch (field.type) {
    case 'text': {
      if (value.kind !== 'eq' || value.value.kind !== 'text' || typeof raw !== 'string') return false
      return containsGlob(value.value.text, raw)
    }
    case 'number':
    case 'date': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return false
      const m = numericMatch(field, value, ctx)
      return m !== undefined && inWindow(raw, m)
    }
    case 'iteration': {
      if (typeof raw !== 'string') return false
      if (value.kind === 'eq') {
        const target = iterationOf(field, value.value, ctx)
        return target !== undefined && target.id === raw
      }
      const own = (ctx.iterations?.(field.key) ?? []).find((it) => it.id === raw)
      if (own === undefined) return false
      if (value.kind === 'compare') {
        const ref = iterationOf(field, value.value, ctx)
        if (ref === undefined) return false
        switch (value.op) {
          case '>':
            return own.start > ref.start
          case '>=':
            return own.start >= ref.start
          case '<':
            return own.start < ref.start
          default:
            return own.start <= ref.start
        }
      }
      const from = value.from !== undefined ? iterationOf(field, value.from, ctx) : undefined
      const to = value.to !== undefined ? iterationOf(field, value.to, ctx) : undefined
      if ((value.from !== undefined && from === undefined) || (value.to !== undefined && to === undefined)) return false
      return (from === undefined || own.start >= from.start) && (to === undefined || own.start <= to.start)
    }
    default: {
      // select, user, multi
      if (value.kind !== 'eq') return false
      const ids = new Set(optionIdsFor(field, value.value, ctx).map(String))
      if (Array.isArray(raw)) return raw.some((x) => ids.has(String(x)))
      return !isEmptyValue(raw) && ids.has(String(raw))
    }
  }
}

/**
 * Whether a document matches one `field:value` term (any of its comma separated values).
 * @public
 */
export function matchesField (field: FieldSpec, values: readonly FieldValue[], doc: any, ctx: FilterContext): boolean {
  const raw = readFieldValue(field, doc)
  return values.some((v) => matchValue(field, v, raw, ctx))
}

/**
 * Whether a document matches the AST.
 * @public
 */
export function evaluate (node: Node, doc: any, ctx: FilterContext): boolean {
  switch (node.type) {
    case 'and':
      return node.children.every((c) => evaluate(c, doc, ctx))
    case 'or':
      return node.children.some((c) => evaluate(c, doc, ctx))
    case 'not':
      return !evaluate(node.child, doc, ctx)
    case 'text':
      return containsGlob(node.value, String(doc?.title ?? ''))
    case 'field':
      return matchesField(node.field, node.values, doc, ctx)
    case 'presence': {
      const empty = isEmptyValue(readFieldValue(node.field, doc))
      return node.present ? !empty : empty
    }
    case 'is': {
      switch (node.state) {
        case 'open':
          return !(ctx.closedStatuses?.has(String(doc?.status)) ?? false)
        case 'closed':
          return ctx.closedStatuses?.has(String(doc?.status)) ?? false
        case 'sub-issue':
          return ctx.noParentId !== undefined && doc?.attachedTo !== ctx.noParentId
        case 'archived':
          return isArchivedDoc(doc)
        default:
          return true
      }
    }
  }
}

/**
 * Predicate for a node, or for "everything" when there is nothing left to evaluate.
 * @public
 */
export function createPredicate (node: Node | undefined, ctx: FilterContext): (doc: any) => boolean {
  if (node === undefined) return () => true
  return (doc) => evaluate(node, doc, ctx)
}
