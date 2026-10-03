//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { tokenize } from './tokenizer'
import type {
  CompareOp,
  FieldSpec,
  FieldType,
  FieldValue,
  IsState,
  Node,
  ParseError,
  ParseErrorCode,
  Result,
  Scalar,
  Token,
  ValueToken
} from './types'
import { parseDateScalar, parseIterationScalar } from './values'

/** Values accepted by `is:`. `issue` and `sub-issue` mirror GitHub's item kinds, `archived` is GitHub's `is:archived`. */
export const IS_VALUES: IsState[] = ['open', 'closed', 'issue', 'sub-issue', 'archived']

/** Pseudo fields that are not part of the schema. */
export const RESERVED_FIELDS = ['has', 'no', 'is']

const ORDERED_TYPES: FieldType[] = ['number', 'date', 'iteration']

type Tagged<T> = { ok: true, value: T } | { ok: false, error: ParseError }

function err (code: ParseErrorCode, message: string, pos: number, end: number, hints?: string[]): Tagged<never> {
  return { ok: false, error: { code, message, pos, end, hints } }
}

/**
 * Field names that look like `typed`, best matches first, for "unknown field" hints.
 * @public
 */
export function similarFieldNames (typed: string, names: readonly string[]): string[] {
  const t = typed.toLowerCase()
  const starts = names.filter((n) => n.startsWith(t))
  const contains = names.filter((n) => !n.startsWith(t) && (n.includes(t) || t.includes(n)))
  return [...starts, ...contains].slice(0, 5)
}

/**
 * Resolves a typed field name in the schema (case-insensitive).
 * @public
 */
export function findField (schema: readonly FieldSpec[], name: string): FieldSpec | undefined {
  const n = name.toLowerCase()
  return schema.find((f) => f.name === n)
}

class Parser {
  private i = 0

  constructor (
    private readonly tokens: Token[],
    private readonly schema: readonly FieldSpec[]
  ) {}

  parse (): Tagged<Node> {
    if (this.tokens.length === 0) return { ok: true, value: { type: 'and', children: [] } }
    const res = this.parseOr()
    if (res.ok === false) return res
    const rest = this.tokens[this.i]
    if (rest !== undefined) {
      if (rest.type === 'rparen') return err('unbalancedParenthesis', 'Unmatched ")"', rest.pos, rest.end)
      return err('unexpectedToken', 'Unexpected input', rest.pos, rest.end)
    }
    return res
  }

  private peek (): Token | undefined {
    return this.tokens[this.i]
  }

  private parseOr (): Tagged<Node> {
    const first = this.parseAnd()
    if (first.ok === false) return first
    const children: Node[] = [first.value]
    while (this.peek()?.type === 'or') {
      this.i++
      const next = this.parseAnd()
      if (next.ok === false) return next
      children.push(next.value)
    }
    return { ok: true, value: children.length === 1 ? children[0] : { type: 'or', children } }
  }

  private parseAnd (): Tagged<Node> {
    const first = this.parseUnary()
    if (first.ok === false) return first
    const children: Node[] = [first.value]
    for (;;) {
      const t = this.peek()
      if (t === undefined || t.type === 'or' || t.type === 'rparen') break
      if (t.type === 'and') this.i++
      const next = this.parseUnary()
      if (next.ok === false) return next
      children.push(next.value)
    }
    return { ok: true, value: children.length === 1 ? children[0] : { type: 'and', children } }
  }

  private parseUnary (): Tagged<Node> {
    const t = this.peek()
    if (t === undefined) {
      const last = this.tokens[this.tokens.length - 1]
      return err('unexpectedToken', 'Expected a filter term', last?.end ?? 0, last?.end ?? 0)
    }
    switch (t.type) {
      case 'lparen':
      case 'not': {
        const negated = t.type === 'not'
        if (negated) {
          this.i++
          if (this.peek()?.type !== 'lparen') return err('unexpectedToken', 'Expected "("', t.end, t.end)
        }
        const open = this.tokens[this.i]
        this.i++
        const inner = this.parseOr()
        if (inner.ok === false) return inner
        const close = this.peek()
        if (close?.type !== 'rparen') return err('unbalancedParenthesis', 'Missing ")"', open.pos, open.end)
        this.i++
        return { ok: true, value: negated ? { type: 'not', child: inner.value } : inner.value }
      }
      case 'term':
        this.i++
        return this.parseTerm(t)
      case 'rparen':
        return err('unbalancedParenthesis', 'Unmatched ")"', t.pos, t.end)
      default:
        return err('unexpectedToken', `Unexpected ${t.type.toUpperCase()}`, t.pos, t.end)
    }
  }

  private parseTerm (t: Extract<Token, { type: 'term' }>): Tagged<Node> {
    const wrap = (node: Node): Tagged<Node> => ({ ok: true, value: t.negated ? { type: 'not', child: node } : node })

    if (t.field === undefined) {
      const v = t.values[0]
      if (v.text === '') return err('missingValue', 'Empty search text', t.pos, t.end)
      return wrap({ type: 'text', value: v.text, quoted: v.quoted, pos: t.pos })
    }

    const name = t.field.name.toLowerCase()
    if (name === 'has' || name === 'no') return this.parsePresence(t, name === 'has', wrap)
    if (name === 'is') return this.parseIs(t, wrap)

    const spec = findField(this.schema, name)
    if (spec === undefined) {
      const known = [...this.schema.map((f) => f.name), ...RESERVED_FIELDS]
      return err('unknownField', `Unknown field "${t.field.name}"`, t.field.pos, t.field.end, similarFieldNames(name, known))
    }
    if (spec.type === 'presence') {
      return err('invalidOperator', `"${spec.name}" can only be used with has: or no:`, t.pos, t.end)
    }
    const values: FieldValue[] = []
    for (const v of t.values) {
      const parsed = parseFieldValue(spec, v)
      if (parsed.ok === false) return parsed
      values.push(parsed.value)
    }
    return wrap({ type: 'field', field: spec, values, pos: t.pos })
  }

