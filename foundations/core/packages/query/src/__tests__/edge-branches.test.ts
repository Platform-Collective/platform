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

// Edge branches left uncovered elsewhere: a document that starts matching a query only after a
// TxUpdateDoc (matchQuery), the array-valued reverse-lookup fixups in handleDocUpdateLookup /
// handleDocAddLookup, total-tracking on the no-limit delete paths of getCurrentDoc and
// checkUpdatedDocMatch, the Tx-class subscription branch of txUpdateDoc, the total+limit refresh
// branch of handleDocUpdate, a sorted-window eviction that goes through updatedDocCallback instead
// of handleDocAdd, and two Refs/ResultArray cache-lookup fallbacks.

import core, {
  createClient,
  generateId,
  SortingOrder,
  TxFactory,
  toFindResult,
  TxOperations,
  type Class,
  type Client,
  type Doc,
  type FindResult,
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
  txFactory: TxFactory
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
  return {
    liveQuery,
    factory: new TxOperations(storage, core.account.System),
    storage,
    txFactory: new TxFactory(core.account.System),
    findAllCalls: () => calls
  }
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

describe('matchQuery: a document outside the result becomes matching', () => {
  it('pushes the doc and bumps total when it starts matching a plain query', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'not-yet')
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: 'now-target' },
      { total: true }
    )
    expect(q.last()).toHaveLength(0)

    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'now-target' })
    await settle()

    expect(q.last()).toHaveLength(1)
    expect(q.last()[0]?.prjName).toBe('now-target')
    expect(q.last().total).toBe(1)
  })

  it('rejects a mixin query when the updated document still lacks the mixin', async () => {
    // getDocFromCache fetches by q._class, so a mixin query whose doc never got the mixin
    // returns realDoc==null - same guard as the 'ghost object' case, reached via a real doc.
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'no-mixin')
    const q = await subscribe<any>(liveQuery, test.mixin.TestProjectMixin, { prjName: 'mixin-target' })
    expect(q.last()).toHaveLength(0)

    // Updates the base TestProject doc directly - the mixin is never attached to it.
    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'mixin-target' })
    await settle()

    expect(q.last()).toHaveLength(0)
  })

  it('does not crash and still re-queries the server when the updated object no longer exists', async () => {
    const { liveQuery, txFactory, findAllCalls } = await getClient()
    const q = await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'ghost' })
    expect(q.last()).toHaveLength(0)
    const before = findAllCalls()

    // Bypass the server entirely: this objectId was never created, so getDocFromCache's findOne
    // resolves to undefined (matchQuery's realDoc == null guard).
    const tx = txFactory.createTxUpdateDoc(
      test.class.TestProject,
      core.space.Model,
      generateId(),
      { prjName: 'ghost' },
      false,
      Date.now()
    )
    await liveQuery.tx(tx)
    await settle()

    expect(q.last()).toHaveLength(0)
    expect(findAllCalls()).toBeGreaterThan(before)
  })
})

describe('handleUpdate over a limited+sorted window via matchQuery', () => {
  it('evicts the correct tail doc when a newly matching doc sorts into the middle of the window', async () => {
    const { liveQuery, factory } = await getClient()
    await createProject(factory, 'w-b')
    await createProject(factory, 'w-c')
    const outsideId = await createProject(factory, 'q-a') // does not match the w-% filter yet
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'w-%' } },
      { sort: { prjName: SortingOrder.Ascending }, limit: 2 }
    )
    expect(q.last().map((d) => d.prjName)).toEqual(['w-b', 'w-c'])

    await factory.updateDoc(test.class.TestProject, core.space.Model, outsideId, { prjName: 'w-a' })
    await settle()

    expect(q.last().map((d) => d.prjName)).toEqual(['w-a', 'w-b'])
  })
})

