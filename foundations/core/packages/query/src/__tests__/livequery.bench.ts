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

// Measurements, not thresholds - laptop numbers under ts-jest aren't comparable across
// machines. Run `pnpm bench`; in-memory storage means every figure is LiveQuery's own cost.

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

interface Bench {
  liveQuery: LiveQuery
  factory: TxOperations
  storage: Client
  serverCalls: () => number
}

async function getBench (): Promise<Bench> {
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
  return { liveQuery, factory: new TxOperations(storage, core.account.System), storage, serverCalls: () => calls }
}

async function createProjects (factory: TxOperations, count: number, prefix: string): Promise<Array<Ref<TestProject>>> {
  const ids: Array<Ref<TestProject>> = []
  for (let i = 0; i < count; i++) {
    ids.push(
      await factory.createDoc(test.class.TestProject, core.space.Model, {
        name: `${prefix}-${i}`,
        description: '',
        private: false,
        members: [],
        archived: false,
        prjName: `${prefix}-${String(i).padStart(5, '0')}`
      })
    )
  }
  return ids
}

async function subscribe<T extends Doc> (
  liveQuery: LiveQuery,
  _class: Ref<Class<T>>,
  query: any,
  options?: any,
  onResult?: (res: T[]) => void
): Promise<() => void> {
  let unsubscribe: () => void = () => {}
  await new Promise((resolve) => {
    let first = true
    unsubscribe = liveQuery.query<T>(
      _class,
      query,
      (res) => {
        onResult?.(res)
        if (first) {
          first = false
          resolve(null)
        }
      },
      options
    )
  })
  return unsubscribe
}

const results: Array<{ what: string, n: number, ms: number }> = []

function record (what: string, n: number, ms: number): void {
  results.push({ what, n, ms })
}

