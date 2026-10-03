//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { findField, IS_VALUES } from './parser'
import { tokenize } from './tokenizer'
import type { FieldSpec, Token } from './types'

/**
 * @public
 */
export interface Suggestion {
  kind: 'field' | 'value'
  // Shown in the list
  label: string
  // Replaces the typed fragment [from, to) of the input
  insert: string
}

/**
 * @public
 */
export interface SuggestionResult {
  from: number
  to: number
  items: Suggestion[]
}

const MAX_ITEMS = 12
const PSEUDO_FIELDS = ['has', 'no', 'is']

// Start of the term the caret is in: after the last whitespace or "(" that is not inside quotes
function termStart (text: string, caret: number): number {
  let start = 0
  let quoted = false
  for (let i = 0; i < caret; i++) {
    const c = text[i]
    if (c === '"' && text[i - 1] !== '\\') quoted = !quoted
    else if (!quoted && (c === ' ' || c === '\t' || c === '\n' || c === '(' || c === ')')) start = i + 1
  }
  return start
}

// OR outside of any parentheses
function hasTopLevelOr (tokens: Token[]): boolean {
  let depth = 0
  for (const t of tokens) {
    if (t.type === 'lparen') depth++
    else if (t.type === 'rparen') depth--
    else if (t.type === 'or' && depth === 0) return true
  }
  return false
}

function quoteIfNeeded (value: string): string {
  return /[\s,:()"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
}

function valueSuggestions (field: FieldSpec): string[] {
  const options = (field.options ?? []).map((o) => o.name)
  switch (field.type) {
    case 'user':
      return ['@me', ...options]
    case 'date':
      return ['@today', '@today-7d', '@today+7d']
    case 'iteration':
      return ['@current', '@next', '@previous', ...options]
    default:
      return options
  }
}

/**
 * Autocomplete suggestions for the term at the caret: field names (with `has`, `no`, `is`) when the
 * term has no colon yet, otherwise the known values of the typed field.
 * @public
 */
export function suggest (text: string, caret: number, schema: readonly FieldSpec[]): SuggestionResult {
  const start = termStart(text, caret)
  let from = start
  let word = text.slice(start, caret)
  if (word.startsWith('-')) {
    from++
    word = word.slice(1)
  }

  const colon = word.indexOf(':')
  if (colon === -1) {
    const typed = word.toLowerCase()
    const names = [...schema.map((f) => f.name), ...PSEUDO_FIELDS]
    const items = names
      .filter((n) => n.startsWith(typed) && n !== typed)
      .slice(0, MAX_ITEMS)
      .map((n): Suggestion => ({ kind: 'field', label: n, insert: `${n}:` }))
    return { from, to: caret, items }
  }

  const name = word.slice(0, colon).toLowerCase()
  from += colon + 1
  let rest = word.slice(colon + 1)
  // Only the value after the last comma outside quotes is completed
  let comma = -1
  let quoted = false
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '"') quoted = !quoted
    else if (rest[i] === ',' && !quoted) comma = i
  }
  if (comma !== -1) {
    from += comma + 1
    rest = rest.slice(comma + 1)
  }
  const opMatch = /^(>=|<=|>|<)/.exec(rest)
  if (opMatch !== null) {
    from += opMatch[0].length
    rest = rest.slice(opMatch[0].length)
  }
  const typed = rest.replace(/^"/, '').toLowerCase()

  let candidates: string[]
  if (name === 'has' || name === 'no') candidates = schema.map((f) => f.name)
  else if (name === 'is') candidates = IS_VALUES
  else {
    const field = findField(schema, name)
    candidates = field === undefined ? [] : valueSuggestions(field)
  }
  const items = [...new Set(candidates)]
    .filter((c) => c.toLowerCase().startsWith(typed) && c.toLowerCase() !== typed)
    .slice(0, MAX_ITEMS)
    .map((c): Suggestion => ({ kind: 'value', label: c, insert: quoteIfNeeded(c) }))
  return { from, to: caret, items }
}

/**
 * Applies a suggestion to the input; returns the new text and caret position.
 * @public
 */
export function applySuggestion (
  text: string,
  result: SuggestionResult,
  item: Suggestion
): { text: string, caret: number } {
  const next = text.slice(0, result.from) + item.insert + text.slice(result.to)
  return { text: next, caret: result.from + item.insert.length }
}

/**
 * Adds `field:value` as one more AND condition to a filter string (the "click a value to filter" action).
 * A term that is already there is not repeated; a filter with a top level OR is parenthesized first so
 * that the new condition applies to the whole of it.
 * @public
 */
export function appendTerm (query: string, field: string, value: string): string {
  const term = `${field}:${quoteIfNeeded(value)}`
  const trimmed = query.trim()
  if (trimmed === '') return term
  const tokens = tokenize(trimmed)
  if (tokens.ok) {
    const present = tokens.value.some((t) => t.type === 'term' && !t.negated && trimmed.slice(t.pos, t.end) === term)
    if (present) return trimmed
    if (hasTopLevelOr(tokens.value)) return `(${trimmed}) ${term}`
  }
  return `${trimmed} ${term}`
}

/**
 * Joins two filter strings with AND; a part with a top level OR is parenthesized so that it keeps its meaning.
 * @public
 */
export function joinAnd (a: string, b: string): string {
  const left = a.trim()
  const right = b.trim()
  if (left === '') return right
  if (right === '') return left
  const wrap = (text: string): string => {
    const tokens = tokenize(text)
    return tokens.ok && hasTopLevelOr(tokens.value) ? `(${text})` : text
  }
  return `${wrap(left)} ${wrap(right)}`
}