describe('handleDocUpdate: total-tracking refresh for an out-of-window same-class update', () => {
  it('refreshes when a same-class update does not touch the query field but the window is full', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    await createProject(factory, 'win-a')
    const b = await createProject(factory, 'win-b')
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'win-%' } },
      { limit: 1, total: true }
    )
    expect(q.last()).toHaveLength(1)
    const before = findAllCalls()

    // 'b' is outside the window and this update does not touch prjName, so it still will not
    // match - but total could still be wrong for the wider set, so this forces a refresh.
    await factory.updateDoc(test.class.TestProject, core.space.Model, b, { description: 'touched' })
    await settle()

    expect(findAllCalls()).toBeGreaterThan(before)
  })
})

describe('getCurrentDoc: leaving an unlimited result (equal-timestamp path)', () => {
  it('decrements total when an equal-timestamp update removes the doc', async () => {
    const { liveQuery, factory, storage, txFactory } = await getClient()
    const id = await createProject(factory, 'eq-a')
    await createProject(factory, 'eq-b')
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'eq-%' } },
      {
        total: true
      }
    )
    expect(q.last()).toHaveLength(2)
    const sameTs = (q.last().find((d) => d._id === id) as TestProject).modifiedOn

    const tx = txFactory.createTxUpdateDoc(
      test.class.TestProject,
      core.space.Model,
      id,
      { prjName: 'left' },
      false,
      sameTs
    )
    await storage.tx(tx)
    await settle()

    expect(q.last()).toHaveLength(1)
    expect(q.last().total).toBe(1)
  })
})

describe('getCurrentDoc: refresh when a full window loses its equal-timestamp match', () => {
  it('refreshes from the server and does not just drop the doc locally', async () => {
    const { liveQuery, factory, storage, txFactory, findAllCalls } = await getClient()
    const id = await createProject(factory, 'cap-a')
    await createProject(factory, 'cap-b')
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'cap-%' } },
      {
        limit: 2
      }
    )
    expect(q.last()).toHaveLength(2)
    const before = findAllCalls()
    const sameTs = (q.last().find((d) => d._id === id) as TestProject).modifiedOn

    const tx = txFactory.createTxUpdateDoc(
      test.class.TestProject,
      core.space.Model,
      id,
      { prjName: 'gone-away' },
      false,
      sameTs
    )
    await storage.tx(tx)
    await settle()

    // Window was exactly at limit == result.length, so getCurrentDoc refreshes instead of
    // deleting locally - handleDocUpdate's own `if (currentRefresh) return` follows the same path.
    expect(findAllCalls()).toBeGreaterThan(before)
    expect(q.last()).toHaveLength(1)
  })
})

describe('checkUpdatedDocMatch: leaving an unlimited result (newer-timestamp path)', () => {
  it('decrements total when a newer-timestamp update makes the doc stop matching', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'leave-a')
    await createProject(factory, 'leave-b')
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'leave-%' } },
      {
        total: true
      }
    )
    expect(q.last()).toHaveLength(2)

    // Date.now() has ms resolution - without a delay the update can land in the same millisecond
    // as the create and take the getCurrentDoc branch instead of this one.
    await new Promise((resolve) => setTimeout(resolve, 3))
    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'left' })
    await settle()

    expect(q.last()).toHaveLength(1)
    expect(q.last().total).toBe(1)
  })
})

describe('txUpdateDoc: query subscribed directly on a Tx class', () => {
  it('adds a matching update tx to the result', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'tx-log')
    const q = await subscribe<any>(liveQuery, core.class.TxUpdateDoc, {})
    expect(q.last()).toHaveLength(0)

    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'tx-log-2' })
    await settle()

    expect(q.last()).toHaveLength(1)
    expect(q.last()[0]?.objectId).toBe(id)
  })

  it('skips a non-matching update tx but still processes the rest of the loop', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'tx-log-skip')
    const q = await subscribe<any>(liveQuery, core.class.TxUpdateDoc, { objectClass: test.class.TestComment })
    expect(q.last()).toHaveLength(0)

    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'tx-log-skip-2' })
    await settle()

    expect(q.last()).toHaveLength(0)
  })
})