// Resolves once `predicate` holds, so a benchmark measures work done rather than a fixed sleep.
async function until (predicate: () => boolean, limitMs = 30000): Promise<void> {
  const start = performance.now()
  while (!predicate()) {
    if (performance.now() - start > limitMs) throw new Error('bench timed out waiting for updates')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

afterAll(() => {
  const head = ['case', 'n', 'total ms', 'us/op', 'ops/sec']
  const rows = results.map((r) => [
    r.what,
    String(r.n),
    r.ms.toFixed(1),
    ((r.ms * 1000) / r.n).toFixed(1),
    Math.round(r.n / (r.ms / 1000)).toLocaleString('en-US')
  ])
  const width = head.map((_, i) => Math.max(head[i].length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]): string =>
    cells.map((c, i) => (i === 0 ? c.padEnd(width[i]) : c.padStart(width[i]))).join('  ')
  console.info('\n' + line(head))
  console.info(width.map((w) => '-'.repeat(w)).join('  '))
  for (const r of rows) console.info(line(r))
})

jest.setTimeout(180000)

describe('LiveQuery benchmarks', () => {
  it('initial subscription over a large result', async () => {
    const { liveQuery, factory } = await getBench()
    const n = 2000
    await createProjects(factory, n, 'sub')

    const start = performance.now()
    let seen = 0
    await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'sub-%' } },
      undefined,
      (res) => {
        seen = res.length
      }
    )
    record('first subscription (docs)', n, performance.now() - start)

    expect(seen).toBe(n)
  })

  it('tx throughput with a single subscriber', async () => {
    const { liveQuery, factory } = await getBench()
    const ids = await createProjects(factory, 200, 'thr')
    let last: TestProject[] = []
    await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'thr-%' } },
      undefined,
      (res) => {
        last = res
      }
    )

    const n = 400
    const start = performance.now()
    for (let i = 0; i < n; i++) {
      await factory.updateDoc(test.class.TestProject, core.space.Model, ids[i % ids.length], {
        description: `d-${i}`
      })
    }
    // Callbacks are coalesced, so the finish line is the last write showing up, not a count.
    const lastId = ids[(n - 1) % ids.length]
    await until(() => last.find((d) => d._id === lastId)?.description === `d-${n - 1}`)
    record('update tx, 1 subscriber', n, performance.now() - start)

    expect(last.find((d) => d._id === lastId)?.description).toBe(`d-${n - 1}`)
  })

  for (const subscribers of [1, 10, 50]) {
    it(`tx fan-out to ${subscribers} subscribers`, async () => {
      const { liveQuery, factory } = await getBench()
      const ids = await createProjects(factory, 100, `fan${subscribers}`)
      const lastPerSub: TestProject[][] = []
      for (let s = 0; s < subscribers; s++) {
        lastPerSub.push([])
        const slot = s
        // A per-subscriber $nin of an id that does not exist makes each query distinct without
        // narrowing it - a differing `limit` would leave some subscribers without the last doc.
        await subscribe<TestProject>(
          liveQuery,
          test.class.TestProject,
          { prjName: { $like: `fan${subscribers}-%` }, _id: { $nin: [`absent-${s}` as Ref<TestProject>] } },
          undefined,
          (res) => {
            lastPerSub[slot] = res
          }
        )
      }

      const n = 100
      const start = performance.now()
      for (let i = 0; i < n; i++) {
        await factory.updateDoc(test.class.TestProject, core.space.Model, ids[i % ids.length], {
          description: `d-${i}`
        })
      }
      const lastId = ids[(n - 1) % ids.length]
      const arrived = (): boolean =>
        lastPerSub.every((res) => res.find((d) => d._id === lastId)?.description === `d-${n - 1}`)
      await until(arrived)
      record(`update tx, ${subscribers} subscribers`, n, performance.now() - start)

      expect(arrived()).toBe(true)
    })
  }

  it('subscribe to an already running query', async () => {
    const { liveQuery, factory, serverCalls } = await getBench()
    await createProjects(factory, 100, 'join')
    const query = { prjName: { $like: 'join-%' } }
    const unsubscribeFirst = await subscribe<TestProject>(liveQuery, test.class.TestProject, query)
    const before = serverCalls()

    // Each join is served from the running query: measures the delivery of its cached result.
    const n = 500
    const start = performance.now()
    for (let i = 0; i < n; i++) {
      const unsubscribe = await subscribe<TestProject>(liveQuery, test.class.TestProject, query)
      unsubscribe()
    }
    record('join running query', n, performance.now() - start)
    unsubscribeFirst()

    expect(serverCalls()).toBe(before)
  })

  it('findOne served from the Refs cache', async () => {
    const { liveQuery, factory, serverCalls } = await getBench()
    const ids = await createProjects(factory, 200, 'cache')
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: { $like: 'cache-%' } })
    const before = serverCalls()

    const n = 2000
    const start = performance.now()
    for (let i = 0; i < n; i++) {
      await liveQuery.findOne(test.class.TestProject, { _id: ids[i % ids.length] })
    }
    record('findOne from cache', n, performance.now() - start)

    // A single server call here would mean the numbers above are not measuring the cache.
    expect(serverCalls()).toBe(before)
  })

  it('findOne that misses the cache', async () => {
    const { liveQuery, factory, serverCalls } = await getBench()
    const ids = await createProjects(factory, 200, 'miss')
    const before = serverCalls()

    const n = 500
    const start = performance.now()
    for (let i = 0; i < n; i++) {
      // A projection is never cached, so every call goes through a fresh dump query.
      await liveQuery.findOne(
        test.class.TestProject,
        { _id: ids[i % ids.length] },
        { projection: { _id: 1, prjName: 1 } }
      )
    }
    record('findOne, cache miss', n, performance.now() - start)

    expect(serverCalls()).toBeGreaterThan(before)
  })

  it('result cloning on every callback', async () => {
    const { liveQuery, factory } = await getBench()
    const size = 1000
    const ids = await createProjects(factory, size, 'clone')
    let last: TestProject[] = []
    await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'clone-%' } },
      undefined,
      (res) => {
        last = res
      }
    )

    // Each callback hands out a fresh clone of all `size` docs.
    const n = 50
    const start = performance.now()
    for (let i = 0; i < n; i++) {
      await factory.updateDoc(test.class.TestProject, core.space.Model, ids[i], { description: `c-${i}` })
    }
    await until(() => last.find((d) => d._id === ids[n - 1])?.description === `c-${n - 1}`)
    record(`callback clone of ${size} docs`, n, performance.now() - start)

    expect(last).toHaveLength(size)
  })

  it('insert into a sorted, limited window', async () => {
    const { liveQuery, factory } = await getBench()
    await createProjects(factory, 500, 'win')
    let updates = 0
    await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'win-%' } },
      { sort: { prjName: SortingOrder.Ascending }, limit: 50 },
      () => {
        updates++
      }
    )
    const before = updates

    const n = 200
    const start = performance.now()
    for (let i = 0; i < n; i++) {
      // Sorts to the front every time, so the window is rebuilt on each insert.
      await factory.createDoc(test.class.TestProject, core.space.Model, {
        name: `win-new-${i}`,
        description: '',
        private: false,
        members: [],
        archived: false,
        prjName: `win-!${String(n - i).padStart(5, '0')}`
      })
    }
    await until(() => updates - before >= n)
    record('insert into sorted window(50)', n, performance.now() - start)

    expect(updates - before).toBeGreaterThanOrEqual(n)
  })
})