  private parsePresence (
    t: Extract<Token, { type: 'term' }>,
    present: boolean,
    wrap: (n: Node) => Tagged<Node>
  ): Tagged<Node> {
    const nodes: Node[] = []
    for (const v of t.values) {
      if (v.text === '') return err('missingValue', 'Expected a field name', v.pos, Math.max(v.end, v.pos))
      const spec = findField(this.schema, v.text)
      if (spec === undefined) {
        return err(
          'unknownField',
          `Unknown field "${v.text}"`,
          v.pos,
          v.end,
          similarFieldNames(
            v.text,
            this.schema.map((f) => f.name)
          )
        )
      }
      nodes.push({ type: 'presence', field: spec, present, pos: t.pos })
    }
    return wrap(nodes.length === 1 ? nodes[0] : { type: 'or', children: nodes })
  }

  private parseIs (t: Extract<Token, { type: 'term' }>, wrap: (n: Node) => Tagged<Node>): Tagged<Node> {
    const nodes: Node[] = []
    for (const v of t.values) {
      const state = v.text.toLowerCase() as IsState
      if (!IS_VALUES.includes(state)) {
        return err('unknownKeyword', `Unknown value "${v.text}" for is:`, v.pos, v.end, IS_VALUES)
      }
      nodes.push({ type: 'is', state, pos: t.pos })
    }
    return wrap(nodes.length === 1 ? nodes[0] : { type: 'or', children: nodes })
  }
}

const OPERATORS: CompareOp[] = ['>=', '<=', '>', '<']

function parseScalar (spec: FieldSpec, text: string, quoted: boolean, pos: number, end: number): Tagged<Scalar> {
  switch (spec.type) {
    case 'number': {
      const value = text.trim() === '' ? NaN : Number(text)
      if (!Number.isFinite(value)) return err('invalidNumber', `"${text}" is not a number`, pos, end)
      return { ok: true, value: { kind: 'number', value } }
    }
    case 'date': {
      const date = parseDateScalar(text)
      if (date === undefined) {
        return err('invalidDate', `"${text}" is not a date, use YYYY-MM-DD or @today-7d`, pos, end, ['@today', '@today-7d'])
      }
      return { ok: true, value: date }
    }
    case 'iteration': {
      if (!quoted && text.startsWith('@')) {
        const it = parseIterationScalar(text)
        if (it === undefined) {
          return err('unknownKeyword', `Unknown keyword "${text}"`, pos, end, ['@current', '@next', '@previous'])
        }
        return { ok: true, value: it }
      }
      return { ok: true, value: { kind: 'text', text, quoted } }
    }
    case 'user':
      if (!quoted && text === '@me') return { ok: true, value: { kind: 'me' } }
      return { ok: true, value: { kind: 'text', text: !quoted && text.startsWith('@') ? text.slice(1) : text, quoted } }
    default:
      return { ok: true, value: { kind: 'text', text, quoted } }
  }
}

/**
 * Parses one comma separated value of `field:value` according to the field type.
 * @public
 */
export function parseFieldValue (spec: FieldSpec, v: ValueToken): Tagged<FieldValue> {
  const ordered = ORDERED_TYPES.includes(spec.type)
  let text = v.text
  if (text === '') return err('missingValue', `Expected a value for "${spec.name}"`, v.pos, Math.max(v.end, v.pos + 1))

  if (!v.quoted) {
    const op = OPERATORS.find((o) => text.startsWith(o))
    if (op !== undefined) {
      if (!ordered) {
        return err('invalidOperator', `"${op}" cannot be used with "${spec.name}"`, v.pos, v.pos + op.length)
      }
      text = text.slice(op.length)
      if (text === '') return err('missingValue', `Expected a value after "${op}"`, v.pos, v.end)
      const scalar = parseScalar(spec, text, false, v.pos + op.length, v.end)
      if (scalar.ok === false) return scalar
      return { ok: true, value: { kind: 'compare', op, value: scalar.value } }
    }
    const dots = text.indexOf('..')
    if (dots !== -1 && ordered) {
      const left = text.slice(0, dots)
      const right = text.slice(dots + 2)
      const bound = (part: string, offset: number): Tagged<Scalar | undefined> => {
        if (part === '' || part === '*') return { ok: true, value: undefined }
        return parseScalar(spec, part, false, v.pos + offset, v.pos + offset + part.length)
      }
      if (right.includes('..')) return err('invalidRange', 'A range has exactly two bounds', v.pos, v.end)
      const from = bound(left, 0)
      if (from.ok === false) return from
      const to = bound(right, dots + 2)
      if (to.ok === false) return to
      return { ok: true, value: { kind: 'range', from: from.value, to: to.value } }
    }
  }
  const scalar = parseScalar(spec, text, v.quoted, v.pos, v.end)
  if (scalar.ok === false) return scalar
  return { ok: true, value: { kind: 'eq', value: scalar.value } }
}

/**
 * Parses a filter string into an AST. Never throws; errors carry the offending position.
 * An empty string yields an empty AND that matches everything.
 * @public
 */
export function parseFilter (input: string, schema: readonly FieldSpec[]): Result<Node> {
  const tokens = tokenize(input)
  if (tokens.ok === false) return tokens
  return new Parser(tokens.value, schema).parse()
}
