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

// $inc-only txes (counters) must not trigger round trips for unrelated queries; an
// equal-timestamp $inc (sharing the parent's timestamp) applies locally, not re-fetched.

import core, {
  createClient,
  TxFactory,
  TxOperations,
  type Client,
  type Doc,
  type Ref,
  type Space,
  type Tx
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'

interface CounterSpace extends Space {
  rate?: number
  hits?: number
}

async function getCountingClient (): Promise<{
  liveQuery: LiveQuery
  factory: TxOperations
  storage: Client
  txFactory: TxFactory
  serverCalls: () => number
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
    serverCalls: () => calls
  }
}

async function createSpace (factory: TxOperations, priv: boolean, extra?: Partial<CounterSpace>): Promise<Ref<Space>> {
  return await factory.createDoc(core.class.Space, core.space.Model, {
    name: 'counter-space',
    description: '',
    private: priv,
    members: [],
    archived: false,
    ...(extra ?? {})
  })
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

// Subscribe and resolve once the first callback fires; returns live handles to the result.
async function subscribe<T extends Doc> (
  liveQuery: LiveQuery,
  _class: Ref<any>,
  query: any,
  options?: any
): Promise<{ last: () => T[], updates: () => number }> {
  let last: T[] = []
  let updates = 0
  await new Promise((resolve) => {
    liveQuery.query<T>(
      _class,
      query,
      (res) => {
        last = res
        updates++
        resolve(null)
      },
      options
    )
  })
  return { last: () => last, updates: () => updates }
}

describe('$inc match handling — doc outside the result (matchQuery)', () => {
  it('does not hit the server for $inc on a field the query ignores', async () => {
    const { liveQuery, factory, serverCalls } = await getCountingClient()
    const outsideId = await createSpace(factory, true)
    const q = await subscribe<Space>(liveQuery, core.class.Space, { private: false })
    const callsBefore = serverCalls()
    const updatesBefore = q.updates()

    for (let i = 0; i < 5; i++) {
      await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, outsideId, { $inc: { rate: 1 } })
    }
    await settle()

    expect(serverCalls()).toBe(callsBefore)
    expect(q.updates()).toBe(updatesBefore)
  })

  it('checks the server when the query filters by the incremented field', async () => {
    const { liveQuery, factory } = await getCountingClient()
    const id = await createSpace(factory, true, { rate: 0 })
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { rate: 2 } as any)
    expect(q.last().length).toBe(0)

    await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, id, { $inc: { rate: 2 } })
    await settle()

    expect(q.last().length).toBe(1) // rate reached 2 -> doc enters the result
  })

  it('checks the server when the query sorts by the incremented field', async () => {
    const { liveQuery, factory, serverCalls } = await getCountingClient()
    const outsideId = await createSpace(factory, true)
    await subscribe<CounterSpace>(liveQuery, core.class.Space, { private: false }, { sort: { rate: 1 } as any })
    const callsBefore = serverCalls()

    await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, outsideId, { $inc: { rate: 1 } })
    await settle()

    expect(serverCalls()).toBeGreaterThan(callsBefore)
  })

  it('ignores a multi-field $inc when none are referenced by the query', async () => {
    const { liveQuery, factory, serverCalls } = await getCountingClient()
    const outsideId = await createSpace(factory, true)
    await subscribe<Space>(liveQuery, core.class.Space, { private: false })
    const callsBefore = serverCalls()

    await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, outsideId, {
      $inc: { rate: 1, hits: 3 }
    })
    await settle()

    expect(serverCalls()).toBe(callsBefore)
  })

  it('checks the server when a multi-field $inc touches the query', async () => {
    const { liveQuery, factory, serverCalls } = await getCountingClient()
    const outsideId = await createSpace(factory, true, { hits: 0 })
    await subscribe<CounterSpace>(liveQuery, core.class.Space, { private: false, hits: 3 } as any)
    const callsBefore = serverCalls()

    await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, outsideId, {
      $inc: { rate: 1, hits: 3 }
    })
    await settle()

    expect(serverCalls()).toBeGreaterThan(callsBefore)
  })
})

