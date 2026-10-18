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

// `Refs` answers findOne/findAll from documents live queries hold; subscriptions start from
// it, not the server - so it must hand out clones, gone once unheld, never outliving a delete.

import core, {
  createClient,
  SortingOrder,
  TxOperations,
  type Class,
  type Client,
  type Doc,
  type Ref,
  type Space,
  type Tx
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { test } from './minmodel'

interface TestProject extends Space {
  prjName: string
}

async function getClient (): Promise<{
  liveQuery: LiveQuery
  factory: TxOperations
  storage: Client
  findAllCalls: () => number
}> {
  const storage = await createClient(connect)
  let calls = 0
  const rawFindAll = storage.findAll.bind(storage)
  const counting: Client = Object.assign(Object.create(Object.getPrototypeOf(storage)), storage, {
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
  return { liveQuery, factory: new TxOperations(storage, core.account.System), storage, findAllCalls: () => calls }
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

async function createProject (factory: TxOperations, prjName: string): Promise<Ref<TestProject>> {
  return await factory.createDoc(test.class.TestProject, core.space.Model, {
    name: prjName,
    description: '',
    private: false,
    members: [],
    archived: false,
    prjName
  })
}

// Subscribe and resolve once the first callback fires. Returns an unsubscribe handle.
async function subscribe<T extends Doc> (
  liveQuery: LiveQuery,
  _class: Ref<Class<T>>,
  query: any,
  options?: any
): Promise<{ last: () => T[], unsubscribe: () => void }> {
  let last: T[] = []
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

describe('Refs document cache', () => {
  it('answers findOne by _id without a server call', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    const id = await createProject(factory, 'cached')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'cached' })
    const before = findAllCalls()

    const doc = await liveQuery.findOne(test.class.TestProject, { _id: id })

    expect(doc?.prjName).toBe('cached')
    expect(findAllCalls()).toBe(before)
  })

  it('answers findOne by a plain field without a server call', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    await createProject(factory, 'by-field')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'by-field' })
    const before = findAllCalls()

    const doc = await liveQuery.findOne(test.class.TestProject, { prjName: 'by-field' })

    expect(doc?.prjName).toBe('by-field')
    expect(findAllCalls()).toBe(before)
  })

  it('honours the rest of the query when the _id hits the cache', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'right-name')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'right-name' })

    // The _id lookup must not short-circuit the other criteria.
    expect(await liveQuery.findOne(test.class.TestProject, { _id: id, prjName: 'wrong-name' })).toBeUndefined()
    expect((await liveQuery.findOne(test.class.TestProject, { _id: id, prjName: 'right-name' }))?._id).toBe(id)
  })

  it('hands out a clone, so a caller cannot corrupt the cache', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'clone-me')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'clone-me' })

    const first = await liveQuery.findOne(test.class.TestProject, { _id: id })
    expect(first).toBeDefined()
    ;(first as TestProject).prjName = 'mutated'

    const second = await liveQuery.findOne(test.class.TestProject, { _id: id })
    expect(second?.prjName).toBe('clone-me')
  })

  it('serves the live value, not the one the query started with', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'renamed')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { _id: id })

    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'renamed-twice' })
    await settle()

    const doc = await liveQuery.findOne(test.class.TestProject, { _id: id })
    expect(doc?.prjName).toBe('renamed-twice')
  })

  it('does not serve a document the query no longer matches', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'still-here')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'still-here' })

    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'moved-away' })
    await settle()

    // The cached copy must not answer a query the document has stopped matching.
    const gone = await liveQuery.findOne(test.class.TestProject, { prjName: 'still-here' })
    expect(gone).toBeUndefined()
  })

  it('does not serve a removed document', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'doomed')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'doomed' })

    await factory.removeDoc(test.class.TestProject, core.space.Model, id)
    await settle()

    expect(await liveQuery.findOne(test.class.TestProject, { _id: id })).toBeUndefined()
  })

  it('starts a second subscription from the cache instead of the server', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    await createProject(factory, 'shared-doc')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'shared-doc' })
    const before = findAllCalls()

    const second = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: 'shared-doc' },
      { limit: 1 }
    )

    expect(second.last()[0]?.prjName).toBe('shared-doc')
    expect(findAllCalls()).toBe(before)
  })

  it('answers a plain findOne from a query cached with a lookup, stripped of $lookup', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    await createProject(factory, 'with-lookup')
    // Cached under a lookup-specific key; a plain findOne has to find it anyway and hand back a
    // document without the joined data, or callers would see fields they never asked for.
    await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: 'with-lookup' },
      { lookup: { _id: { comments: test.class.TestComment } } }
    )
    const before = findAllCalls()

    const doc = await liveQuery.findOne(test.class.TestProject, { prjName: 'with-lookup' })

    expect(doc?.prjName).toBe('with-lookup')
    expect((doc as any)?.$lookup).toBeUndefined()
    expect(findAllCalls()).toBe(before)
  })

  it('keeps a projected document out of the cache', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    await createProject(factory, 'projected')
    await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: 'projected' },
      { projection: { _id: 1 } }
    )
    const before = findAllCalls()

    // A projected document is a partial one - serving it from the cache would hand back a doc with
    // fields missing, so the query has to go to the server.
    const doc = await liveQuery.findOne(test.class.TestProject, { prjName: 'projected' })

    expect(doc?.prjName).toBe('projected')
    expect(findAllCalls()).toBeGreaterThan(before)
  })

  it('keeps an unsubscribed query up to date, so the cache cannot go stale', async () => {
    // Unsubscribing only parks the query in the LRU queue - it still holds its documents in the
    // cache, so it has to keep applying txes or findOne would start answering with stale data.
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'parked')
    const q = await subscribe<TestProject>(liveQuery, test.class.TestProject, { _id: id })
    q.unsubscribe()

    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'parked-renamed' })
    await settle()

    const doc = await liveQuery.findOne(test.class.TestProject, { _id: id })
    expect(doc?.prjName).toBe('parked-renamed')
  })

  it('does not cache a document the limit window dropped right after it arrived', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    await createProject(factory, 'win-a')
    await createProject(factory, 'win-b')
    await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'win-%' } },
      { sort: { prjName: SortingOrder.Ascending }, limit: 2 }
    )

    // Sorts last, so handleDocAdd pushes it and the window pops it straight back out.
    const dropped = await createProject(factory, 'win-z')
    await settle()

    const before = findAllCalls()
    const doc = await liveQuery.findOne(test.class.TestProject, { _id: dropped })

    expect(doc?.prjName).toBe('win-z')
    // No query holds it, so nothing would ever clean it out of the cache.
    expect(findAllCalls()).toBeGreaterThan(before)
  })

  it('caches a document that entered the result by starting to match an update', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    const id = await createProject(factory, 'not-yet')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'now-matching' })

    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'now-matching' })
    await settle()

    const before = findAllCalls()
    const doc = await liveQuery.findOne(test.class.TestProject, { _id: id })

    expect(doc?.prjName).toBe('now-matching')
    expect(findAllCalls()).toBe(before)
  })

  it('drops a document once its query is evicted from the LRU queue', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    const id = await createProject(factory, 'evicted')
    const q = await subscribe<TestProject>(liveQuery, test.class.TestProject, { _id: id })
    q.unsubscribe()

    // CACHE_SIZE is 125; push the parked query out with distinct unsubscribed ones.
    for (let i = 0; i < 140; i++) {
      const filler = await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: `filler-${i}` })
      filler.unsubscribe()
    }
    const before = findAllCalls()

    const doc = await liveQuery.findOne(test.class.TestProject, { _id: id })

    expect(doc?.prjName).toBe('evicted')
    expect(findAllCalls()).toBeGreaterThan(before)
  })
})
