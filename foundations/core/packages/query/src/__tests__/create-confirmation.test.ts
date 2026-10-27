// SPDX-License-Identifier: EPL-2.0

import core, {
  createClient,
  SortingOrder,
  TxFactory,
  TxProcessor,
  toFindResult,
  type Class,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type Ref,
  type Tx,
  type TxCreateDoc,
  type TxCUD
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { type AttachedComment, test } from './minmodel'

const factory = new TxFactory(core.account.System)

interface CountedComment extends AttachedComment {
  count?: number
}

function message (text: string, time: number): TxCreateDoc<AttachedComment> {
  const tx = factory.createTxCreateDoc(test.class.TestComment, core.space.Model, {
    message: text,
    attachedTo: core.space.Model,
    attachedToClass: core.class.Space,
    collection: 'comments'
  })
  return { ...tx, createdOn: time, modifiedOn: time }
}

function confirmation<T extends Doc> (tx: TxCreateDoc<T>, time: number): TxCreateDoc<T> {
  return { ...tx, createdOn: time, modifiedOn: time, meta: { isCreateConfirmation: true } }
}

function optimistic<T extends Doc> (tx: TxCreateDoc<T>): TxCreateDoc<T> {
  return { ...tx, meta: { ...tx.meta, isOptimisticCreate: true } }
}

// Mixin results are proxies: mixin attributes are readable through them but are not own
// properties, which toMatchObject requires. Read the asserted fields through the proxy instead.
function mixinFields (doc: { createdOn?: number, someField?: string } | undefined): Record<string, unknown> {
  return { createdOn: doc?.createdOn, someField: doc?.someField }
}

// A transaction no test query depends on, as arrives continuously in a busy workspace.
function unrelatedCreate (): Tx {
  return factory.createTxCreateDoc(test.class.TestProject, core.space.Model, {
    name: 'busy',
    description: '',
    private: false,
    archived: false,
    members: [],
    prjName: 'busy'
  })
}

function deferred<T> (): { promise: Promise<T>, resolve: (value: T) => void } {
  let complete: (value: T) => void = () => {
    throw new Error('Deferred promise is not initialized')
  }
  const promise = new Promise<T>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: complete }
}

async function subscribe (
  liveQuery: LiveQuery,
  query: DocumentQuery<AttachedComment> = {},
  options: FindOptions<AttachedComment> = { sort: { createdOn: SortingOrder.Ascending }, total: true }
): Promise<{ result: () => FindResult<AttachedComment>, callback: jest.Mock, unsubscribe: () => void }> {
  return await subscribeClass(liveQuery, test.class.TestComment, query, options)
}

async function subscribeClass<T extends Doc> (
  liveQuery: LiveQuery,
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  options: FindOptions<T>
): Promise<{ result: () => FindResult<T>, callback: jest.Mock, unsubscribe: () => void }> {
  let last: FindResult<T>
  const ready = deferred<undefined>()
  const callback = jest.fn((res: FindResult<T>) => {
    last = res
  })
  const unsubscribe = liveQuery.query(
    _class,
    query,
    (res) => {
      callback(res)
      ready.resolve(undefined)
    },
    options
  )
  await ready.promise
  return { result: () => last, callback, unsubscribe }
}

