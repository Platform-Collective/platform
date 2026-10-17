//
// Copyright © 2026 Intabia Fusion.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

// matchQuery treats $search as an ordinary field, so raw queries return empty and fulltext never
// fires; withFulltextStub strips $search and filters by a test set - a fake, not real behaviour.

import core, {
  createClient,
  generateId,
  toFindResult,
  TxOperations,
  WorkspaceEvent,
  type Class,
  type Client,
  type Doc,
  type DocumentQuery,
  type FindResult,
  type IndexingUpdateEvent,
  type Ref,
  type Space,
  type Tx,
  type TxWorkspaceEvent
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { test } from './minmodel'

interface TestProject extends Space {
  prjName: string
}

// Wraps a client so a query with `$search` is answered from `matches` instead of the raw
// mock (which cannot honour `$search` at all - see file header).
function withFulltextStub (
  storage: Client,
  matches: Set<Ref<Doc>>,
  onSearch?: (query: DocumentQuery<Doc>) => void
): Client {
  const rawFindAll = storage.findAll.bind(storage)
  return Object.assign(Object.create(Object.getPrototypeOf(storage)), storage, {
    findAll: async (_class: any, query: any, options: any) => {
      if (query?.$search == null) return await rawFindAll(_class, query, options)
      onSearch?.(query)
      const { $search, ...rest } = query
      const docs = await rawFindAll(_class, rest, options)
      // Scored like the server
      const filtered = docs.filter((d: Doc) => matches.has(d._id)).map((d: Doc) => ({ ...d, $source: { $score: 1 } }))
      return toFindResult(filtered, filtered.length)
    }
  })
}

async function getSearchClient (
  matches: Set<Ref<Doc>>,
  onSearch?: (query: DocumentQuery<Doc>) => void
): Promise<{
  liveQuery: LiveQuery
  factory: TxOperations
  findAllCalls: () => number
}> {
  const storage = await createClient(connect)
  const searchAware = withFulltextStub(storage, matches, onSearch)
  let calls = 0
  const rawFindAll = searchAware.findAll.bind(searchAware)
  const counting: Client = Object.assign(Object.create(Object.getPrototypeOf(searchAware)), searchAware, {
    findAll: async (_class: any, query: any, options: any) => {
      calls++
      return await rawFindAll(_class, query, options)
    }
  })
  const liveQuery = new LiveQuery(counting)
  storage.notify = (...tx: Tx[]) => {
    liveQuery.tx(...tx).catch((err) => {
      console.log(err)
    })
  }
  return { liveQuery, factory: new TxOperations(storage, core.account.System), findAllCalls: () => calls }
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

async function createProject (factory: TxOperations, prjName: string, id?: Ref<TestProject>): Promise<Ref<TestProject>> {
  return await factory.createDoc(
    test.class.TestProject,
    core.space.Model,
    { name: prjName, description: '', private: false, members: [], archived: false, prjName },
    id
  )
}

// Subscribe and resolve once the first callback fires. Returns an unsubscribe handle.
async function subscribe<T extends Doc> (
  liveQuery: LiveQuery,
  _class: Ref<Class<T>>,
  query: any,
  options?: any
): Promise<{ last: () => FindResult<T>, unsubscribe: () => void }> {
  let last: FindResult<T> = toFindResult([])
  let unsubscribe: () => void = () => {}
  await new Promise((resolve) => {
    unsubscribe = liveQuery.query<T>(
      _class,
      query,
      (res) => {
        last = res
        resolve(null)
      },
      options
    )
  })
  return {
    last: () => last,
    unsubscribe: () => {
      unsubscribe()
    }
  }
}

function indexingUpdateTx (classes: Array<Ref<Class<Doc>>>): TxWorkspaceEvent<IndexingUpdateEvent> {
  return {
    _id: generateId(),
    _class: core.class.TxWorkspaceEvent,
    space: core.space.DerivedTx,
    objectSpace: core.space.Tx,
    modifiedBy: core.account.System,
    modifiedOn: Date.now(),
    event: WorkspaceEvent.IndexingUpdate,
    params: { _class: classes }
  }
}

describe('LiveQuery $search handling', () => {
  it('excludes a newly created doc that fails the fulltext check', async () => {
    const matches = new Set<Ref<Doc>>()
    const { liveQuery, factory } = await getSearchClient(matches)
    const sub = await subscribe<TestProject>(liveQuery, test.class.TestProject, { $search: 'foo' })
    expect(sub.last()).toHaveLength(0)

    await createProject(factory, 'no-match')
    await settle()

    // handleDocAdd's $search gate must keep it out even though it matches every other criterion.
    expect(sub.last()).toHaveLength(0)
  })

  it('includes a newly created doc that passes the fulltext check', async () => {
    const id = generateId<TestProject>()
    const matches = new Set<Ref<Doc>>([id])
    const { liveQuery, factory } = await getSearchClient(matches)
    const sub = await subscribe<TestProject>(liveQuery, test.class.TestProject, { $search: 'foo' })

    await createProject(factory, 'matches', id)
    await settle()

    expect(sub.last()).toHaveLength(1)
    expect(sub.last()[0].prjName).toBe('matches')
    // The score of the fulltext check
    expect(sub.last()[0].$source?.$score).toBe(1)
  })

  it('refreshes the query when a full-limit doc drops out of the fulltext index', async () => {
    const id = generateId<TestProject>()
    const matches = new Set<Ref<Doc>>([id])
    const { liveQuery, factory, findAllCalls } = await getSearchClient(matches)
    await createProject(factory, 'was-matching', id)

    const sub = await subscribe<TestProject>(liveQuery, test.class.TestProject, { $search: 'foo' }, { limit: 1 })
    expect(sub.last()).toHaveLength(1)

    matches.delete(id) // simulate the doc dropping out of the fulltext index
    const before = findAllCalls()
    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'edited' })
    await settle()

    // checkSearch's "no match, result at its limit" branch forces a full refresh: one findAll
    // for the fulltext re-check itself, one more for the refresh.
    expect(findAllCalls()).toBe(before + 2)
    expect(sub.last()).toHaveLength(0)
  })

  it('drops a doc locally, without a refetch, when a non-full result loses its fulltext match', async () => {
    const id = generateId<TestProject>()
    const matches = new Set<Ref<Doc>>([id])
    const { liveQuery, factory, findAllCalls } = await getSearchClient(matches)
    await createProject(factory, 'was-matching', id)

    const sub = await subscribe<TestProject>(liveQuery, test.class.TestProject, { $search: 'foo' }, { total: true })
    expect(sub.last()).toHaveLength(1)
    expect(sub.last().total).toBe(1)

    matches.delete(id)
    const before = findAllCalls()
    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'edited' })
    await settle()

    // Not at its limit: checkSearch deletes the doc from the cached result directly and
    // decrements total, costing only the fulltext re-check - no second findAll.
    expect(findAllCalls()).toBe(before + 1)
    expect(sub.last()).toHaveLength(0)
    expect(sub.last().total).toBe(0)
  })

  it('updates a doc in place when it still matches $search after an edit', async () => {
    const id = generateId<TestProject>()
    const matches = new Set<Ref<Doc>>([id])
    const { liveQuery, factory, findAllCalls } = await getSearchClient(matches)
    await createProject(factory, 'still-matching', id)

    const sub = await subscribe<TestProject>(liveQuery, test.class.TestProject, { $search: 'foo' })
    expect(sub.last()[0].prjName).toBe('still-matching')

    const before = findAllCalls()
    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'still-matching-edited' })
    await settle()

    expect(findAllCalls()).toBe(before + 1) // only the fulltext re-check, no refresh, no delete
    expect(sub.last()).toHaveLength(1)
    expect(sub.last()[0].prjName).toBe('still-matching-edited')
  })

  it('refreshes an active $search query on WorkspaceEvent.IndexingUpdate for a matching class', async () => {
    const matches = new Set<Ref<Doc>>()
    const { liveQuery, findAllCalls } = await getSearchClient(matches)
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { $search: 'foo' })
    const before = findAllCalls()

    // TxWorkspaceEvent isn't a class genMinModel registers, so it cannot be persisted through
    // the mock's TxDb; feed it straight to LiveQuery.tx, exactly what storage.notify would do.
    await liveQuery.tx(indexingUpdateTx([test.class.TestProject]))
    await settle()

    expect(findAllCalls()).toBeGreaterThan(before)
  })

  it('evicts a parked $search query on WorkspaceEvent.IndexingUpdate for a matching class', async () => {
    const matches = new Set<Ref<Doc>>()
    const { liveQuery, findAllCalls } = await getSearchClient(matches)
    const q = await subscribe<TestProject>(liveQuery, test.class.TestProject, { $search: 'foo' })
    q.unsubscribe()

    await liveQuery.tx(indexingUpdateTx([test.class.TestProject]))
    await settle()

    const before = findAllCalls()
    // A parked query normally answers a resubscribe from cache (0 extra calls). Once
    // IndexingUpdate evicts it, the resubscribe has nothing to reuse and must refetch.
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { $search: 'foo' })
    expect(findAllCalls()).toBeGreaterThan(before)
  })
})
