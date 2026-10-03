//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ParseError, Result, Token, ValueToken } from './types'

// Letters of any script: field names of user-defined fields come from their labels
const FIELD_NAME = /^\p{L}[\p{L}\p{N}_.-]*$/u

function isSpace (c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r'
}

/**
 * Splits a filter string into tokens. Never throws: a malformed string yields `{ ok: false, error }`.
 *
 * - `field:a,b` is one term with several comma separated values, `-field:a` is negated
 * - double quotes keep spaces, commas, colons and parentheses inside a value; `\"` is a quote
 * - `AND`, `OR` (upper case, standalone) and parentheses are operators
 * @public
 */
export function tokenize (input: string): Result<Token[]> {
  const tokens: Token[] = []
  const n = input.length
  let i = 0

  while (i < n) {
    const c = input[i]
    if (isSpace(c)) {
      i++
      continue
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', pos: i, end: i + 1 })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', pos: i, end: i + 1 })
      i++
      continue
    }
    if (c === '-' && input[i + 1] === '(') {
      tokens.push({ type: 'not', pos: i, end: i + 1 })
      i++
      continue
    }

    const start = i
    let negated = false
    if (c === '-' && i + 1 < n && !isSpace(input[i + 1])) {
      negated = true
      i++
    }

    let field: { name: string, pos: number, end: number } | undefined
    const values: ValueToken[] = []
    let cur: ValueToken = { text: '', quoted: false, pos: i, end: i }
    const textStart = i

    while (i < n) {
      const ch = input[i]
      if (isSpace(ch) || ch === ')') break
      if (ch === '"') {
        let j = i + 1
        let text = ''
        let closed = false
        while (j < n) {
          if (input[j] === '\\' && input[j + 1] === '"') {
            text += '"'
            j += 2
            continue
          }
          if (input[j] === '"') {
            closed = true
            break
          }
          text += input[j]
          j++
        }
        if (!closed) return fail('unterminatedQuote', 'Unterminated quote', i, n)
        cur.text += text
        cur.quoted = true
        i = j + 1
        continue
      }
      if (ch === ':' && field === undefined && !cur.quoted && FIELD_NAME.test(cur.text)) {
        field = { name: cur.text, pos: textStart, end: i }
        cur = { text: '', quoted: false, pos: i + 1, end: i + 1 }
        i++
        continue
      }
      if (ch === ',' && field !== undefined) {
        cur.end = i
        values.push(cur)
        cur = { text: '', quoted: false, pos: i + 1, end: i + 1 }
        i++
        continue
      }
      cur.text += ch
      i++
    }
    cur.end = i
    values.push(cur)

    const raw = input.slice(start, i)
    if (field === undefined && !negated && !cur.quoted && (raw === 'AND' || raw === 'OR')) {
      tokens.push({ type: raw === 'AND' ? 'and' : 'or', pos: start, end: i })
      continue
    }
    tokens.push({ type: 'term', pos: start, end: i, negated, field, values })
  }

  return { ok: true, value: tokens }
}

function fail (code: ParseError['code'], message: string, pos: number, end: number): Result<never> {
  return { ok: false, error: { code, message, pos, end } }
}
