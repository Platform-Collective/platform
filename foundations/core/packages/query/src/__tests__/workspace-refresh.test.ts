// Workspace event and TxMixin branch coverage.
//
// Copyright © 2026 Intabia Fusion.
//

import core, {
  BulkUpdateEvent,
  createClient,
  generateId,
  IndexingUpdateEvent,
  type Class,
  type Client,
  type Doc,
  type Ref,
  type Space,
  type Tx,
  type TxMixin,
  TxOperations,
  TxWorkspaceEvent,
  WorkspaceEvent
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { test } from './minmodel'

interface TestProject extends Space {
  prjName: string
}

interface TestProjectMixin extends TestProject {
  someField?: string
}

async function getClient (): Promise<{
  liveQuery: LiveQuery
  factory: TxOperations
  findAllCalls: () => number
  // Toggle off to commit a tx to the server without the live query hearing about it,
  // so its cache goes stale on purpose.
  setNotify: (on: boolean) => void
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
  const realNotify = (...tx: Tx[]): void => {
    void liveQuery.tx(...tx)
  }
  storage.notify = realNotify
  return {
    liveQuery,
    factory: new TxOperations(storage, core.account.System),
    findAllCalls: () => calls,
    setNotify: (on) => {
      storage.notify = on ? realNotify : undefined
    }
  }
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

async function createSpace (factory: TxOperations, name: string): Promise<Ref<any>> {
  return await factory.createDoc(core.class.Space, core.space.Model, {
    name,
    description: '',
    private: false,
    members: [],
    archived: false
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

function indexingEvent (objectSpace: Ref<any>, classes: Ref<Class<Doc>>[]): TxWorkspaceEvent {
  const params: IndexingUpdateEvent = { _class: classes }
  return {
    _id: generateId(),
    _class: core.class.TxWorkspaceEvent,
    space: core.space.DerivedTx,
    modifiedOn: Date.now(),
    modifiedBy: core.account.System,
    objectSpace,
    event: WorkspaceEvent.IndexingUpdate,
    params
  }
}

function bulkEvent (objectSpace: Ref<any>, classes: Ref<Class<Doc>>[]): TxWorkspaceEvent {
  const params: BulkUpdateEvent = { _class: classes }
  return {
    _id: generateId(),
    _class: core.class.TxWorkspaceEvent,
    space: core.space.DerivedTx,
    modifiedOn: Date.now(),
    modifiedBy: core.account.System,
    objectSpace,
    event: WorkspaceEvent.BulkUpdate,
    params
  }
}

function securityEvent (objectSpace: Ref<any>): TxWorkspaceEvent {
  return {
    _id: generateId(),
    _class: core.class.TxWorkspaceEvent,
    space: core.space.DerivedTx,
    modifiedOn: Date.now(),
    modifiedBy: core.account.System,
    objectSpace,
    event: WorkspaceEvent.SecurityChange,
    params: null
  }
}

// CACHE_SIZE is 125; enough parked queries to push anything still in the LRU out of it.
async function fillLruQueue (liveQuery: LiveQuery): Promise<void> {
  for (let i = 0; i < 140; i++) {
    const filler = await subscribe<any>(liveQuery, test.class.TestProject, { prjName: `lru-filler-${i}` })
    filler.unsubscribe()
  }
}

// A parked query that an event drops must leave `queries` too, not just the LRU map - one that
// leaves only the LRU can never be evicted afterwards and lives on receiving every tx.
describe('parked queries are not leaked by workspace events', () => {
  for (const [name, makeEvent] of [
    ['BulkUpdate', (space: Ref<any>) => bulkEvent(space, [test.class.TestProject])],
    ['SecurityChange', (space: Ref<any>) => securityEvent(space)]
  ] as const) {
    it(`drops a parked query on ${name}`, async () => {
      const { liveQuery, findAllCalls } = await getClient()
      const q = await subscribe<any>(liveQuery, test.class.TestProject, { prjName: 'parked-target' })
      q.unsubscribe()

      await liveQuery.tx(makeEvent(core.space.Model))
      await settle()
      await fillLruQueue(liveQuery)
      const before = findAllCalls()

      await subscribe<any>(liveQuery, test.class.TestProject, { prjName: 'parked-target' })

      // Re-subscribing has to hit the server: a query that survived the fillers above would be
      // reused from memory and cost nothing.
      expect(findAllCalls()).toBeGreaterThan(before)
    })
  }

  it('evicts a parked query normally when no event fires', async () => {
    const { liveQuery, findAllCalls } = await getClient()
    const q = await subscribe<any>(liveQuery, test.class.TestProject, { prjName: 'control-target' })
    q.unsubscribe()

    await fillLruQueue(liveQuery)
    const before = findAllCalls()

    await subscribe<any>(liveQuery, test.class.TestProject, { prjName: 'control-target' })

    expect(findAllCalls()).toBeGreaterThan(before)
  })
})

describe('checkUpdateEvents', () => {
  it('refreshes an active $search query for a matching class', async () => {
    // The fake in-memory model has no full-text filtering, so $search always returns empty -
    // matching real content isn't observable here, but the round trip to a real server is.
    const { liveQuery, factory, findAllCalls } = await getClient()
    const space = await createSpace(factory, 'idx-active')
    await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'first'
    })

    await subscribe<any>(liveQuery, test.class.TestComment, { $search: 'anything' })

    const before = findAllCalls()
    await liveQuery.tx(indexingEvent(space, [test.class.TestComment]))
    await settle()

    expect(findAllCalls()).toBeGreaterThan(before)
  })

  it('does not refresh a $search query on an unrelated class', async () => {
    const { liveQuery, factory, findAllCalls, setNotify } = await getClient()
    const space = await createSpace(factory, 'idx-unrelated')

    const q = await subscribe<any>(liveQuery, test.class.TestProject, { $search: 'anything' })
    expect(q.last().length).toBe(0)

    setNotify(false)
    await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'silent',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'silent'
    })
    setNotify(true)
    await settle()

    const before = findAllCalls()
    await liveQuery.tx(indexingEvent(space, [test.class.TestComment]))
    await settle()

    // TestProject is unrelated to the TestComment event - must stay untouched.
    expect(findAllCalls()).toBe(before)
    expect(q.last().length).toBe(0)
  })

  it('evicts a parked $search query instead of refreshing it', async () => {
    const { liveQuery, factory, findAllCalls } = await getClient()
    const space = await createSpace(factory, 'idx-queue')
    await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'queued'
    })

    const q = await subscribe<any>(liveQuery, test.class.TestComment, { $search: 'anything' })
    q.unsubscribe()
    await settle()

    await liveQuery.tx(indexingEvent(space, [test.class.TestComment]))
    await settle()

    // A parked query that got evicted cannot be reused - the next identical subscribe must hit the
    // server again.
    const before = findAllCalls()
    await subscribe<any>(liveQuery, test.class.TestComment, { $search: 'anything' })
    expect(findAllCalls()).toBeGreaterThan(before)
  })

  it('refreshes an active BulkUpdate query and it sees data added out of band', async () => {
    const { liveQuery, factory, findAllCalls, setNotify } = await getClient()
    const space = await createSpace(factory, 'bulk-active')
    await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'first'
    })

    const q = await subscribe<any>(liveQuery, test.class.TestComment, {})
    expect(q.last().length).toBe(1)

    setNotify(false)
    await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'second'
    })
    setNotify(true)
    await settle()
    expect(q.last().length).toBe(1)

    const before = findAllCalls()
    await liveQuery.tx(bulkEvent(space, [test.class.TestComment]))
    await settle()

    expect(findAllCalls()).toBeGreaterThan(before)
    expect(q.last().length).toBe(2)

    q.unsubscribe()
  })

  it('does not refresh a BulkUpdate query on an unrelated class', async () => {
    const { liveQuery, factory, findAllCalls, setNotify } = await getClient()
    const space = await createSpace(factory, 'bulk-unrelated')

    const q = await subscribe<any>(liveQuery, test.class.TestProject, {})
    const before0 = q.last().length

    setNotify(false)
    await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'silent2',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'silent2'
    })
    setNotify(true)
    await settle()

    const before = findAllCalls()
    await liveQuery.tx(bulkEvent(space, [test.class.TestComment]))
    await settle()

    expect(findAllCalls()).toBe(before)
    expect(q.last().length).toBe(before0)
  })

  it('evicts a parked query on BulkUpdate instead of refreshing it', async () => {
    // Nobody is watching a parked query, so a bulk change drops it rather than paying to rebuild
    // it. Resubscribing then reloads from the server and sees the write it slept through.
    const { liveQuery, factory, findAllCalls, setNotify } = await getClient()
    const space = await createSpace(factory, 'bulk-queue')
    await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'queued'
    })

    const q = await subscribe<any>(liveQuery, test.class.TestComment, {})
    expect(q.last().length).toBe(1)
    q.unsubscribe()
    await settle()

    setNotify(false)
    await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'silent'
    })
    setNotify(true)
    await settle()

    await liveQuery.tx(bulkEvent(space, [test.class.TestComment]))
    await settle()

    // Evicted while parked - resubscribing rebuilds it from the server.
    const before = findAllCalls()
    const q2 = await subscribe<any>(liveQuery, test.class.TestComment, {})
    expect(findAllCalls()).toBeGreaterThan(before)
    expect(q2.last().length).toBe(2)
  })
})

