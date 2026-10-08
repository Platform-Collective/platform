//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { tokenize } from '../tokenizer'
import type { Token } from '../types'

function ok (input: string): Token[] {
  const res = tokenize(input)
  if (!res.ok) throw new Error(res.error.message)
  return res.value
}

describe('tokenize', () => {
  it('returns no tokens for blank input', () => {
    expect(ok('')).toEqual([])
    expect(ok('   \t ')).toEqual([])
  })

  it('splits free text words', () => {
    const t = ok('login bug')
    expect(t).toHaveLength(2)
    expect(t[0]).toMatchObject({ type: 'term', field: undefined, values: [{ text: 'login' }] })
  })

  it('parses field:value with positions', () => {
    const [t] = ok('status:Done')
    expect(t).toMatchObject({
      type: 'term',
      pos: 0,
      end: 11,
      negated: false,
      field: { name: 'status', pos: 0, end: 6 },
      values: [{ text: 'Done', quoted: false, pos: 7, end: 11 }]
    })
  })

  it('splits comma separated values', () => {
    const [t] = ok('status:Todo,Done,"In Progress"')
    expect(t.type === 'term' && t.values.map((v) => [v.text, v.quoted])).toEqual([
      ['Todo', false],
      ['Done', false],
      ['In Progress', true]
    ])
  })

  it('keeps commas, colons and parentheses inside quotes', () => {
    const [t] = ok('title:"a, b: (c)"')
    expect(t.type === 'term' && t.values).toHaveLength(1)
    expect(t.type === 'term' && t.values[0].text).toBe('a, b: (c)')
  })

  it('unescapes quotes inside quotes', () => {
    const [t] = ok('title:"say \\"hi\\""')
    expect(t.type === 'term' && t.values[0].text).toBe('say "hi"')
  })

  it('marks negation', () => {
    const [t] = ok('-label:bug')
    expect(t).toMatchObject({ type: 'term', negated: true, field: { name: 'label' } })
  })

  it('treats a lone dash as text', () => {
    const [t] = ok('-')
    expect(t).toMatchObject({ type: 'term', negated: false, values: [{ text: '-' }] })
  })

  it('recognizes AND, OR and parentheses', () => {
    expect(ok('(a OR b) AND c').map((t) => t.type)).toEqual(['lparen', 'term', 'or', 'term', 'rparen', 'and', 'term'])
  })

  it('does not treat lower case or quoted and/or as operators', () => {
    expect(ok('and or').map((t) => t.type)).toEqual(['term', 'term'])
    expect(ok('"OR"').map((t) => t.type)).toEqual(['term'])
  })

  it('negates a group', () => {
    expect(ok('-(a b)').map((t) => t.type)).toEqual(['not', 'lparen', 'term', 'term', 'rparen'])
  })

  it('does not treat a digit-led prefix as a field (times, versions)', () => {
    const [t] = ok('12:30')
    expect(t).toMatchObject({ type: 'term', field: undefined, values: [{ text: '12:30' }] })
  })

  it('accepts field names in any script', () => {
    const [t] = ok('приоритет:высокий')
    expect(t).toMatchObject({ type: 'term', field: { name: 'приоритет' }, values: [{ text: 'высокий' }] })
  })

  it('keeps an empty value after the colon', () => {
    const [t] = ok('status:')
    expect(t.type === 'term' && t.values).toEqual([{ text: '', quoted: false, pos: 7, end: 7 }])
  })

  it('reports an unterminated quote with its position', () => {
    const res = tokenize('status:Done title:"oops')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatchObject({ code: 'unterminatedQuote', pos: 18 })
  })

  it('never throws on arbitrary input', () => {
    for (const s of ['"', '\\', '))((', ':', ',,,', '-:', '"a" "b', ':::', 'a:"', '\u0000']) {
      expect(() => tokenize(s)).not.toThrow()
    }
  })
})
