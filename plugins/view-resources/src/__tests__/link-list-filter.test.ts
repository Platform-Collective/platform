// SPDX-License-Identifier: EPL-2.0

import { type Class, type Doc, findProperty, type Ref } from '@hcengineering/core'
import { type Filter } from '@hcengineering/view'
import { arrayAllResult, arrayAnyResult, FilterQuery, nestedMatchResult } from '../filter'

// A small in-memory stand-in for the live query: it matches with core's own matcher (the one the
// client's LiveQuery uses) and calls back again whenever the stored documents change.
type Callback = (docs: Doc[]) => void
const store: { docs: Doc[], subscribers: Array<{ query: Record<string, any>, callback: Callback }> } = {
  docs: [],
  subscribers: []
}

function run (query: Record<string, any>, callback: Callback): void {
  let result = store.docs
  for (const key in query) {
    result = findProperty(result, key, query[key])
  }
  callback(result)
}

function changeDocs (update: (docs: Doc[]) => Doc[]): void {
  store.docs = update(store.docs)
  for (const sub of store.subscribers) {
    run(sub.query, sub.callback)
  }
}

const modeResults: Record<string, any> = {
  'mode:all': arrayAllResult,
  'mode:any': arrayAnyResult
}

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: async (id: string) => modeResults[id]
}))

jest.mock('@hcengineering/ui', () => ({
  getCurrentResolvedLocation: jest.fn(),
  locationToUrl: jest.fn()
}))

jest.mock('@hcengineering/presentation', () => ({
  getClient: () => ({
    findOne: async (_class: any, query: { _id: string }) => ({ _id: query._id, result: query._id })
  }),
  createQuery: () => ({
    query: (_class: any, query: Record<string, any>, callback: Callback) => {
      store.subscribers.push({ query, callback })
      run(query, callback)
      return true
    },
    unsubscribe: () => {}
  })
}))

const issueClass = 'tracker:class:Issue' as Ref<Class<Doc>>
// Each call makes a new object, as links read from different documents or from storage are.
const link = (id: string): any => ({ _id: id, _class: issueClass })
const issue = (id: string, blockedBy: any[]): Doc => ({ _id: id, _class: issueClass, blockedBy }) as any

function blockedByFilter (mode: 'mode:all' | 'mode:any', links: any[], index: number): Filter {
  return {
    key: { _class: issueClass, key: 'blockedBy', label: '' as any, component: '' as any },
    mode: mode as any,
    modes: [],
    value: links.map((it) => [it._id, [it]]),
    index
  } as any
}

function nested (inner: Filter, index: number): Filter {
  return { ...inner, mode: 'mode:nested' as any, nested: inner, value: [], index }
}

describe('filters over a list of links', () => {
  beforeEach(() => {
    store.subscribers = []
    store.docs = [
      issue('i1', [link('a'), link('b')]),
      issue('i2', [link('a')]),
      issue('i3', [{ _class: issueClass, _id: 'b' }]),
      issue('i4', [])
    ]
  })

  afterEach(() => {
    for (const index of Array.from(FilterQuery.queries.keys())) {
      FilterQuery.remove(index)
    }
  })

  it('sends the ticked links to the query as $all / $in', async () => {
    const filter = blockedByFilter('mode:all', [link('a'), link('b')], 1)
    expect(await arrayAllResult(filter)).toEqual({ $all: [link('a'), link('b')] })
    expect(await arrayAnyResult(filter)).toEqual({ $in: [link('a'), link('b')] })
  })

  it('resolves a nested "blocked by all of" filter to the matching documents', async () => {
    const inner = blockedByFilter('mode:all', [link('a'), link('b')], 10)
    expect(await nestedMatchResult(nested(inner, 11), () => {})).toEqual({ $in: ['i1'] })
  })

  it('resolves a nested "blocked by any of" filter to the matching documents', async () => {
    const inner = blockedByFilter('mode:any', [link('a'), link('b')], 20)
    expect(await nestedMatchResult(nested(inner, 21), () => {})).toEqual({ $in: ['i1', 'i2', 'i3'] })
  })

  it('updates a nested filter when links change after it is applied', async () => {
    const inner = blockedByFilter('mode:all', [link('a'), link('b')], 30)
    const onUpdate = jest.fn()
    expect(await nestedMatchResult(nested(inner, 31), onUpdate)).toEqual({ $in: ['i1'] })
    onUpdate.mockClear()

    // i2 gains link b and enters the result.
    changeDocs((docs) => docs.map((it) => (it._id === 'i2' ? issue('i2', [link('a'), link('b')]) : it)))
    expect(onUpdate).toHaveBeenCalled()
    expect(FilterQuery.results.get(inner.index)).toEqual(['i1', 'i2'])

    // i1 loses link a and leaves it.
    changeDocs((docs) => docs.map((it) => (it._id === 'i1' ? issue('i1', [link('b')]) : it)))
    expect(FilterQuery.results.get(inner.index)).toEqual(['i2'])
  })
})