describe('optimistic create confirmation', () => {
  it.each([
    [50, 200, 300],
    [500, 200, 300],
    [50, 300, 200],
    [500, 300, 200]
  ])('converges with peers and reloads (client %i, own %i, peer %i)', async (localTime, ownTime, peerTime) => {
    const storage = await createClient(connect)
    const sender = new LiveQuery(storage)
    const peer = new LiveQuery(storage)
    try {
      const first = await subscribe(sender)
      const second = await subscribe(sender)
      const remote = await subscribe(peer)
      const own = message('own', localTime)
      const other = message('peer', peerTime)
      await sender.tx(optimistic(own))
      await peer.tx(optimistic({ ...other, createdOn: localTime + 10, modifiedOn: localTime + 10 }))
      await storage.tx(other)
      await sender.tx(other)
      await peer.tx(confirmation(other, peerTime))
      const confirmed = confirmation(own, ownTime)
      await storage.tx(confirmed)
      await sender.tx(confirmed)
      await peer.tx({ ...confirmed, meta: undefined })

      const reloaded = await storage.findAll(
        test.class.TestComment,
        {},
        {
          sort: { createdOn: SortingOrder.Ascending }
        }
      )
      const snapshot = (docs: AttachedComment[]): unknown[] =>
        docs.map(({ _id, createdOn, modifiedOn, message }) => ({ _id, createdOn, modifiedOn, message }))
      expect(snapshot(first.result())).toEqual(snapshot(reloaded))
      expect(snapshot(second.result())).toEqual(snapshot(reloaded))
      expect(snapshot(remote.result())).toEqual(snapshot(reloaded))
      expect(first.result().total).toBe(2)
      expect(second.result().total).toBe(2)
      expect((await sender.findOne(test.class.TestComment, { _id: own.objectId }))?.createdOn).toBe(ownTime)

      // An ordinary replay must not emit another callback.
      const calls = first.callback.mock.calls.length
      await sender.tx({ ...confirmed, meta: undefined })
      expect(first.callback).toHaveBeenCalledTimes(calls)
    } finally {
      await sender.close()
      await peer.close()
    }
  })

  it('moves a confirmed document between timestamp queries without counting it twice', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const before = await subscribe(liveQuery, { createdOn: { $lt: 200 } })
      const after = await subscribe(liveQuery, { createdOn: { $gte: 200 } })
      const own = message('own', 100)
      await liveQuery.tx(optimistic(own))
      expect(before.result()).toHaveLength(1)
      const confirmed = confirmation(own, 300)
      await storage.tx(confirmed)
      await liveQuery.tx(confirmed)
      expect(before.result()).toHaveLength(0)
      expect(before.result().total).toBe(0)
      expect(after.result().map((doc) => doc._id)).toEqual([own.objectId])
      expect(after.result().total).toBe(1)
    } finally {
      await liveQuery.close()
    }
  })

  it('refreshes search membership from the server instead of assuming a local match', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const findAll = jest.spyOn(storage, 'findAll').mockResolvedValueOnce(toFindResult([], 0))
      const query = await subscribe(liveQuery, { $search: 'own' })
      const own = message('own', 500)
      const findOne = jest.spyOn(storage, 'findOne').mockResolvedValueOnce(TxProcessor.createDoc2Doc(own))
      await liveQuery.tx(optimistic(own))
      expect(query.result().map((doc) => doc._id)).toEqual([own.objectId])
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      findAll.mockClear()
      findOne.mockClear()
      findAll.mockResolvedValueOnce(toFindResult([], 0))
      await liveQuery.tx(confirmed)
      expect(query.result()).toHaveLength(0)
      expect(query.result().total).toBe(0)
      expect(findAll).toHaveBeenCalledTimes(1)
      expect(findAll).toHaveBeenCalledWith(test.class.TestComment, { $search: 'own' }, expect.anything())
      expect(findOne).not.toHaveBeenCalled()
    } finally {
      await liveQuery.close()
    }
  })

  it('does not refresh unrelated limited queries with totals', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const unrelated = await subscribe(liveQuery, { message: 'unrelated' }, { limit: 1, total: true })
      const own = message('own', 500)
      await liveQuery.tx(optimistic(own))
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const findAll = jest.spyOn(storage, 'findAll')
      const findOne = jest.spyOn(storage, 'findOne')
      const calls = unrelated.callback.mock.calls.length
      await liveQuery.tx(confirmed)
      expect(findAll).not.toHaveBeenCalled()
      expect(findOne).not.toHaveBeenCalled()
      expect(unrelated.callback).toHaveBeenCalledTimes(calls)
      expect(unrelated.result()).toHaveLength(0)
      expect(unrelated.result().total).toBe(0)
    } finally {
      await liveQuery.close()
    }
  })

  it('patches timestamps across cached queries without reading the server', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const ascending = await subscribe(liveQuery)
      const descending = await subscribe(liveQuery, {}, { sort: { createdOn: SortingOrder.Descending } })
      const projected = await subscribe(liveQuery, {}, { projection: { createdOn: 1, modifiedOn: 1 } })
      const own = message('own', 500)
      await liveQuery.tx(optimistic(own))
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const findAll = jest.spyOn(storage, 'findAll')
      const findOne = jest.spyOn(storage, 'findOne')
      await liveQuery.tx(confirmed)
      for (const query of [ascending, descending, projected]) {
        expect(query.result()[0]).toMatchObject({ createdOn: 100, modifiedOn: 100 })
      }
      expect((await liveQuery.findOne(test.class.TestComment, { _id: own.objectId }))?.createdOn).toBe(100)
      expect(findAll).not.toHaveBeenCalled()
      expect(findOne).not.toHaveBeenCalled()
    } finally {
      await liveQuery.close()
    }
  })

  it.each([
    [SortingOrder.Ascending, 50, 150],
    [SortingOrder.Ascending, 150, 50],
    [SortingOrder.Ascending, 250, 100],
    [SortingOrder.Descending, 550, 450],
    [SortingOrder.Descending, 450, 550],
    [SortingOrder.Descending, 350, 500]
  ])(
    'keeps a full window locally when its edge is not crossed (sort %i, client %i, server %i)',
    async (order, localTime, serverTime) => {
      const storage = await createClient(connect)
      const liveQuery = new LiveQuery(storage)
      try {
        for (const time of [200, 300, 400]) {
          await storage.tx(message('peer', time))
        }
        const sort = { createdOn: order, _id: order }
        const window = await subscribe(liveQuery, {}, { sort, limit: 2, total: true })
        const own = message('own', localTime)
        await liveQuery.tx(optimistic(own))
        const confirmed = confirmation(own, serverTime)
        await storage.tx(confirmed)
        const reloaded = await storage.findAll(test.class.TestComment, {}, { sort, limit: 2, total: true })
        const findAll = jest.spyOn(storage, 'findAll')
        const findOne = jest.spyOn(storage, 'findOne')
        await liveQuery.tx(confirmed)
        expect(window.result()).toEqual(reloaded)
        expect(findAll).not.toHaveBeenCalled()
        expect(findOne).not.toHaveBeenCalled()
      } finally {
        await liveQuery.close()
      }
    }
  )

  it.each([1, 2])('reconciles a complete limited result locally (limit %i)', async (limit) => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const window = await subscribe(
        liveQuery,
        {},
        {
          sort: { createdOn: SortingOrder.Ascending },
          limit,
          total: true
        }
      )
      const own = message('own', 100)
      await liveQuery.tx(optimistic(own))
      const confirmed = confirmation(own, 300)
      await storage.tx(confirmed)
      const findAll = jest.spyOn(storage, 'findAll')
      const findOne = jest.spyOn(storage, 'findOne')
      await liveQuery.tx(confirmed)
      expect(window.result()[0]).toMatchObject({ createdOn: 300, modifiedOn: 300 })
      expect(window.result().total).toBe(1)
      expect(findAll).not.toHaveBeenCalled()
      expect(findOne).not.toHaveBeenCalled()
    } finally {
      await liveQuery.close()
    }
  })

  it.each([
    ['createdOn', SortingOrder.Ascending, 500, 350, true],
    ['createdOn', SortingOrder.Ascending, 500, 450, false],
    ['createdOn', SortingOrder.Ascending, 500, 300, true],
    ['createdOn', SortingOrder.Descending, 100, 250, true],
    ['createdOn', SortingOrder.Descending, 100, 50, false],
    ['createdOn', SortingOrder.Descending, 100, 300, false],
    ['message', SortingOrder.Ascending, 100, 500, true],
    ['message', SortingOrder.Descending, 500, 100, false]
  ] as const)(
    'keeps an already counted optimistic create counted after it is popped from the window (%s, %i, %i, %i, %s)',
    async (field, order, localTime, serverTime, total) => {
      const storage = await createClient(connect)
      const liveQuery = new LiveQuery(storage)
      try {
        for (const time of [200, 300, 400]) {
          await storage.tx(message('peer', time))
        }
        const sort = { [field]: order, message: order, _id: order }
        const window = await subscribe(liveQuery, {}, { sort, limit: 2, total })
        const own = message(order === SortingOrder.Ascending ? 'z-own' : 'a-own', localTime)
        await liveQuery.tx(optimistic(own))
        expect(window.result().some((doc) => doc._id === own.objectId)).toBe(false)
        const confirmed = confirmation(own, serverTime)
        await storage.tx(confirmed)
        const reloaded = await storage.findAll(test.class.TestComment, {}, { sort, limit: 2, total })
        const findAll = jest.spyOn(storage, 'findAll')
        const findOne = jest.spyOn(storage, 'findOne')
        const calls = window.callback.mock.calls.length
        await liveQuery.tx(confirmed)
        expect([...window.result()]).toEqual([...reloaded])
        if (total) expect(window.result().total).toBe(reloaded.total)
        expect(window.callback).toHaveBeenCalledTimes(calls)
        expect(findAll).not.toHaveBeenCalled()
        expect(findOne).not.toHaveBeenCalled()
      } finally {
        await liveQuery.close()
      }
    }
  )

  it.each([false, true])('adds an absent confirmed doc to an underfilled window locally (total %s)', async (total) => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      await storage.tx(message('peer', 150))
      const query = { createdOn: { $lt: 200 } }
      const options = { sort: { createdOn: SortingOrder.Ascending }, limit: 3, total }
      const window = await subscribe(liveQuery, query, options)
      const own = message('own', 500)
      await liveQuery.tx(optimistic(own))
      expect(window.result()).toHaveLength(1)
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const reloaded = await storage.findAll(test.class.TestComment, query, options)
      const findAll = jest.spyOn(storage, 'findAll')
      const findOne = jest.spyOn(storage, 'findOne')
      await liveQuery.tx(confirmed)
      expect([...window.result()]).toEqual([...reloaded])
      if (total) expect(window.result().total).toBe(reloaded.total)
      expect(window.result()[0]._id).toBe(own.objectId)
      expect(findAll).not.toHaveBeenCalled()
      expect(findOne).not.toHaveBeenCalled()
    } finally {
      await liveQuery.close()
    }
  })

  it.each([
    [100, 300],
    [400, 100]
  ])('reconciles a limited window (client %i, server %i)', async (localTime, serverTime) => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const other = message('peer', 200)
      await storage.tx(other)
      const window = await subscribe(
        liveQuery,
        {},
        {
          sort: { createdOn: SortingOrder.Ascending },
          limit: 1,
          total: true
        }
      )
      const own = message('own', localTime)
      await liveQuery.tx(optimistic(own))
      expect(window.result()[0]._id).toBe(localTime < 200 ? own.objectId : other.objectId)
      const confirmed = confirmation(own, serverTime)
      await storage.tx(confirmed)
      const findAll = jest.spyOn(storage, 'findAll')
      const findOne = jest.spyOn(storage, 'findOne')
      await liveQuery.tx(confirmed)
      expect(window.result().map((doc) => doc._id)).toEqual([serverTime < 200 ? own.objectId : other.objectId])
      expect(window.result().total).toBe(2)
      expect(findAll).toHaveBeenCalledTimes(1)
      expect(findOne).not.toHaveBeenCalled()
    } finally {
      await liveQuery.close()
    }
  })

  it('keeps TxCUD queries on the immutable transaction add path', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const own = message('own', 500)
      let result: FindResult<TxCUD<Doc>> | undefined
      const callback = jest.fn((docs: FindResult<TxCUD<Doc>>) => {
        result = docs
      })
      await new Promise<void>((resolve) => {
        liveQuery.query(
          core.class.TxCUD,
          { objectId: own.objectId },
          (docs) => {
            callback(docs)
            resolve()
          },
          { limit: 1, total: true }
        )
      })
      await liveQuery.tx(optimistic(own))
      const calls = callback.mock.calls.length
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const findAll = jest.spyOn(storage, 'findAll')
      const findOne = jest.spyOn(storage, 'findOne')
      await liveQuery.tx(confirmed)
      expect(result?.map((doc) => doc._id)).toEqual([own._id])
      expect(result?.total).toBe(1)
      expect(result?.[0].modifiedOn).toBe(500)
      expect(callback).toHaveBeenCalledTimes(calls)
      expect(findAll).not.toHaveBeenCalled()
      expect(findOne).not.toHaveBeenCalled()
    } finally {
      await liveQuery.close()
    }
  })

  it('preserves an edit below createdOn when the client clock is ahead', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const query = await subscribe(liveQuery)
      const own = message('original', 500)
      await liveQuery.tx(optimistic(own))
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const update = factory.createTxUpdateDoc(test.class.TestComment, own.objectSpace, own.objectId, {
        message: 'edited'
      })
      update.modifiedOn = 200
      await storage.tx(update)
      // An early-applied edit can be below the optimistic create's timestamp under skew.
      await liveQuery.tx({ ...update, meta: { forceApply: true } })
      expect(query.result()[0]).toMatchObject({ createdOn: 500, modifiedOn: 200, message: 'edited' })
      const findOne = jest.spyOn(storage, 'findOne')
      await liveQuery.tx(confirmed)
      expect(query.result()[0]).toMatchObject({ createdOn: 100, modifiedOn: 200, message: 'edited' })
      expect(await liveQuery.findOne(test.class.TestComment, { _id: own.objectId })).toMatchObject({
        createdOn: 100,
        modifiedOn: 200,
        message: 'edited'
      })
      expect(query.result().total).toBe(1)
      expect(findOne).toHaveBeenCalledTimes(1)
    } finally {
      await liveQuery.close()
    }
  })

  it('reads server-loaded never-edited copies instead of treating them as optimistic', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const own = message('original', 100)
      await storage.tx(own)
      const query = await subscribe(liveQuery)
      const update = factory.createTxUpdateDoc(test.class.TestComment, own.objectSpace, own.objectId, {
        message: 'edited on server'
      })
      update.modifiedOn = 200
      await storage.tx(update)
      const findOne = jest.spyOn(storage, 'findOne')
      await liveQuery.tx(confirmation(own, 100))
      expect(query.result()[0]).toMatchObject({ createdOn: 100, modifiedOn: 200, message: 'edited on server' })
      expect(findOne).toHaveBeenCalledTimes(1)
    } finally {
      await liveQuery.close()
    }
  })

  it.each([false, true])('preserves pending cache copies with the ID query first: %s', async (idFirst) => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const own = message('own', 500)
      const allOptions = { limit: 1 }
      const first = idFirst
        ? await subscribe(liveQuery, { _id: own.objectId })
        : await subscribe(liveQuery, {}, allOptions)
      await liveQuery.tx(optimistic(own))
      const second = idFirst
        ? await subscribe(liveQuery, {}, allOptions)
        : await subscribe(liveQuery, { _id: own.objectId })
      expect(second.result()[0]).toMatchObject({ createdOn: 500, modifiedOn: 500 })
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const findOne = jest.spyOn(storage, 'findOne')
      const findAll = jest.spyOn(storage, 'findAll')
      await liveQuery.tx(confirmed)
      for (const query of [first, second]) {
        expect(query.result()).toHaveLength(1)
        expect(query.result()[0]).toMatchObject({ createdOn: 100, modifiedOn: 100 })
      }
      expect(await liveQuery.findOne(test.class.TestComment, { _id: own.objectId })).toMatchObject({
        createdOn: 100,
        modifiedOn: 100
      })
      expect(findOne).not.toHaveBeenCalled()
      expect(findAll).not.toHaveBeenCalled()
      first.unsubscribe()
      const firstCleanup = await liveQuery.refreshConnect(false, LiveQuery.IDLE_DROP_GAP_MS + 1)
      expect(firstCleanup.droppedQueries).toBe(1)
      expect(firstCleanup.activeQueries).toBe(1)
      // Reconnect intentionally refreshes the remaining subscriber; isolate the cached read.
      findAll.mockClear()
      expect(await liveQuery.findOne(test.class.TestComment, { _id: own.objectId })).toMatchObject({ createdOn: 100 })
      expect(findOne).not.toHaveBeenCalled()
      expect(findAll).not.toHaveBeenCalled()
      second.unsubscribe()
      const secondCleanup = await liveQuery.refreshConnect(false, LiveQuery.IDLE_DROP_GAP_MS + 1)
      expect(secondCleanup.droppedQueries).toBe(1)
      expect(secondCleanup.activeQueries).toBe(0)
      await liveQuery.findOne(test.class.TestComment, { _id: own.objectId })
      expect(findAll).toHaveBeenCalledTimes(1)
    } finally {
      await liveQuery.close()
    }
  })

  it.each([false, true])('preserves the cache when a timestamp query departs first: %s', async (departingFirst) => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const departingQuery: DocumentQuery<AttachedComment> = { createdOn: { $gt: 300 } }
      const first = await subscribe(liveQuery, departingFirst ? departingQuery : {})
      const second = await subscribe(liveQuery, departingFirst ? {} : departingQuery)
      const retained = departingFirst ? second : first
      const departing = departingFirst ? first : second
      const own = message('own', 500)
      await liveQuery.tx(optimistic(own))
      expect(first.result()[0].createdOn).toBe(500)
      expect(second.result()[0].createdOn).toBe(500)
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const findAll = jest.spyOn(storage, 'findAll')
      await liveQuery.tx(confirmed)
      expect(retained.result()[0]).toMatchObject({ createdOn: 100, modifiedOn: 100 })
      expect(departing.result()).toHaveLength(0)
      expect(departing.result().total).toBe(0)
      expect(await liveQuery.findOne(test.class.TestComment, { _id: own.objectId })).toMatchObject({ createdOn: 100 })
      const cached = await subscribe(liveQuery, {}, { limit: 1 })
      expect(cached.result()[0]).toMatchObject({ createdOn: 100, modifiedOn: 100 })
      expect(findAll).not.toHaveBeenCalled()

      for (const [index, query] of [first, second, cached].entries()) {
        query.unsubscribe()
        const cleanup = await liveQuery.refreshConnect(false, LiveQuery.IDLE_DROP_GAP_MS + 1)
        expect(cleanup.droppedQueries).toBe(1)
        expect(cleanup.activeQueries).toBe(2 - index)
        findAll.mockClear()
        expect(await liveQuery.findOne(test.class.TestComment, { _id: own.objectId })).toMatchObject({ createdOn: 100 })
        expect(findAll).toHaveBeenCalledTimes(index === 2 ? 1 : 0)
      }
    } finally {
      await liveQuery.close()
    }
  })

  it.each(
    [false, true].flatMap((mixinFirst) =>
      ['retained', 'leaving', 'entering'].map((membership) => ({ mixinFirst, membership }))
    )
  )('reconciles base and mixin queries (mixin first: $mixinFirst, $membership)', async ({ mixinFirst, membership }) => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const create = factory.createTxCreateDoc(test.class.TestProject, core.space.Model, {
        name: 'project',
        description: '',
        private: false,
        archived: false,
        members: [],
        prjName: 'project',
        [test.mixin.TestProjectMixin]: { someField: 'included' }
      })
      const localTime = membership === 'entering' ? 100 : 500
      const serverTime = membership === 'entering' ? 500 : 100
      const own = { ...create, createdOn: localTime, modifiedOn: localTime }
      const options = { sort: { createdOn: SortingOrder.Ascending }, total: true }
      const mixinPredicate = {
        someField: 'included',
        ...(membership === 'retained' ? {} : { createdOn: { $gt: 300 } })
      }
      const openBase = async (): ReturnType<typeof subscribeClass> =>
        await subscribeClass(liveQuery, test.class.TestProject, {}, options)
      const openMixin = async (): ReturnType<typeof subscribeClass> =>
        await subscribeClass(liveQuery, test.mixin.TestProjectMixin, mixinPredicate, options)
      const first = mixinFirst ? await openMixin() : await openBase()
      const second = mixinFirst ? await openBase() : await openMixin()
      const base = mixinFirst ? second : first
      const mixed = mixinFirst ? first : second
      await liveQuery.tx(optimistic(own))
      expect(base.result()[0].createdOn).toBe(localTime)
      expect(mixed.result()).toHaveLength(membership === 'entering' ? 0 : 1)
      const confirmed = confirmation(own, serverTime)
      await storage.tx(confirmed)
      const findAll = jest.spyOn(storage, 'findAll')
      await liveQuery.tx(confirmed)
      expect(base.result()[0]).toMatchObject({ createdOn: serverTime, modifiedOn: serverTime })
      expect(mixed.result()).toHaveLength(membership === 'leaving' ? 0 : 1)
      expect(mixed.result().total).toBe(membership === 'leaving' ? 0 : 1)
      if (membership !== 'leaving') {
        const expected = { createdOn: serverTime, someField: 'included' }
        expect(mixinFields(mixed.result()[0])).toEqual(expected)
        const found = await liveQuery.findOne(test.mixin.TestProjectMixin, { _id: own.objectId })
        expect(mixinFields(found)).toEqual(expected)
        const cached = await subscribeClass(liveQuery, test.mixin.TestProjectMixin, {}, { limit: 1 })
        expect(mixinFields(cached.result()[0])).toEqual(expected)
      }
      expect(await liveQuery.findOne(test.class.TestProject, { _id: own.objectId })).toMatchObject({
        createdOn: serverTime,
        modifiedOn: serverTime
      })
      expect(findAll).not.toHaveBeenCalled()
    } finally {
      await liveQuery.close()
    }
  })

  it.each([false, true])(
    'counts an absent membership transition outside a full window (entering: %s)',
    async (entering) => {
      const storage = await createClient(connect)
      const liveQuery = new LiveQuery(storage)
      try {
        const peer = message('peer', 100)
        await storage.tx(peer)
        const window = await subscribe(
          liveQuery,
          { createdOn: { $lt: 300 } },
          { sort: { createdOn: SortingOrder.Ascending }, limit: 1, total: true }
        )
        const own = message('own', entering ? 500 : 200)
        await liveQuery.tx(optimistic(own))
        expect(window.result().total).toBe(entering ? 1 : 2)
        expect(window.result().map((doc) => doc._id)).toEqual([peer.objectId])
        const calls = window.callback.mock.calls.length
        const confirmed = confirmation(own, entering ? 200 : 500)
        await storage.tx(confirmed)
        const findAll = jest.spyOn(storage, 'findAll')
        await liveQuery.tx(confirmed)
        expect(window.result().total).toBe(entering ? 2 : 1)
        expect(window.result().map((doc) => doc._id)).toEqual([peer.objectId])
        expect(window.callback).toHaveBeenCalledTimes(calls + 1)
        expect(findAll).not.toHaveBeenCalled()
      } finally {
        await liveQuery.close()
      }
    }
  )

  it('refreshes an unknown count for a query opened while a create is pending', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const peer = message('peer', 100)
      await storage.tx(peer)
      const own = message('own', 500)
      await liveQuery.tx(optimistic(own))
      const window = await subscribe(
        liveQuery,
        { createdOn: { $lt: 300 } },
        { sort: { createdOn: SortingOrder.Ascending }, limit: 1, total: true }
      )
      const calls = window.callback.mock.calls.length
      const confirmed = confirmation(own, 200)
      await storage.tx(confirmed)
      const findAll = jest.spyOn(storage, 'findAll')
      await liveQuery.tx(confirmed)
      expect(window.result().total).toBe(2)
      expect(window.result().map((doc) => doc._id)).toEqual([peer.objectId])
      expect(window.callback).toHaveBeenCalledTimes(calls + 1)
      expect(findAll).toHaveBeenCalledTimes(1)
    } finally {
      await liveQuery.close()
    }
  })

  it('skips lookups and reads for queries a confirmed create cannot match', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const project = factory.createTxCreateDoc(test.class.TestProject, core.space.Model, {
        name: 'project',
        description: '',
        private: false,
        archived: false,
        members: [],
        prjName: 'project'
      })
      await storage.tx(project)
      const options: FindOptions<AttachedComment> = {
        sort: { createdOn: SortingOrder.Ascending },
        limit: 1,
        total: true
      }
      const withLookup = await subscribe(
        liveQuery,
        { message: 'other' },
        { ...options, lookup: { attachedTo: test.class.TestProject } }
      )
      const own = message('own', 500)
      own.attributes.attachedTo = project.objectId
      own.attributes.attachedToClass = test.class.TestProject
      await liveQuery.tx(optimistic(own))
      // Opened while the create is pending, so this query has no record of it.
      const openedLater = await subscribe(liveQuery, { message: 'other' }, options)
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const lookupCalls = withLookup.callback.mock.calls.length
      const laterCalls = openedLater.callback.mock.calls.length
      const findAll = jest.spyOn(storage, 'findAll')
      const findOne = jest.spyOn(storage, 'findOne')
      const lookupRead = jest.spyOn(liveQuery, 'findOne')
      await liveQuery.tx(confirmed)
      expect(findAll).not.toHaveBeenCalled()
      expect(findOne).not.toHaveBeenCalled()
      expect(lookupRead).not.toHaveBeenCalled()
      expect(withLookup.callback).toHaveBeenCalledTimes(lookupCalls)
      expect(openedLater.callback).toHaveBeenCalledTimes(laterCalls)
      for (const query of [withLookup, openedLater]) {
        expect(query.result()).toHaveLength(0)
        expect(query.result().total).toBe(0)
      }
    } finally {
      await liveQuery.close()
    }
  })

  it('keeps an excluded lookup create out of a full window and its total on confirmation', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const projects = ['included', 'excluded'].map((prjName) =>
        factory.createTxCreateDoc(test.class.TestProject, core.space.Model, {
          name: prjName,
          description: '',
          private: false,
          archived: false,
          members: [],
          prjName
        })
      )
      for (const project of projects) await storage.tx(project)
      const peer = message('peer', 100)
      peer.attributes.attachedTo = projects[0].objectId
      peer.attributes.attachedToClass = test.class.TestProject
      await storage.tx(peer)
      const predicate = { '$lookup.attachedTo.prjName': 'included' }
      const options: FindOptions<AttachedComment> = {
        lookup: { attachedTo: test.class.TestProject },
        sort: { createdOn: SortingOrder.Ascending },
        limit: 1,
        total: true
      }
      const query = await subscribe(liveQuery, predicate, options)
      const own = message('own', 500)
      own.attributes.attachedTo = projects[1].objectId
      own.attributes.attachedToClass = test.class.TestProject
      const calls = query.callback.mock.calls.length
      await liveQuery.tx(optimistic(own))
      expect(query.result().map((doc) => doc._id)).toEqual([peer.objectId])
      expect(query.result().total).toBe(1)
      expect(query.callback).toHaveBeenCalledTimes(calls)
      const confirmed = confirmation(own, 300)
      await storage.tx(confirmed)
      await liveQuery.tx(confirmed)
      expect(query.result().map((doc) => doc._id)).toEqual([peer.objectId])
      expect(query.result().total).toBe(1)
      expect(query.callback).toHaveBeenCalledTimes(calls)
      expect(query.result()).toEqual(await storage.findAll(test.class.TestComment, predicate, options))
    } finally {
      await liveQuery.close()
    }
  })

  it.each([undefined, false, true].flatMap((total) => ['edit', 'delete'].map((change) => ({ total, change }))))(
    'rejects an absent confirmation after $change during lookup (total: $total)',
    async ({ total, change }) => {
      const storage = await createClient(connect)
      const liveQuery = new LiveQuery(storage)
      try {
        const project = factory.createTxCreateDoc(test.class.TestProject, core.space.Model, {
          name: 'project',
          description: '',
          private: false,
          archived: false,
          members: [],
          prjName: 'included'
        })
        await storage.tx(project)
        const peer = message('included', 100)
        peer.attributes.attachedTo = project.objectId
        peer.attributes.attachedToClass = test.class.TestProject
        await storage.tx(peer)
        const predicate = { createdOn: { $lt: 200 }, message: 'included' }
        const options: FindOptions<AttachedComment> = {
          lookup: { attachedTo: test.class.TestProject },
          sort: { createdOn: SortingOrder.Ascending },
          limit: 3,
          ...(total === undefined ? {} : { total })
        }
        const query = await subscribe(liveQuery, predicate, options)
        const own = message('included', 500)
        own.attributes.attachedTo = project.objectId
        own.attributes.attachedToClass = test.class.TestProject
        await liveQuery.tx(optimistic(own))
        expect(query.result().map((doc) => doc._id)).toEqual([peer.objectId])
        const calls = query.callback.mock.calls.length
        const confirmed = confirmation(own, 100)
        await storage.tx(confirmed)
        const started = deferred<undefined>()
        const response = deferred<undefined>()
        const lookupRead = liveQuery.findOne.bind(liveQuery)
        const findOne = jest.spyOn(liveQuery, 'findOne').mockImplementationOnce(async (...args) => {
          const result = await lookupRead(...args)
          started.resolve(undefined)
          await response.promise
          return result
        })
        const findAll = jest.spyOn(storage, 'findAll')
        const confirming = liveQuery.tx(confirmed)
        await started.promise
        expect(findOne).toHaveBeenNthCalledWith(1, test.class.TestProject, { _id: project.objectId })
        const later =
          change === 'edit'
            ? factory.createTxUpdateDoc(test.class.TestComment, own.objectSpace, own.objectId, { message: 'removed' })
            : factory.createTxRemoveDoc(test.class.TestComment, own.objectSpace, own.objectId)
        later.modifiedOn = 600
        await storage.tx(later)
        await liveQuery.tx(later)
        response.resolve(undefined)
        await confirming
        expect(query.result().map((doc) => doc._id)).toEqual([peer.objectId])
        if (total === true) expect(query.result().total).toBe(1)
        expect(query.callback).toHaveBeenCalledTimes(calls)
        expect(findAll).toHaveBeenCalledWith(test.class.TestComment, predicate, options)
        expect(query.result()).toEqual(await storage.findAll(test.class.TestComment, predicate, options))
        // Check both lookup-preserving and lookup-stripped cache reads after reconciliation.
        for (const readOptions of [{ lookup: options.lookup }, undefined]) {
          const reads = findAll.mock.calls.length
          expect(await liveQuery.findOne(test.class.TestComment, { _id: peer.objectId }, readOptions)).toMatchObject({
            message: 'included',
            createdOn: 100
          })
          expect(findAll).toHaveBeenCalledTimes(reads)
          const current = await liveQuery.findOne(test.class.TestComment, { _id: own.objectId }, readOptions)
          expect(current).toEqual(await storage.findOne(test.class.TestComment, { _id: own.objectId }, readOptions))
          if (change === 'delete') expect(current).toBeUndefined()
          else expect(current).toMatchObject({ message: 'removed', createdOn: 100, modifiedOn: 600 })
        }
      } finally {
        await liveQuery.close()
      }
    }
  )

  it('does not restore an early create whose lookup finishes after its confirmation', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const project = factory.createTxCreateDoc(test.class.TestProject, core.space.Model, {
        name: 'project',
        description: '',
        private: false,
        archived: false,
        members: [],
        prjName: 'project'
      })
      await storage.tx(project)
      const predicate = { createdOn: { $gt: 300 } }
      const options: FindOptions<AttachedComment> = {
        lookup: { attachedTo: test.class.TestProject },
        sort: { createdOn: SortingOrder.Ascending },
        total: true
      }
      const query = await subscribe(liveQuery, predicate, options)
      const calls = query.callback.mock.calls.length
      const own = message('own', 500)
      own.attributes.attachedTo = project.objectId
      own.attributes.attachedToClass = test.class.TestProject
      const started = deferred<undefined>()
      const response = deferred<undefined>()
      const lookupRead = liveQuery.findOne.bind(liveQuery)
      const findOne = jest.spyOn(liveQuery, 'findOne').mockImplementationOnce(async (...args) => {
        const result = await lookupRead(...args)
        started.resolve(undefined)
        await response.promise
        return result
      })
      const early = liveQuery.tx(optimistic(own))
      await started.promise
      expect(findOne).toHaveBeenNthCalledWith(1, test.class.TestProject, { _id: project.objectId })
      // The server time moves the create out of the query before its early lookup completes.
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      await liveQuery.tx(confirmed)
      response.resolve(undefined)
      await early
      expect(query.result()).toHaveLength(0)
      expect(query.result().total).toBe(0)
      expect(query.callback).toHaveBeenCalledTimes(calls)
      expect(query.result()).toEqual(await storage.findAll(test.class.TestComment, predicate, options))
      expect((await liveQuery.findOne(test.class.TestComment, { _id: own.objectId }))?.createdOn).toBe(100)
    } finally {
      await liveQuery.close()
    }
  })

  it.each(['confirmation', 'edit'])(
    'does not apply an early create to later queries after its %s while an earlier lookup is pending',
    async (change) => {
      const storage = await createClient(connect)
      const liveQuery = new LiveQuery(storage)
      try {
        const project = factory.createTxCreateDoc(test.class.TestProject, core.space.Model, {
          name: 'project',
          description: '',
          private: false,
          archived: false,
          members: [],
          prjName: 'project'
        })
        await storage.tx(project)
        const predicate = { createdOn: { $gt: 300 } }
        const lookupOptions: FindOptions<AttachedComment> = {
          lookup: { attachedTo: test.class.TestProject },
          sort: { createdOn: SortingOrder.Ascending },
          total: true
        }
        const plainOptions: FindOptions<AttachedComment> = { sort: { createdOn: SortingOrder.Ascending }, total: true }
        // Registration order: the early create waits for the first query's lookup before the second query.
        const withLookup = await subscribe(liveQuery, predicate, lookupOptions)
        const plain = await subscribe(liveQuery, predicate, plainOptions)
        const calls = [withLookup, plain].map((query) => query.callback.mock.calls.length)
        const own = message('own', 500)
        own.attributes.attachedTo = project.objectId
        own.attributes.attachedToClass = test.class.TestProject
        const started = deferred<undefined>()
        const response = deferred<undefined>()
        const lookupRead = liveQuery.findOne.bind(liveQuery)
        const findOne = jest.spyOn(liveQuery, 'findOne').mockImplementationOnce(async (...args) => {
          const result = await lookupRead(...args)
          started.resolve(undefined)
          await response.promise
          return result
        })
        const early = liveQuery.tx(optimistic(own))
        await started.promise
        expect(findOne).toHaveBeenNthCalledWith(1, test.class.TestProject, { _id: project.objectId })
        // The server time moves the create out of both queries.
        const confirmed = confirmation(own, 100)
        await storage.tx(confirmed)
        if (change === 'confirmation') {
          await liveQuery.tx(confirmed)
        } else {
          const edit = factory.createTxUpdateDoc(test.class.TestComment, own.objectSpace, own.objectId, {
            message: 'edited'
          })
          edit.modifiedOn = 600
          await storage.tx(edit)
          await liveQuery.tx(edit)
        }
        response.resolve(undefined)
        await early
        for (const query of [withLookup, plain]) {
          expect(query.result()).toHaveLength(0)
          expect(query.result().total).toBe(0)
        }
        if (change === 'edit') {
          await liveQuery.tx(confirmed)
        }
        expect(withLookup.result()).toEqual(await storage.findAll(test.class.TestComment, predicate, lookupOptions))
        expect(plain.result()).toEqual(await storage.findAll(test.class.TestComment, predicate, plainOptions))
        expect(withLookup.callback).toHaveBeenCalledTimes(calls[0])
        expect(plain.callback).toHaveBeenCalledTimes(calls[1])
      } finally {
        await liveQuery.close()
      }
    }
  )

  it.each(
    [undefined, false, true].flatMap((total) =>
      [undefined, 3].flatMap((limit) => ['edit', 'delete'].map((change) => ({ total, limit, change })))
    )
  )(
    'does not resurrect a pending create after $change (total: $total, limit: $limit)',
    async ({ total, limit, change }) => {
      const storage = await createClient(connect)
      const liveQuery = new LiveQuery(storage)
      try {
        const peer = message('included', 100)
        await storage.tx(peer)
        const options: FindOptions<AttachedComment> = {
          sort: { createdOn: SortingOrder.Ascending },
          ...(total === undefined ? {} : { total }),
          ...(limit === undefined ? {} : { limit })
        }
        const query = await subscribe(liveQuery, { message: 'included' }, options)
        const own = message('included', 200)
        await liveQuery.tx(optimistic(own))
        const confirmed = confirmation(own, 500)
        await storage.tx(confirmed)
        const later =
          change === 'edit'
            ? factory.createTxUpdateDoc(test.class.TestComment, own.objectSpace, own.objectId, { message: 'removed' })
            : factory.createTxRemoveDoc(test.class.TestComment, own.objectSpace, own.objectId)
        later.modifiedOn = 600
        await storage.tx(later)
        await liveQuery.tx(later)
        if (total === true) expect(query.result().total).toBe(1)
        expect(query.result().map((doc) => doc._id)).toEqual([peer.objectId])
        const calls = query.callback.mock.calls.length
        const findAll = jest.spyOn(storage, 'findAll')
        await liveQuery.tx(confirmed)
        if (total === true) expect(query.result().total).toBe(1)
        expect(query.result().map((doc) => doc._id)).toEqual([peer.objectId])
        expect(query.callback).toHaveBeenCalledTimes(calls)
        expect(findAll).toHaveBeenCalledTimes(1)
        expect(query.result()).toEqual(await storage.findAll(test.class.TestComment, { message: 'included' }, options))
      } finally {
        await liveQuery.close()
      }
    }
  )

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true]
  ])('retries stale refreshes (shared: %s, membership changes: %s)', async (shared, leaves) => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const other = message('peer', 200)
      await storage.tx(other)
      await storage.tx(message('peer', 300))
      await storage.tx(message('peer', 400))
      const predicate: DocumentQuery<AttachedComment> = leaves
        ? { modifiedOn: { $lt: 550 } }
        : { createdOn: { $lt: 650 } }
      const all = shared ? await subscribe(liveQuery, predicate) : undefined
      const options = { sort: { createdOn: SortingOrder.Ascending }, limit: 2, total: true }
      const window = await subscribe(liveQuery, predicate, options)
      const own = message('own', 50)
      await liveQuery.tx(optimistic(own))
      const confirmed = confirmation(own, 500)
      await storage.tx(confirmed)
      const stale = await storage.findAll(test.class.TestComment, predicate, options)
      const started = deferred<undefined>()
      const response = deferred<typeof stale>()
      const findAll = jest.spyOn(storage, 'findAll').mockImplementationOnce(async () => {
        started.resolve(undefined)
        return await response.promise
      })
      const confirming = liveQuery.tx(confirmed)
      await started.promise
      const update = factory.createTxUpdateDoc(test.class.TestComment, other.objectSpace, other.objectId, {
        message: 'newer edit'
      })
      update.modifiedOn = 600
      await storage.tx(update)
      await liveQuery.tx(update)
      const watchers = all === undefined ? [window] : [all, window]
      for (const query of watchers) query.callback.mockClear()
      response.resolve(stale)
      await confirming
      // No callback from either query may publish the held revision or stale membership/total.
      for (const query of watchers) {
        const results = [
          query.result(),
          ...query.callback.mock.calls.map(([docs]) => docs as FindResult<AttachedComment>)
        ]
        for (const docs of results) {
          expect(docs.total).toBe(leaves ? 3 : 4)
          const peer = docs.find((doc) => doc._id === other.objectId)
          if (leaves) expect(peer).toBeUndefined()
          else expect(peer).toMatchObject({ modifiedOn: 600, message: 'newer edit' })
        }
      }
      const reloaded = await storage.findAll(test.class.TestComment, predicate, options)
      expect(window.result()).toEqual(reloaded)
      expect(findAll.mock.calls.length).toBeGreaterThanOrEqual(2)
      const reads = findAll.mock.calls.length
      expect(await liveQuery.findOne(test.class.TestComment, { _id: other.objectId })).toMatchObject({
        modifiedOn: 600,
        message: 'newer edit'
      })
      if (!leaves) expect(findAll).toHaveBeenCalledTimes(reads)
    } finally {
      await liveQuery.close()
    }
  })

  it('bounds confirmation refresh reads while transactions keep arriving', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const own = message('own', 500)
      await liveQuery.tx(optimistic(own))
      // Opened while the create is pending, so its confirmation needs an authoritative refresh.
      const query = await subscribe(liveQuery)
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const read = storage.findAll.bind(storage)
      let reads = 0
      const findAll = jest.spyOn(storage, 'findAll').mockImplementation(async (...args) => {
        reads++
        // Another transaction crosses every read, as in a busy workspace. The cap only keeps an
        // unbounded retry from hanging the test; the read count below then reports it.
        if (reads <= 10) await liveQuery.tx(unrelatedCreate())
        return await read(...args)
      })
      await liveQuery.tx(confirmed)
      expect(reads).toBe(LiveQuery.CONFIRMATION_REFRESH_ATTEMPTS)
      findAll.mockRestore()
      const sort = { createdOn: SortingOrder.Ascending }
      expect(query.result()).toEqual(await storage.findAll(test.class.TestComment, {}, { sort, total: true }))
      expect(query.result()[0]).toMatchObject({ createdOn: 100 })
      expect(query.result().total).toBe(1)
    } finally {
      await liveQuery.close()
    }
  })

  it('reads once for ordinary refreshes while transactions keep arriving', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      await storage.tx(message('peer', 100))
      const query = await subscribe(liveQuery)
      const read = storage.findAll.bind(storage)
      let reads = 0
      jest.spyOn(storage, 'findAll').mockImplementation(async (...args) => {
        reads++
        if (reads <= 10) await liveQuery.tx(unrelatedCreate())
        return await read(...args)
      })
      await liveQuery.refreshConnect(false)
      expect(reads).toBe(1)
      expect(query.result()).toHaveLength(1)
      expect(query.result().total).toBe(1)
    } finally {
      await liveQuery.close()
    }
  })

  it.each([false, true])('retries an uncertain single-document read after an edit (shared: %s)', async (shared) => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const own = message('original', 100)
      await storage.tx(own)
      const first = await subscribe(liveQuery)
      const second = shared ? await subscribe(liveQuery, { _id: own.objectId }) : undefined
      const stale = await storage.findOne(test.class.TestComment, { _id: own.objectId })
      const started = deferred<undefined>()
      const response = deferred<typeof stale>()
      jest.spyOn(storage, 'findOne').mockImplementationOnce(async () => {
        started.resolve(undefined)
        return await response.promise
      })
      const confirming = liveQuery.tx(confirmation(own, 100))
      await started.promise
      const update = factory.createTxUpdateDoc(test.class.TestComment, own.objectSpace, own.objectId, {
        message: 'newer edit'
      })
      update.modifiedOn = 600
      await storage.tx(update)
      await liveQuery.tx(update)
      const watchers = second === undefined ? [first] : [first, second]
      for (const query of watchers) query.callback.mockClear()
      response.resolve(stale)
      await confirming
      for (const query of watchers) {
        const results = [
          query.result(),
          ...query.callback.mock.calls.map(([docs]) => docs as FindResult<AttachedComment>)
        ]
        for (const docs of results) {
          expect(docs).toHaveLength(1)
          expect(docs.total).toBe(1)
          expect(docs[0]).toMatchObject({ modifiedOn: 600, message: 'newer edit' })
        }
      }
      const findAll = jest.spyOn(storage, 'findAll')
      expect(await liveQuery.findOne(test.class.TestComment, { _id: own.objectId })).toMatchObject({
        modifiedOn: 600,
        message: 'newer edit'
      })
      expect(findAll).not.toHaveBeenCalled()
    } finally {
      await liveQuery.close()
    }
  })

  it('preserves a later edit when a create confirmation arrives', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const query = await subscribe(liveQuery)
      const own = message('original', 500)
      await liveQuery.tx(optimistic(own))
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const update = factory.createTxUpdateDoc(test.class.TestComment, own.objectSpace, own.objectId, {
        message: 'edited'
      })
      update.modifiedOn = 200
      await storage.tx(update)
      await liveQuery.tx(update)
      await liveQuery.tx(confirmed)
      expect(query.result()[0]).toMatchObject({ createdOn: 100, modifiedOn: 200, message: 'edited' })
      expect(query.result().total).toBe(1)
    } finally {
      await liveQuery.close()
    }
  })

  it.each([false, true])('handles an equal-timestamp counter after confirmation (loaded: %s)', async (loaded) => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const tx = message('own', 500)
      const own: TxCreateDoc<CountedComment> = { ...tx, attributes: { ...tx.attributes, count: 0 } }
      const optimisticQuery = loaded ? undefined : await subscribe(liveQuery)
      if (!loaded) await liveQuery.tx(optimistic(own))
      const confirmed = confirmation(own, 100)
      await storage.tx(confirmed)
      const increment = factory.createTxUpdateDoc<CountedComment>(
        test.class.TestComment,
        own.objectSpace,
        own.objectId,
        { $inc: { count: 1 } },
        false,
        100
      )
      await storage.tx(increment)
      const query = optimisticQuery ?? (await subscribe(liveQuery))
      await liveQuery.tx(confirmed)
      await liveQuery.tx(increment)
      expect(query.result()[0]).toMatchObject({ createdOn: 100, modifiedOn: 100, count: 1 })
    } finally {
      await liveQuery.close()
    }
  })
})