describe('$inc match handling — doc inside the result (handleDocUpdate)', () => {
  it('applies a newer-timestamp $inc locally without a server call', async () => {
    const { liveQuery, factory, serverCalls } = await getCountingClient()
    const insideId = await createSpace(factory, false, { rate: 1 })
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { _id: insideId } as any)
    expect(q.last()[0]?.rate).toBe(1)
    const callsBefore = serverCalls()

    await new Promise((resolve) => setTimeout(resolve, 5))
    await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, insideId, { $inc: { rate: 4 } })
    await settle()

    expect(q.last()[0]?.rate).toBe(5)
    expect(serverCalls()).toBe(callsBefore)
  })

  it('applies an EQUAL-timestamp derived $inc-only tx locally to a tx-created doc without a server call', async () => {
    const { liveQuery, storage, txFactory, serverCalls } = await getCountingClient()
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { name: 'counter-space' })
    const callsBefore = serverCalls()
    const sameTs = Date.now()

    // 1. Parent creation tx creates doc in LiveQuery
    const createTx = txFactory.createTxCreateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      {
        name: 'counter-space',
        description: '',
        private: false,
        members: [],
        archived: false,
        rate: 10
      },
      undefined,
      sameTs
    )
    await storage.tx(createTx)
    await settle()

    expect(q.last()[0]?.rate).toBe(10)
    expect(serverCalls()).toBe(callsBefore)

    // 2. Derived $inc tx with equal timestamp arrives
    const incTx = txFactory.createTxUpdateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      createTx.objectId,
      { $inc: { rate: 5 } },
      false,
      sameTs
    )
    await storage.tx(incTx)
    await settle()

    // Locally applied from 10 to 15 with 0 server calls!
    expect(q.last()[0]?.rate).toBe(15)
    expect(serverCalls()).toBe(callsBefore)
  })

  it('re-fetches an EQUAL-timestamp NON-$inc update (cannot apply locally)', async () => {
    const { liveQuery, factory, storage, txFactory, serverCalls } = await getCountingClient()
    const insideId = await createSpace(factory, false, { rate: 1 })
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { _id: insideId } as any)
    const sameTs = q.last()[0].modifiedOn
    const callsBefore = serverCalls()

    const tx = txFactory.createTxUpdateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      insideId,
      { name: 'renamed' },
      false,
      sameTs
    )
    await storage.tx(tx)
    await settle()

    expect(serverCalls()).toBeGreaterThan(callsBefore) // equal-ts non-$inc -> getCurrentDoc
  })

  it('re-fetches an EQUAL-timestamp mixed ($inc + field) update', async () => {
    const { liveQuery, factory, storage, txFactory, serverCalls } = await getCountingClient()
    const insideId = await createSpace(factory, false, { rate: 1 })
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { _id: insideId } as any)
    const sameTs = q.last()[0].modifiedOn
    const callsBefore = serverCalls()

    const tx = txFactory.createTxUpdateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      insideId,
      { name: 'x', $inc: { rate: 1 } },
      false,
      sameTs
    )
    await storage.tx(tx)
    await settle()

    expect(serverCalls()).toBeGreaterThan(callsBefore) // not $inc-only -> not applied locally
  })

  it('accumulates consecutive $inc locally', async () => {
    const { liveQuery, factory, serverCalls } = await getCountingClient()
    const insideId = await createSpace(factory, false, { rate: 0 })
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { _id: insideId } as any)
    const callsBefore = serverCalls()

    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2))
      await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, insideId, { $inc: { rate: 2 } })
    }
    await settle()

    expect(q.last()[0]?.rate).toBe(20)
    expect(serverCalls()).toBe(callsBefore)
  })

  it('applies a negative $inc locally', async () => {
    const { liveQuery, factory, serverCalls } = await getCountingClient()
    const insideId = await createSpace(factory, false, { rate: 5 })
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { _id: insideId } as any)
    const callsBefore = serverCalls()

    await new Promise((resolve) => setTimeout(resolve, 5))
    await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, insideId, { $inc: { rate: -3 } })
    await settle()

    expect(q.last()[0]?.rate).toBe(2)
    expect(serverCalls()).toBe(callsBefore)
  })

  it('applies $inc to a field that started undefined', async () => {
    const { liveQuery, factory, serverCalls } = await getCountingClient()
    const insideId = await createSpace(factory, false) // no rate
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { _id: insideId } as any)
    expect(q.last()[0]?.rate).toBeUndefined()
    const callsBefore = serverCalls()

    await new Promise((resolve) => setTimeout(resolve, 5))
    await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, insideId, { $inc: { rate: 7 } })
    await settle()

    expect(q.last()[0]?.rate).toBe(7)
    expect(serverCalls()).toBe(callsBefore)
  })

  it('re-evaluates a mixed update ($inc plus a matching field) as before', async () => {
    const { liveQuery, factory } = await getCountingClient()
    const outsideId = await createSpace(factory, true, { rate: 0 })
    const q = await subscribe<Space>(liveQuery, core.class.Space, { private: false })
    const before = q.last().length

    await factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, outsideId, {
      private: false,
      $inc: { rate: 1 }
    })
    await settle()

    expect(q.last().length).toBe(before + 1) // private:false makes it match; $inc rides along
  })
})

