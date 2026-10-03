//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { appendTerm, applySuggestion, joinAnd, suggest } from '../suggest'
import { schema } from './fixtures'

const labels = (text: string, caret = text.length): string[] => suggest(text, caret, schema).items.map((i) => i.label)

describe('suggest', () => {
  it('offers all field names for an empty input', () => {
    const res = suggest('', 0, schema)
    expect(res.items.length).toBeGreaterThan(0)
    expect(res.items[0].kind).toBe('field')
  })

  it('filters field names by prefix, including has/no/is', () => {
    expect(labels('sta')).toEqual(['status'])
    expect(labels('-ass')).toEqual(['assignee'])
    expect(labels('i')).toEqual(expect.arrayContaining(['is', 'iteration']))
    expect(suggest('sta', 3, schema).items[0].insert).toBe('status:')
  })

  it('offers option names after the colon', () => {
    expect(labels('status:')).toEqual(['Todo', 'In Progress', 'Done', 'Canceled'])
    expect(labels('status:do')).toEqual(['Done'])
  })

  it('quotes values with spaces', () => {
    expect(suggest('status:in', 9, schema).items[0].insert).toBe('"In Progress"')
  })

  it('completes only the value after the last comma', () => {
    const res = suggest('status:Todo,d', 13, schema)
    expect(res.items.map((i) => i.label)).toEqual(['Done'])
    expect(applySuggestion('status:Todo,d', res, res.items[0]).text).toBe('status:Todo,Done')
  })

  it('offers keywords per field type', () => {
    expect(labels('assignee:')).toContain('@me')
    expect(labels('due:@')).toEqual(['@today', '@today-7d', '@today+7d'])
    expect(labels('iteration:@c')).toEqual(['@current'])
  })

  it('offers field names after has: and no:, and is: values', () => {
    expect(labels('has:a')).toEqual(expect.arrayContaining(['assignee', 'area']))
    expect(labels('no:du')).toEqual(['due'])
    expect(labels('is:')).toEqual(['open', 'closed', 'issue', 'sub-issue'])
  })

  it('ignores comparison operators when completing', () => {
    const res = suggest('due:>@to', 8, schema)
    expect(res.items.map((i) => i.label)).toEqual(['@today', '@today-7d', '@today+7d'])
    expect(applySuggestion('due:>@to', res, res.items[0]).text).toBe('due:>@today')
  })

  it('completes the term at the caret in the middle of the input', () => {
    const text = 'status:Done sta label:bug'
    const res = suggest(text, 15, schema)
    expect(res.items.map((i) => i.label)).toEqual(['status'])
    expect(applySuggestion(text, res, res.items[0]).text).toBe('status:Done status: label:bug')
  })

  it('does not treat a space inside quotes as a term boundary', () => {
    expect(labels('status:"In Pr')).toEqual(['In Progress'])
  })

  it('has no suggestions for unknown fields', () => {
    expect(labels('foo:')).toEqual([])
  })
})

describe('appendTerm', () => {
  it('starts a filter', () => {
    expect(appendTerm('', 'status', 'Done')).toBe('status:Done')
  })

  it('adds an AND term and quotes when needed', () => {
    expect(appendTerm('label:bug', 'status', 'In Progress')).toBe('label:bug status:"In Progress"')
  })

  it('does not repeat an existing term', () => {
    expect(appendTerm('status:Done label:bug', 'status', 'Done')).toBe('status:Done label:bug')
  })

  it('parenthesizes a filter that has a top level OR', () => {
    expect(appendTerm('a OR b', 'status', 'Done')).toBe('(a OR b) status:Done')
  })
})

describe('joinAnd', () => {
  it('joins with a space and skips empty parts', () => {
    expect(joinAnd('a', 'b')).toBe('a b')
    expect(joinAnd('', 'b')).toBe('b')
    expect(joinAnd(' a ', '')).toBe('a')
  })

  it('parenthesizes parts with a top level OR', () => {
    expect(joinAnd('a OR b', 'c')).toBe('(a OR b) c')
    expect(joinAnd('a', 'b OR c')).toBe('a (b OR c)')
    expect(joinAnd('(a OR b)', 'c')).toBe('(a OR b) c')
  })
})
