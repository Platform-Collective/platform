//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { parseFilter } from '../parser'
import type { Node, ParseError } from '../types'
import { schema } from './fixtures'

function ok (input: string): Node {
  const res = parseFilter(input, schema)
  if (!res.ok) throw new Error(`${input}: ${res.error.message}`)
  return res.value
}

function bad (input: string): ParseError {
  const res = parseFilter(input, schema)
  if (res.ok) throw new Error(`expected an error for ${input}`)
  return res.error
}

describe('parseFilter structure', () => {
  it('parses an empty string to an empty AND', () => {
    expect(ok('')).toEqual({ type: 'and', children: [] })
  })

  it('parses free text', () => {
    expect(ok('login')).toMatchObject({ type: 'text', value: 'login', quoted: false })
    expect(ok('"two words"')).toMatchObject({ type: 'text', value: 'two words', quoted: true })
  })

  it('parses a field with several values as one OR term', () => {
    const n = ok('status:Todo,Done')
    expect(n).toMatchObject({ type: 'field', field: { name: 'status' } })
    expect(n.type === 'field' && n.values).toHaveLength(2)
  })

  it('combines repeated fields and separate terms with AND', () => {
    const n = ok('status:Todo label:bug label:ui')
    expect(n.type === 'and' && n.children).toHaveLength(3)
  })

  it('wraps negated terms in NOT', () => {
    expect(ok('-status:Done')).toMatchObject({ type: 'not', child: { type: 'field' } })
    expect(ok('-login')).toMatchObject({ type: 'not', child: { type: 'text' } })
  })

  it('gives AND higher precedence than OR', () => {
    const n = ok('a b OR c')
    expect(n.type).toBe('or')
    expect(n.type === 'or' && n.children.map((c) => c.type)).toEqual(['and', 'text'])
  })

  it('accepts explicit AND', () => {
    expect(ok('a AND b').type).toBe('and')
  })

  it('honours parentheses', () => {
    const n = ok('a (b OR c)')
    expect(n.type === 'and' && n.children[1].type).toBe('or')
  })

  it('supports negated groups', () => {
    expect(ok('-(a OR b)')).toMatchObject({ type: 'not', child: { type: 'or' } })
  })

  it('treats field names case-insensitively', () => {
    expect(ok('Status:Done')).toMatchObject({ type: 'field', field: { name: 'status' } })
  })
})

describe('parseFilter pseudo fields', () => {
  it('parses has: and no:', () => {
    expect(ok('has:assignee')).toMatchObject({ type: 'presence', present: true, field: { name: 'assignee' } })
    expect(ok('no:due')).toMatchObject({ type: 'presence', present: false })
    expect(ok('-no:due')).toMatchObject({ type: 'not', child: { type: 'presence' } })
  })

  it('treats a comma list in has: as OR', () => {
    expect(ok('has:assignee,due').type).toBe('or')
  })

  it('parses is:', () => {
    expect(ok('is:open')).toMatchObject({ type: 'is', state: 'open' })
    expect(ok('is:open,closed').type).toBe('or')
  })

  it('rejects unknown is: values with hints', () => {
    const e = bad('is:merged')
    expect(e.code).toBe('unknownKeyword')
    expect(e.hints).toContain('open')
  })

  it('rejects an unknown field in has:', () => {
    const e = bad('has:nothing')
    expect(e).toMatchObject({ code: 'unknownField', pos: 4, end: 11 })
  })

  it('rejects values for presence-only fields', () => {
    expect(bad('parent-issue:TSK-1').code).toBe('invalidOperator')
    expect(ok('has:parent-issue').type).toBe('presence')
  })
})