// Equal-timestamp non-$inc sends every subscriber through getCurrentDoc (per-batch docCache);
// each needs its own copy, or one $inc per subscriber drifts the counter.
describe('$inc on a doc shared by several queries', () => {
  async function shared (
    count: number,
    extra?: Partial<CounterSpace>
  ): Promise<{
    ctx: Awaited<ReturnType<typeof getCountingClient>>
    id: Ref<CounterSpace>
    qs: Array<{ last: () => CounterSpace[] }>
  }> {
    const ctx = await getCountingClient()
    const id = (await createSpace(ctx.factory, false, {
      rate: 0,
      name: 'shared',
      ...extra
    })) as Ref<CounterSpace>
    // Distinct queries that all keep matching, same class and options -> one docCache entry.
    const variants = [{}, { private: false }, { archived: false }, { members: [] }]
    const qs: Array<{ last: () => CounterSpace[] }> = []
    for (let i = 0; i < count; i++) {
      qs.push(await subscribe<CounterSpace>(ctx.liveQuery, core.class.Space, { name: 'shared', ...variants[i] } as any))
    }
    await ctx.storage.tx(
      ctx.txFactory.createTxUpdateDoc<CounterSpace>(
        core.class.Space,
        core.space.Model,
        id,
        { description: 'forces getCurrentDoc' },
        false,
        qs[0].last()[0].modifiedOn
      )
    )
    await settle()
    return { ctx, id, qs }
  }

  it('applies a single $inc once for two subscribers', async () => {
    const { ctx, id, qs } = await shared(2)

    await ctx.factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, id, { $inc: { rate: 1 } })
    await settle()

    expect(qs.map((q) => q.last()[0].rate)).toEqual([1, 1])
  })

  it('does not scale the drift with the number of subscribers', async () => {
    const { ctx, id, qs } = await shared(3)

    await ctx.factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, id, { $inc: { rate: 1 } })
    await settle()

    expect(qs.map((q) => q.last()[0].rate)).toEqual([1, 1, 1])
  })

  it('keeps consecutive $inc txes in sync with the server', async () => {
    const { ctx, id, qs } = await shared(2)

    for (let i = 0; i < 5; i++) {
      await ctx.factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, id, { $inc: { rate: 1 } })
    }
    await settle()

    const server = await ctx.storage.findOne<CounterSpace>(core.class.Space, { _id: id })
    expect(server?.rate).toBe(5)
    expect(qs.map((q) => q.last()[0].rate)).toEqual([5, 5])
  })

  it('applies equal-timestamp $inc txes from one batch exactly once', async () => {
    // Two attachments added by one operation: the server derives two counter txes that
    // share the parent timestamp, and both arrive in a single tx batch.
    const { ctx, id, qs } = await shared(2)
    const ts = qs[0].last()[0].modifiedOn + 1
    const inc = (): any =>
      ctx.txFactory.createTxUpdateDoc<CounterSpace>(
        core.class.Space,
        core.space.Model,
        id,
        { $inc: { rate: 1 } },
        false,
        ts
      )

    await ctx.storage.tx(inc())
    await ctx.storage.tx(inc())
    await settle()

    expect(qs.map((q) => q.last()[0].rate)).toEqual([2, 2])
  })

  it('applies a negative $inc once', async () => {
    const { ctx, id, qs } = await shared(2, { rate: 3 })

    await ctx.factory.updateDoc<CounterSpace>(core.class.Space, core.space.Model, id, { $inc: { rate: -1 } })
    await settle()

    expect(qs.map((q) => q.last()[0].rate)).toEqual([2, 2])
  })

  it('does not double-increment counter when doc was loaded from server DB with equal timestamp', async () => {
    const { liveQuery, factory, txFactory } = await getCountingClient()
    const id = await createSpace(factory, false, { rate: 2 })
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { _id: id } as any)
    const sameTs = q.last()[0].modifiedOn

    // Server already has rate=2 in DB. Broadcast arrives with two equal-ts $inc: 1 txes.
    const incTx = (): any =>
      txFactory.createTxUpdateDoc<CounterSpace>(
        core.class.Space,
        core.space.Model,
        id,
        { $inc: { rate: 1 } },
        false,
        sameTs
      )

    // Notify LiveQuery of broadcast txes
    await liveQuery.tx(incTx(), incTx())
    await settle()

    // Counter must stay 2 (from DB state), not double to 4
    expect(q.last()[0]?.rate).toBe(2)
  })
})