describe('processLookupUpdateDoc: array lookup gains an entry via reverse-attach', () => {
  it("adds a re-parented attached doc into the destination parent's reverse lookup", async () => {
    const { liveQuery, factory } = await getClient()
    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'reparent-space',
      description: '',
      private: false,
      members: [],
      archived: false
    })
    const fromParent = await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'from'
    })
    const toParent = await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'to'
    })
    const child = await factory.addCollection(
      test.class.TestComment,
      space,
      fromParent,
      test.class.TestComment,
      'comments',
      { message: 'child' }
    )

    const q = await subscribe<any>(
      liveQuery,
      test.class.TestComment,
      { _id: toParent },
      {
        lookup: { _id: { comments: test.class.TestComment } }
      }
    )
    expect(q.last()[0].$lookup?.comments).toHaveLength(0)

    await factory.updateCollection(test.class.TestComment, space, child, toParent, test.class.TestComment, 'comments', {
      attachedTo: toParent
    })
    await settle()

    expect(q.last()[0].$lookup?.comments).toHaveLength(1)
    expect(q.last()[0].$lookup?.comments[0]._id).toBe(child)
  })
})

describe('proccesLookupAddDoc: duplicate create replay', () => {
  it('updates the existing array entry in place instead of duplicating it on a re-delivered create tx', async () => {
    const { liveQuery, factory, storage, txFactory } = await getClient()
    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'replay-space',
      description: '',
      private: false,
      members: [],
      archived: false
    })
    const q = await subscribe<any>(
      liveQuery,
      core.class.Space,
      { _id: space },
      {
        lookup: { _id: { comments: test.class.TestComment } }
      }
    )
    expect(q.last()[0].$lookup?.comments).toHaveLength(0)

    const createTx = txFactory.createTxCreateDoc(
      test.class.TestComment,
      space,
      {
        attachedTo: space,
        attachedToClass: core.class.Space,
        collection: 'comments',
        message: 'child'
      },
      undefined
    )
    await storage.tx(createTx)
    await settle()
    expect(q.last()[0].$lookup?.comments).toHaveLength(1)

    // Re-deliver the identical tx (reconnect replay / double notify).
    await liveQuery.tx(createTx)
    await settle()

    expect(q.last()[0].$lookup?.comments).toHaveLength(1)
    expect(q.last()[0].$lookup?.comments[0].message).toBe('child')
  })
})

describe('Refs.updateDocuments: clean on a class key the cache never populated', () => {
  it('does not throw and still removes the query from the LRU queue', async () => {
    const { liveQuery } = await getClient()
    const q = await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'never-matches-anything' })
    expect(q.last()).toHaveLength(0)

    const qMap = (liveQuery as any).queries.get(test.class.TestProject) as Map<any, any>
    const internalQuery = Array.from(qMap.values()).find((it: any) => it.query.prjName === 'never-matches-anything')

    // Seeds a doc into ResultArray, bypassing handleDocAdd/callback, so refs cache was never
    // populated for its class - cleanup hits the early-continue guard for an unknown key.
    const fakeDoc = {
      _id: generateId(),
      _class: test.class.TestProject,
      space: core.space.Model,
      modifiedBy: core.account.System,
      modifiedOn: Date.now(),
      prjName: 'seeded'
    }
    internalQuery.result.push(fakeDoc)

    expect(() => {
      liveQuery.removeQueue(internalQuery)
    }).not.toThrow()
    expect((liveQuery as any).queries.get(test.class.TestProject)?.has(internalQuery.id)).toBe(false)
  })
})

describe('Refs.findFromDocs: mixin fallback in the lookup-keyed cache scan', () => {
  it('answers a plain mixin findOne, stripped of $lookup, from a cache entry keyed with a lookup', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    const id = await createProject(factory, 'mix-fallback')
    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'v'
    })
    // Cache this doc under the mixin class with a lookup-specific key.
    await subscribe<any>(
      liveQuery,
      test.mixin.TestProjectMixin,
      { prjName: 'mix-fallback' },
      {
        lookup: { _id: { comments: test.class.TestComment } }
      }
    )
    const before = findAllCalls()

    const doc = await liveQuery.findOne<any>(test.mixin.TestProjectMixin, { prjName: 'mix-fallback' })

    expect(doc?.someField).toBe('v')
    expect(doc?.$lookup).toBeUndefined()
    expect(findAllCalls()).toBe(before)
  })
})
