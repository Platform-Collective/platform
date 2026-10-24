// SPDX-License-Identifier: EPL-2.0

import core, {
  createClient,
  SortingOrder,
  TxFactory,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type TxCreateDoc
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

async function subscribe (
  liveQuery: LiveQuery,
  query: DocumentQuery<AttachedComment> = {},
  options: FindOptions<AttachedComment> = { sort: { createdOn: SortingOrder.Ascending }, total: true }
): Promise<{ result: () => FindResult<AttachedComment>, callback: jest.Mock }> {
  let last: FindResult<AttachedComment>
  const callback = jest.fn((res: FindResult<AttachedComment>) => {
    last = res
  })
  await new Promise<void>((resolve) => {
    liveQuery.query(
      test.class.TestComment,
      query,
      (res) => {
        callback(res)
        resolve()
      },
      options
    )
  })
  return { result: () => last, callback }
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
      await sender.tx(own)
      await peer.tx({ ...other, createdOn: localTime + 10, modifiedOn: localTime + 10 })
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
      await liveQuery.tx(own)
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

  it('does not refresh unrelated limited queries with totals', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const unrelated = await subscribe(liveQuery, { message: 'unrelated' }, { limit: 1, total: true })
      const own = message('own', 500)
      await liveQuery.tx(own)
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
      await liveQuery.tx(own)
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
        await liveQuery.tx(own)
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
      await liveQuery.tx(own)
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
    'does not refresh an absent doc that stays outside a full window (%s, sort %i, client %i, server %i, total %s)',
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
        await liveQuery.tx(own)
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
      await liveQuery.tx(own)
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
      await liveQuery.tx(own)
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

  it('preserves a later edit when a create confirmation arrives', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    try {
      const query = await subscribe(liveQuery)
      const own = message('original', 500)
      await liveQuery.tx(own)
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
      if (!loaded) await liveQuery.tx(own)
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