describe('duplicate delivery of one $inc tx', () => {
  it('ignores a re-delivered $inc tx on a doc that entered the result via TxCreateDoc', async () => {
    const { liveQuery, storage, txFactory } = await getCountingClient()
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { name: 'dup-space' })
    const ts = Date.now()

    const createTx = txFactory.createTxCreateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      { name: 'dup-space', description: '', private: false, members: [], archived: false, rate: 0 },
      undefined,
      ts
    )
    await storage.tx(createTx)
    await settle()

    const incTx = txFactory.createTxUpdateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      createTx.objectId,
      { $inc: { rate: 1 } },
      false,
      ts
    )
    await storage.tx(incTx)
    await settle()
    expect(q.last()[0]?.rate).toBe(1)

    // The very same tx arrives again (reconnect replay / double notify).
    await liveQuery.tx(incTx)
    await settle()

    const server = await storage.findOne<CounterSpace>(core.class.Space, { _id: createTx.objectId })
    expect(server?.rate).toBe(1)
    expect(q.last()[0]?.rate).toBe(1)
  })

  // The limit of client-side dedup: a rebuilt derived tx carries a fresh `_id` (`tx.ts:542`) and
  // looks exactly like the legitimate batch above - only the server knows which it applied.
  it('cannot tell a rebuilt duplicate $inc from a second real one', async () => {
    const { liveQuery, factory, storage, txFactory } = await getCountingClient()
    const id = (await createSpace(factory, false, { rate: 0, name: 'rebuilt' })) as Ref<CounterSpace>
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { name: 'rebuilt' })
    // Past the doc's own timestamp, or `isLoadedAtModifiedOn` answers instead of the dedup.
    const ts = q.last()[0].modifiedOn + 1000

    const inc = (): any =>
      txFactory.createTxUpdateDoc<CounterSpace>(
        core.class.Space,
        core.space.Model,
        id,
        { $inc: { rate: 1 } },
        false,
        ts
      )

    // The server applies the increment once; the client is told about it twice.
    await storage.tx(inc())
    await settle()
    await liveQuery.tx(inc())
    await settle()

    expect((await storage.findOne<CounterSpace>(core.class.Space, { _id: id }))?.rate).toBe(1)
    expect(q.last()[0]?.rate).toBe(2)
  })

  it('ignores a re-delivered $inc tx that was first applied by timestamp', async () => {
    // Real shape of a comment counter: issue predates comment, so delivery takes `modifiedOn
    // <`; doc sits at tx.modifiedOn, repeat looks like equal-timestamp $inc.
    const { liveQuery, storage, txFactory } = await getCountingClient()
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { name: 'dup-later' })

    const createTx = txFactory.createTxCreateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      { name: 'dup-later', description: '', private: false, members: [], archived: false, rate: 0 },
      undefined,
      Date.now() - 1000
    )
    await storage.tx(createTx)
    await settle()

    const incTx = txFactory.createTxUpdateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      createTx.objectId,
      { $inc: { rate: 1 } },
      false,
      Date.now()
    )
    await storage.tx(incTx)
    await settle()
    expect(q.last()[0]?.rate).toBe(1)

    await liveQuery.tx(incTx)
    await settle()

    const server = await storage.findOne<CounterSpace>(core.class.Space, { _id: createTx.objectId })
    expect(server?.rate).toBe(1)
    expect(q.last()[0]?.rate).toBe(1)
  })
})

// A doc re-read by getCurrentDoc is marked as loaded at its server timestamp, so an
// equal-timestamp $inc on top of a value that already contains it is re-fetched, not applied.
describe('$inc after the doc was refreshed from the server mid-flight', () => {
  it('keeps the client counter equal to the server one', async () => {
    const { liveQuery, factory, storage, txFactory } = await getCountingClient()
    const id = (await createSpace(factory, false, { rate: 0, name: 'refreshed' })) as Ref<CounterSpace>
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { name: 'refreshed' })
    const ts = q.last()[0].modifiedOn

    // Both land on the server at the doc's current timestamp, the way a parent tx and its derived
    // counter tx do. The server ends up at rate 1.
    await storage.tx(
      txFactory.createTxUpdateDoc<CounterSpace>(
        core.class.Space,
        core.space.Model,
        id,
        { $inc: { rate: 1 } },
        false,
        ts
      )
    )
    await settle()
    // Equal-timestamp non-$inc update: sends the query through getCurrentDoc, which re-reads the
    // doc from the server - rate is already 1 there.
    await storage.tx(
      txFactory.createTxUpdateDoc<CounterSpace>(
        core.class.Space,
        core.space.Model,
        id,
        { description: 'forces getCurrentDoc' },
        false,
        ts
      )
    )
    await settle()

    // Re-deliver the counter tx, as a reconnect replay would.
    await liveQuery.tx(
      txFactory.createTxUpdateDoc<CounterSpace>(
        core.class.Space,
        core.space.Model,
        id,
        { $inc: { rate: 1 } },
        false,
        ts
      )
    )
    await settle()

    const server = await factory.findOne<CounterSpace>(core.class.Space, { _id: id })
    expect(q.last()[0].rate).toBe(server?.rate)
  })
})