describe('changePrivateHandler', () => {
  it('leaves a query pinned to a different space untouched on SecurityChange', async () => {
    const { liveQuery, factory, findAllCalls, setNotify } = await getClient()
    const watchedSpace = await createSpace(factory, 'sec-watched')
    const otherSpace = await createSpace(factory, 'sec-other')
    await factory.addCollection(test.class.TestComment, watchedSpace, watchedSpace, core.class.Space, 'comments', {
      message: 'in-watched'
    })

    // Pinned to watchedSpace, so it must not react to an event for otherSpace.
    const q = await subscribe<any>(liveQuery, test.class.TestComment, { space: watchedSpace })
    expect(q.last().length).toBe(1)

    setNotify(false)
    await factory.addCollection(test.class.TestComment, watchedSpace, watchedSpace, core.class.Space, 'comments', {
      message: 'silent'
    })
    setNotify(true)
    await settle()

    const before = findAllCalls()
    await liveQuery.tx(securityEvent(otherSpace))
    await settle()

    expect(findAllCalls()).toBe(before)
    expect(q.last().length).toBe(1)
  })
})

describe('txMixin', () => {
  it('re-fetches from the server instead of trusting a stale mixin tx (getCurrentDoc branch)', async () => {
    const { liveQuery, factory, setNotify } = await getClient()
    const id = await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'mix',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'mix'
    })

    const q = await subscribe<any>(liveQuery, test.class.TestProject, { _id: id })
    expect(q.last()[0]?.[test.mixin.TestProjectMixin]).toBeUndefined()

    // Commit the real mixin value without notifying - the live query's cache stays behind.
    setNotify(false)
    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'true-value'
    })
    setNotify(true)
    await settle()
    expect(q.last()[0]?.[test.mixin.TestProjectMixin]).toBeUndefined()

    // A tx whose modifiedOn is not newer than the cached doc is stale: the live query must re-fetch
    // the current doc from the server, not apply this tx's own attributes over stale cache.
    const staleTx: TxMixin<TestProject, TestProjectMixin> = {
      _id: generateId(),
      _class: core.class.TxMixin,
      space: core.space.DerivedTx,
      modifiedOn: 0,
      modifiedBy: core.account.System,
      objectId: id,
      objectClass: test.class.TestProject,
      objectSpace: core.space.Model,
      mixin: test.mixin.TestProjectMixin,
      attributes: { someField: 'stale-attempt' }
    }
    await liveQuery.tx(staleTx)
    await settle()

    expect(q.last()[0][test.mixin.TestProjectMixin].someField).toBe('true-value')

    q.unsubscribe()
  })

  it('adds a doc to a mixin-class query once the mixin tx makes it match (queries[0] === tx.mixin branch)', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'newly-mixed',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'newly-mixed'
    })

    // Subscribed directly on the mixin class before the doc carries the mixin - it starts empty.
    const q = await subscribe<any>(liveQuery, test.mixin.TestProjectMixin, {})
    expect(q.last().length).toBe(0)

    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'now-mixed'
    })
    await settle()

    expect(q.last().length).toBe(1)
    expect(q.last()[0]?.someField).toBe('now-mixed')

    q.unsubscribe()
  })
})