describe('parseFilter values', () => {
  it('parses comparison operators on numbers and dates', () => {
    expect(ok('estimate:>5')).toMatchObject({ values: [{ kind: 'compare', op: '>', value: { kind: 'number', value: 5 } }] })
    expect(ok('estimate:<=2')).toMatchObject({ values: [{ kind: 'compare', op: '<=' }] })
    expect(ok('due:>=@today-7d')).toMatchObject({
      values: [{ kind: 'compare', op: '>=', value: { kind: 'date', amount: -7, unit: 'd' } }]
    })
  })

  it('parses inclusive ranges and wildcards', () => {
    expect(ok('estimate:2..5')).toMatchObject({ values: [{ kind: 'range', from: { value: 2 }, to: { value: 5 } }] })
    const open = ok('estimate:3..*')
    expect(open.type === 'field' && open.values[0]).toEqual({ kind: 'range', from: { kind: 'number', value: 3 }, to: undefined })
    const lower = ok('estimate:*..3')
    expect(lower.type === 'field' && lower.values[0]).toMatchObject({ kind: 'range', from: undefined })
    expect(ok('due:2026-01-01..2026-02-01')).toMatchObject({ values: [{ kind: 'range' }] })
  })

  it('parses @me for users only', () => {
    expect(ok('assignee:@me')).toMatchObject({ values: [{ kind: 'eq', value: { kind: 'me' } }] })
    expect(ok('assignee:@alice')).toMatchObject({ values: [{ value: { kind: 'text', text: 'alice' } }] })
    expect(ok('title:@me')).toMatchObject({ values: [{ value: { kind: 'text', text: '@me' } }] })
  })

  it('parses iteration keywords with arithmetic', () => {
    expect(ok('iteration:@current')).toMatchObject({ values: [{ value: { kind: 'iteration', keyword: 'current', offset: 0 } }] })
    expect(ok('iteration:@current+1')).toMatchObject({ values: [{ value: { offset: 1 } }] })
    expect(ok('iteration:@previous,@next').type).toBe('field')
    expect(ok('iteration:"Sprint 2"')).toMatchObject({ values: [{ value: { kind: 'text', text: 'Sprint 2' } }] })
    expect(ok('iteration:@current..@next')).toMatchObject({ values: [{ kind: 'range' }] })
  })

  it('keeps a quoted operator or range as literal text', () => {
    expect(ok('title:">5"')).toMatchObject({ values: [{ value: { kind: 'text', text: '>5' } }] })
    expect(ok('title:a..b')).toMatchObject({ values: [{ kind: 'eq', value: { text: 'a..b' } }] })
  })
})

describe('parseFilter errors', () => {
  it('reports unknown fields with position and hints', () => {
    const e = bad('status:Done stat:x')
    expect(e).toMatchObject({ code: 'unknownField', pos: 12, end: 16 })
    expect(e.hints).toContain('status')
  })

  it('reports missing values', () => {
    expect(bad('status:')).toMatchObject({ code: 'missingValue' })
    expect(bad('estimate:>')).toMatchObject({ code: 'missingValue' })
    expect(bad('status:Todo,')).toMatchObject({ code: 'missingValue', pos: 12 })
  })

  it('reports comparison on non-orderable fields', () => {
    expect(bad('status:>Todo')).toMatchObject({ code: 'invalidOperator', pos: 7, end: 8 })
    expect(bad('title:<x').code).toBe('invalidOperator')
  })

  it('reports invalid numbers and dates with positions', () => {
    expect(bad('estimate:abc')).toMatchObject({ code: 'invalidNumber', pos: 9 })
    expect(bad('estimate:1..x')).toMatchObject({ code: 'invalidNumber', pos: 12 })
    expect(bad('due:tomorrow')).toMatchObject({ code: 'invalidDate', pos: 4 })
    expect(bad('due:2026-02-31').code).toBe('invalidDate')
  })

  it('reports ranges with too many bounds', () => {
    expect(bad('estimate:1..2..3').code).toBe('invalidRange')
  })

  it('reports unknown iteration keywords', () => {
    const e = bad('iteration:@soon')
    expect(e.code).toBe('unknownKeyword')
    expect(e.hints).toContain('@current')
  })

  it('reports unbalanced parentheses', () => {
    expect(bad('(a OR b')).toMatchObject({ code: 'unbalancedParenthesis', pos: 0 })
    expect(bad('a OR b)')).toMatchObject({ code: 'unbalancedParenthesis', pos: 6 })
    expect(bad('()').code).toBe('unbalancedParenthesis')
  })

  it('reports dangling operators', () => {
    expect(bad('AND a').code).toBe('unexpectedToken')
    expect(bad('a OR').code).toBe('unexpectedToken')
    expect(bad('a AND OR b').code).toBe('unexpectedToken')
  })

  it('passes tokenizer errors through', () => {
    expect(bad('title:"x')).toMatchObject({ code: 'unterminatedQuote', pos: 6 })
  })

  it('never throws', () => {
    for (const s of ['(', ')', 'OR', '-', '-(', 'is:', 'has:', 'no:,', ':', 'a:', '"', '..', 'estimate:..', 'due:*..*']) {
      expect(() => parseFilter(s, schema)).not.toThrow()
    }
  })
})