// The server broadcasts txes of one doc out of commit order. An older tx sends the query to the
// server, the copy it gets back already holds the next $inc, and that $inc must not apply again.
describe('$inc after an out-of-order tx refetched the doc', () => {
  async function writeSilently (storage: Client, txes: Tx[]): Promise<void> {
    const notify = storage.notify
    storage.notify = () => {}
    for (const tx of txes) await storage.tx(tx)
    storage.notify = notify
  }

  it('does not apply an $inc the refetched doc already holds (getCurrentDoc)', async () => {
    const { liveQuery, factory, storage, txFactory } = await getCountingClient()
    const id = (await createSpace(factory, false, { rate: 1, name: 'out-of-order' })) as Ref<CounterSpace>
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { _id: id } as any)
    const t0 = q.last()[0].modifiedOn
    const inc = (field: string, ts: number): Tx =>
      txFactory.createTxUpdateDoc<CounterSpace>(
        core.class.Space,
        core.space.Model,
        id,
        { $inc: { [field]: 1 } },
        false,
        ts
      )
    const stale = inc('hits', t0 + 10)
    const mid = inc('misses', t0 + 20)
    const rate = inc('rate', t0 + 30)
    await writeSilently(storage, [stale, mid, rate])

    await liveQuery.tx(mid)
    await liveQuery.tx(stale)
    await liveQuery.tx(rate)
    await settle()

    expect((await storage.findOne<CounterSpace>(core.class.Space, { _id: id }))?.rate).toBe(2)
    expect(q.last()[0].rate).toBe(2)
  })

  it('does not apply an $inc the doc already held when it entered the result (matchQuery)', async () => {
    const { liveQuery, factory, storage, txFactory } = await getCountingClient()
    const id = (await createSpace(factory, false, { rate: 1, name: 'outside' })) as Ref<CounterSpace>
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { name: 'inside' })
    expect(q.last().length).toBe(0)
    const t0 = (await storage.findOne<CounterSpace>(core.class.Space, { _id: id }))?.modifiedOn ?? 0
    const rename = txFactory.createTxUpdateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      id,
      { name: 'inside' },
      false,
      t0 + 10
    )
    const rate = txFactory.createTxUpdateDoc<CounterSpace>(
      core.class.Space,
      core.space.Model,
      id,
      { $inc: { rate: 1 } },
      false,
      t0 + 20
    )
    await writeSilently(storage, [rename, rate])

    await liveQuery.tx(rename)
    await liveQuery.tx(rate)
    await settle()

    expect((await storage.findOne<CounterSpace>(core.class.Space, { _id: id }))?.rate).toBe(2)
    expect(q.last()[0]?.rate).toBe(2)
  })

  it('still applies an equal-timestamp $inc committed after the refetch', async () => {
    const { liveQuery, factory, storage, txFactory } = await getCountingClient()
    const id = (await createSpace(factory, false, { rate: 1, name: 'late-inc' })) as Ref<CounterSpace>
    const q = await subscribe<CounterSpace>(liveQuery, core.class.Space, { _id: id } as any)
    const t0 = q.last()[0].modifiedOn
    const update = (ops: any, ts: number): Tx =>
      txFactory.createTxUpdateDoc<CounterSpace>(core.class.Space, core.space.Model, id, ops, false, ts)
    const stale = update({ description: 'stale' }, t0 + 10)
    const parent = update({ description: 'parent' }, t0 + 20)
    const derived = update({ $inc: { rate: 1 } }, t0 + 20)
    await writeSilently(storage, [stale, parent])

    await liveQuery.tx(parent)
    await liveQuery.tx(stale) // refetch: the copy is at t0 + 20 but has no $inc yet
    await settle()
    await writeSilently(storage, [derived])
    await liveQuery.tx(derived)
    await settle()

    expect((await storage.findOne<CounterSpace>(core.class.Space, { _id: id }))?.rate).toBe(2)
    expect(q.last()[0].rate).toBe(2)
  })
})
