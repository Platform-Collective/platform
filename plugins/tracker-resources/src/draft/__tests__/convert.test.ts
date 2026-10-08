//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { convertDraftsToIssues, DraftConvertError, MAX_CONVERT_BATCH, selectDraftsToConvert } from '../convert'

const draft = (id: string, space = 'p1', isDraft: boolean = true): any => ({ _id: id, space, isDraft })

interface Fake {
  client: any
  sequence: Record<string, number>
  matches: any[]
  updates: any[]
  commits: number
}

function fake (opts: { commitResult?: boolean, projects?: Record<string, any> } = {}): Fake {
  const state: Fake = { client: undefined, sequence: { p1: 10, p2: 100 }, matches: [], updates: [], commits: 0 }
  const projects = opts.projects ?? { p1: { _id: 'p1', identifier: 'ONE' }, p2: { _id: 'p2', identifier: 'TWO' } }
  state.client = {
    findOne: async (_class: any, query: any) => projects[query._id],
    updateDoc: async (_class: any, _space: any, id: string, update: any, retrieve: boolean) => {
      expect(update).toEqual({ $inc: { sequence: 1 } })
      expect(retrieve).toBe(true)
      state.sequence[id] += 1
      return { object: { sequence: state.sequence[id] } }
    },
    apply: () => {
      const batch: any = {
        match: (_class: any, query: any) => {
          state.matches.push(query)
          return batch
        },
        update: async (doc: any, update: any) => {
          state.updates.push([doc._id, update])
        },
        commit: async () => {
          state.commits++
          return { result: opts.commitResult ?? true }
        }
      }
      return batch
    }
  }
  return state
}

describe('selectDraftsToConvert', () => {
  it('keeps the drafts, each once', () => {
    const list = [draft('a'), draft('a'), draft('b', 'p1', false), { _id: 'c', space: 'p1' }, draft('d')]
    expect(selectDraftsToConvert(list).map((d) => d._id)).toEqual(['a', 'd'])
  })

  it('stops at the cap', () => {
    const list = Array.from({ length: MAX_CONVERT_BATCH + 10 }, (_, i) => draft(`d${i}`))
    expect(selectDraftsToConvert(list)).toHaveLength(MAX_CONVERT_BATCH)
  })
})

describe('convertDraftsToIssues', () => {
  it('numbers the drafts from the sequence of their project and clears the flag in one batch', async () => {
    const f = fake()
    const result = await convertDraftsToIssues(f.client, [draft('a'), draft('b'), draft('c', 'p2')])
    expect(f.updates).toEqual([
      ['a', { number: 11, identifier: 'ONE-11', isDraft: false }],
      ['b', { number: 12, identifier: 'ONE-12', isDraft: false }],
      ['c', { number: 101, identifier: 'TWO-101', isDraft: false }]
    ])
    expect(f.commits).toBe(1)
    expect([...result.entries()]).toEqual([
      ['a', 'ONE-11'],
      ['b', 'ONE-12'],
      ['c', 'TWO-101']
    ])
  })

  it('goes through only while every draft is still a draft', async () => {
    const f = fake()
    await convertDraftsToIssues(f.client, [draft('a'), draft('b')])
    expect(f.matches).toEqual([
      { _id: 'a', isDraft: true },
      { _id: 'b', isDraft: true }
    ])
  })

  it('does nothing for items that are not drafts', async () => {
    const f = fake()
    const result = await convertDraftsToIssues(f.client, [draft('a', 'p1', false)])
    expect(result.size).toBe(0)
    expect(f.commits).toBe(0)
    expect(f.sequence.p1).toBe(10)
  })

  it('fails when the batch is refused', async () => {
    const f = fake({ commitResult: false })
    await expect(convertDraftsToIssues(f.client, [draft('a')])).rejects.toBeInstanceOf(DraftConvertError)
  })

  it('fails without touching the sequence when a project is gone', async () => {
    const f = fake({ projects: {} })
    await expect(convertDraftsToIssues(f.client, [draft('a')])).rejects.toBeInstanceOf(DraftConvertError)
    expect(f.sequence.p1).toBe(10)
  })
})
