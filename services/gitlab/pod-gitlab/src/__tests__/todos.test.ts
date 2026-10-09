// SPDX-License-Identifier: EPL-2.0
import type { Person } from '@hcengineering/contact'
import type { Ref } from '@hcengineering/core'
import { planTodos, type TodoInput } from '../sync/todos'

const p = (id: string): Ref<Person> => id as Ref<Person>

function input (overrides: Partial<TodoInput>): TodoInput {
  return { open: true, reviewers: [], fixers: [], needsFix: false, keys: [], ...overrides }
}

describe('planTodos', () => {
  it('asks each pending reviewer once', () => {
    const reviewers = [{ person: p('a'), state: 'unreviewed' as const }, { person: p('b'), state: 'approved' as const }]
    const first = planTodos(input({ reviewers }))
    expect(first).toEqual({ create: [{ purpose: 'review', person: 'a' }], complete: [], keys: ['review:a'] })
    expect(planTodos(input({ reviewers, keys: first.keys }))).toEqual({ create: [], complete: [], keys: ['review:a'] })
  })

  it('completes a review ToDo once the reviewer reviewed, and forgets it so a new request asks again', () => {
    const done = planTodos(input({ reviewers: [{ person: p('a'), state: 'reviewed' }], keys: ['review:a'] }))
    expect(done).toEqual({ create: [], complete: [{ purpose: 'review', person: 'a' }], keys: [] })
    const again = planTodos(input({ reviewers: [{ person: p('a'), state: 'unreviewed' }], keys: done.keys }))
    expect(again.create).toEqual([{ purpose: 'review', person: 'a' }])
  })

  it('asks the author and the assignee to fix, once each even when they are the same person', () => {
    const plan = planTodos(input({ needsFix: true, fixers: [p('a'), p('a'), p('c')] }))
    expect(plan.create).toEqual([{ purpose: 'fix', person: 'a' }, { purpose: 'fix', person: 'c' }])
    expect(plan.keys).toEqual(['fix:a', 'fix:c'])
  })

  it('completes fix ToDos when nothing blocks the merge request any more', () => {
    const plan = planTodos(input({ needsFix: false, fixers: [p('a')], keys: ['fix:a'] }))
    expect(plan).toEqual({ create: [], complete: [{ purpose: 'fix', person: 'a' }], keys: [] })
  })

  it('completes everything when the merge request is no longer open', () => {
    const plan = planTodos(input({
      open: false,
      reviewers: [{ person: p('a'), state: 'unreviewed' }],
      needsFix: true,
      fixers: [p('c')],
      keys: ['review:a', 'fix:c']
    }))
    expect(plan).toEqual({
      create: [],
      complete: [{ purpose: 'review', person: 'a' }, { purpose: 'fix', person: 'c' }],
      keys: []
    })
  })

  it('drops keys it does not understand', () => {
    expect(planTodos(input({ keys: ['bogus'] }))).toEqual({ create: [], complete: [], keys: [] })
  })
})
