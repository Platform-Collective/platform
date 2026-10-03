//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { compileFilter, compileQuery, referencedProperties, splitServerClient } from '../compile'
import { parseFilter } from '../parser'
import type { Node } from '../types'
import { ctx, ISSUES, schema } from './fixtures'

function ast (input: string): Node {
  const res = parseFilter(input, schema)
  if (!res.ok) throw new Error(`${input}: ${res.error.message}`)
  return res.value
}

// Minimal evaluator of the DocumentQuery subset the compiler emits
function like (pattern: string, value: unknown): boolean {
  if (typeof value !== 'string') return false
  const re = new RegExp(`^${pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i')
  return re.test(value)
}

function matchSelector (sel: any, value: unknown): boolean {
  if (typeof sel !== 'object' || sel === null) return (value ?? null) === sel
  const v = value ?? null
  for (const [op, arg] of Object.entries<any>(sel)) {
    switch (op) {
      case '$in':
        if (!arg.includes(v)) return false
        break
      case '$nin':
        if (arg.includes(v)) return false
        break
      case '$ne':
        if (v === arg) return false
        break
      case '$gt':
        if (typeof v !== 'number' || !(v > arg)) return false
        break
      case '$gte':
        if (typeof v !== 'number' || !(v >= arg)) return false
        break
      case '$lt':
        if (typeof v !== 'number' || !(v < arg)) return false
        break
      case '$lte':
        if (typeof v !== 'number' || !(v <= arg)) return false
        break
      case '$like':
        if (!like(arg, v)) return false
        break
      default:
        throw new Error(`unsupported operator ${op}`)
    }
  }
  return true
}

function matchQuery (query: Record<string, any>, doc: any): boolean {
  return Object.entries(query).every(([key, sel]) => matchSelector(sel, doc[key]))
}

describe('splitServerClient', () => {
  it('compiles an empty filter to an empty query', () => {
    expect(splitServerClient(ast(''), ctx)).toEqual({ query: {}, residual: undefined })
  })

  it('compiles select, user and priority fields to $in / $nin', () => {
    expect(compileQuery(ast('status:Todo,Done'), ctx)).toEqual({ status: { $in: ['st-todo', 'st-done'] } })
    expect(compileQuery(ast('priority:urgent'), ctx)).toEqual({ priority: { $in: [1] } })
    expect(compileQuery(ast('assignee:@me'), ctx)).toEqual({ assignee: { $in: ['p-alice'] } })
    expect(compileQuery(ast('-status:Done'), ctx)).toEqual({ status: { $nin: ['st-done'] } })
    expect(compileQuery(ast('milestone:v1'), ctx)).toEqual({ milestone: { $in: ['m1'] } })
  })

  it('selects nothing for an unknown option', () => {
    expect(compileQuery(ast('status:zzz'), ctx)).toEqual({ status: { $in: [] } })
  })

  it('compiles has: and no: to null checks', () => {
    expect(compileQuery(ast('no:assignee'), ctx)).toEqual({ assignee: null })
    expect(compileQuery(ast('has:due'), ctx)).toEqual({ dueDate: { $ne: null } })
    expect(compileQuery(ast('no:parent-issue'), ctx)).toEqual({ attachedTo: 'no-parent' })
    expect(compileQuery(ast('has:parent-issue'), ctx)).toEqual({ attachedTo: { $ne: 'no-parent' } })
  })

  it('compiles title text and field to $like', () => {
    expect(compileQuery(ast('login'), ctx)).toEqual({ title: { $like: '%login%' } })
    expect(compileQuery(ast('title:"fix*bug"'), ctx)).toEqual({ title: { $like: '%fix%bug%' } })
  })

  it('keeps LIKE metacharacters on the client', () => {
    const res = splitServerClient(ast('100%'), ctx)
    expect(res.query).toEqual({})
    expect(res.residual).toMatchObject({ type: 'text' })
  })

  it('compiles numeric and date bounds', () => {
    expect(compileQuery(ast('estimate:>5'), ctx)).toEqual({ estimation: { $gt: 5 } })
    expect(compileQuery(ast('estimate:2..5'), ctx)).toEqual({ estimation: { $gte: 2, $lte: 5 } })
    expect(compileQuery(ast('estimate:<=3'), ctx)).toEqual({ estimation: { $lte: 3 } })
    const date = compileQuery(ast('due:>=@today'), ctx)
    expect(date).toEqual({ dueDate: { $gte: expect.any(Number) } })
    expect(compileQuery(ast('due:*..*'), ctx)).toEqual({ dueDate: { $ne: null } })
  })

  it('merges two bounds on the same attribute', () => {
    const q = compileQuery(ast('due:>@today-7d due:<@today+1d'), ctx)
    expect(q).toEqual({ dueDate: { $gte: expect.any(Number), $lte: expect.any(Number) } })
  })

  it('moves a colliding condition on the same attribute to the client', () => {
    const res = splitServerClient(ast('status:Todo status:Done'), ctx)
    expect(res.query).toEqual({ status: { $in: ['st-todo'] } })
    expect(res.residual).toMatchObject({ type: 'field', field: { name: 'status' } })
  })

  it('compiles labels through the document id resolver', () => {
    const q = compileQuery(ast('label:bug'), ctx)
    expect(q?._id.$in).toHaveLength(2)
    expect(compileQuery(ast('-label:bug'), ctx)?._id.$nin).toHaveLength(2)
  })

  it('compiles is: states', () => {
    expect(compileQuery(ast('is:open'), ctx)).toEqual({ status: { $nin: ['st-done', 'st-canceled'] } })
    expect(compileQuery(ast('is:closed'), ctx)).toEqual({ status: { $in: ['st-done', 'st-canceled'] } })
    expect(compileQuery(ast('is:issue'), ctx)).toEqual({})
    expect(compileQuery(ast('is:sub-issue'), ctx)).toEqual({ attachedTo: { $ne: 'no-parent' } })
  })

  it('merges OR of the same field into one selector', () => {
    expect(compileQuery(ast('status:Todo OR status:Done'), ctx)).toEqual({ status: { $in: ['st-todo', 'st-done'] } })
  })

  it('sends custom fields to the client', () => {
    const res = splitServerClient(ast('status:Todo story-points:>3'), ctx)
    expect(res.query).toEqual({ status: { $in: ['st-todo'] } })
    expect(res.residual).toMatchObject({ type: 'field', field: { name: 'story-points' } })
    expect(compileQuery(ast('story-points:>3'), ctx)).toBeUndefined()
  })

  it('keeps an OR across fields whole on the client', () => {
    const res = splitServerClient(ast('priority:urgent OR status:done'), ctx)
    expect(res.query).toEqual({})
    expect(res.residual?.type).toBe('or')
  })

  it('keeps an OR across server and client fields whole on the client', () => {
    const res = splitServerClient(ast('status:done OR story-points:>3'), ctx)
    expect(res.query).toEqual({})
    expect(res.residual?.type).toBe('or')
  })

  it('splits a top level AND into server and client parts', () => {
    const res = splitServerClient(ast('assignee:@me (priority:urgent OR size:L) login'), ctx)
    expect(res.query).toEqual({ assignee: { $in: ['p-alice'] }, title: { $like: '%login%' } })
    expect(res.residual?.type).toBe('or')
  })

  it('does not compile iterations on the server', () => {
    expect(compileQuery(ast('iteration:@current'), ctx)).toBeUndefined()
  })
})

describe('server query + client residual equals full client evaluation', () => {
  const filters = [
    '',
    'login',
    'status:Todo,Done',
    '-status:Done',
    'priority:urgent,high',
    'assignee:@me',
    '-assignee:@me',
    'no:assignee',
    'has:due',
    'label:bug',
    '-label:bug',
    'label:bug label:ui',
    'is:open',
    'is:closed',
    'is:sub-issue',
    'no:parent-issue',
    'estimate:>5',
    'estimate:<=5',
    'estimate:1..8',
    'estimate:8..*',
    'due:@today',
    'due:<@today',
    'due:>@today-7d',
    'due:>@today-14d due:<@today+1d',
    'due:@today-10d..@today',
    'status:Todo status:Done',
    'story-points:>3',
    'status:progress,todo story-points:<5',
    'priority:urgent OR status:done',
    'status:done OR story-points:>3',
    '(priority:urgent OR status:done) assignee:@me',
    '-(status:done OR status:canceled)',
    'assignee:@me size:M',
    'iteration:@current OR label:bug',
    'bug status:"in progress"',
    '100%',
    'title:*coverage -is:closed',
    'no:size OR has:notes'
  ]

  for (const f of filters) {
    it(`"${f}"`, () => {
      const res = compileFilter(f, schema, ctx)
      if (!res.ok) throw new Error(res.error.message)
      const combined = ISSUES.filter((d) => matchQuery(res.value.query, d) && res.value.predicate(d)).map((d) => d._id)
      const full = ISSUES.filter((d) => res.value.matches(d)).map((d) => d._id)
      expect(combined).toEqual(full)
    })
  }
})

describe('compileFilter', () => {
  it('returns typed errors instead of throwing', () => {
    const res = compileFilter('nope:1', schema, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatchObject({ code: 'unknownField', pos: 0 })
  })

  it('exposes whether the query is exact', () => {
    const exact = compileFilter('status:Todo', schema, ctx)
    expect(exact.ok && exact.value.residual).toBeUndefined()
    const mixed = compileFilter('status:Todo story-points:>1', schema, ctx)
    expect(mixed.ok && mixed.value.residual).toBeDefined()
  })
})

describe('reserved keys', () => {
  it('leaves conditions on reserved attributes to the client', () => {
    const res = splitServerClient(ast('status:Todo priority:urgent'), ctx, new Set(['status']))
    expect(res.query).toEqual({ priority: { $in: [1] } })
    expect(res.residual).toMatchObject({ type: 'field', field: { name: 'status' } })
  })
})

describe('referencedProperties', () => {
  it('lists what the client has to load', () => {
    expect(referencedProperties(undefined)).toEqual(['_id'])
    const props = referencedProperties(ast('login (priority:urgent OR story-points:>1) is:open has:parent-issue'))
    expect(props).toEqual(expect.arrayContaining(['_id', 'title', 'priority', 'customFields', 'status', 'attachedTo']))
  })
})
