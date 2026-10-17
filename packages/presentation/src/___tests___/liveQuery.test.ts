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

import core, { type Client, type Doc, type FindResult, setCurrentAccount } from '@hcengineering/core'
import { createQuery, refreshClient, setClient } from '../utils'

interface Subscription {
  query: Record<string, any>
  active: boolean
  onResult: (res: any) => void
}

const mockDestroyHandlers: Array<() => void> = []
jest.mock('svelte', () => ({ onDestroy: (fn: () => void) => mockDestroyHandlers.push(fn) }))
jest.mock('svelte/store', () => {
  const writable = (value: any): any => {
    const subs = new Set<(v: any) => void>()
    return {
      set: (v: any) => {
        value = v
        subs.forEach((s) => {
          s(v)
        })
      },
      update: (fn: (v: any) => any) => {
        value = fn(value)
      },
      subscribe: (s: (v: any) => void) => {
        subs.add(s)
        s(value)
        return () => subs.delete(s)
      }
    }
  }
  const get = (store: any): any => {
    let v: any
    store.subscribe((it: any) => (v = it))()
    return v
  }
  return { writable, get, derived: () => writable(undefined), readable: writable }
})
jest.mock('@hcengineering/ui', () => ({ getRawCurrentLocation: () => ({ path: [] }), workspaceId: undefined }))
// Records subscriptions and answers each with its own query.
jest.mock('@hcengineering/query', () => ({
  LiveQuery: class {
    static subscriptions: Subscription[] = []

    query (_class: any, query: Record<string, any>, onResult: (res: any) => void): () => void {
      const sub: Subscription = { query, active: true, onResult }
      ;(this.constructor as any).subscriptions.push(sub)
      void Promise.resolve().then(() => {
        if (sub.active) onResult([{ query }])
      })
      return () => {
        sub.active = false
      }
    }

    async close (): Promise<void> {}

    async refreshConnect (): Promise<void> {}

    isClosed (): boolean {
      return false
    }
  }
}))

const subscriptions = (): Subscription[] => jest.requireMock('@hcengineering/query').LiveQuery.subscriptions

async function settle (): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('LiveQuery', () => {
  beforeAll(async () => {
    setCurrentAccount({ uuid: 'test', role: 'USER', primarySocialId: 'test', socialIds: ['test'] } as any)
    await setClient({ findAll: async () => [], notify: () => {}, close: async () => {} } as unknown as Client)
  })

  it('resubscribes to A after A -> B -> A within one tick', async () => {
    const q = createQuery(true)
    const received: string[] = []
    const callback = (res: FindResult<Doc>): void => {
      received.push((res[0] as any).query.name)
    }

    q.query(core.class.Doc, { name: 'A' }, callback)
    await settle()
    expect(received).toEqual(['A'])

    expect(q.query(core.class.Doc, { name: 'B' } as any, callback)).toBe(true)
    expect(q.query(core.class.Doc, { name: 'A' } as any, callback)).toBe(true)
    await settle()

    const active = subscriptions().filter((it) => it.active)
    expect(active.map((it) => it.query.name)).toEqual(['A'])
    expect(received[received.length - 1]).toBe('A')
  })

  it('does not requery the same request', async () => {
    const q = createQuery(true)
    const callback = (): void => {}
    expect(q.query(core.class.Doc, { name: 'C' } as any, callback)).toBe(true)
    expect(q.query(core.class.Doc, { name: 'C' } as any, callback)).toBe(false)
    await settle()
    expect(q.query(core.class.Doc, { name: 'C' } as any, callback)).toBe(false)
  })

  it('does not subscribe when unsubscribed before the deferred query runs', async () => {
    const q = createQuery(true)
    q.query(core.class.Doc, { name: 'D' }, () => {})
    q.unsubscribe()
    await settle()

    expect(subscriptions().filter((it) => it.query.name === 'D')).toEqual([])
  })

  it('ignores query() after component destroy', async () => {
    mockDestroyHandlers.length = 0
    const q = createQuery()
    for (const destroy of mockDestroyHandlers) destroy()

    expect(q.query(core.class.Doc, { name: 'E' } as any, () => {})).toBe(false)
    await settle()
    expect(subscriptions().filter((it) => it.query.name === 'E')).toEqual([])
  })

  it('does not resubscribe an unsubscribed global query on client refresh', async () => {
    const q = createQuery(true)
    q.query(core.class.Doc, { name: 'F' }, () => {})
    await settle()
    q.unsubscribe()
    await refreshClient(true)
    await settle()

    expect(subscriptions().filter((it) => it.query.name === 'F' && it.active)).toEqual([])
  })

  it('subscribes only the last of several requests made in one tick', async () => {
    const q = createQuery(true)
    const callback = (): void => {}
    q.query(core.class.Doc, { name: 'J1' }, callback)
    q.query(core.class.Doc, { name: 'J2' }, callback)
    q.query(core.class.Doc, { name: 'J3' }, callback)
    await settle()

    expect(
      subscriptions()
        .filter((it) => /^J/.test(it.query.name))
        .map((it) => it.query.name)
    ).toEqual(['J3'])
  })

  it('subscribes again after unsubscribe', async () => {
    const q = createQuery(true)
    const callback = (): void => {}
    q.query(core.class.Doc, { name: 'K' }, callback)
    await settle()
    q.unsubscribe()
    expect(q.query(core.class.Doc, { name: 'K' } as any, callback)).toBe(true)
    await settle()

    expect(subscriptions().filter((it) => it.query.name === 'K' && it.active)).toHaveLength(1)
  })

  it('drops results that a released subscription still delivers', async () => {
    const q = createQuery(true)
    const received: string[] = []
    const callback = (res: FindResult<Doc>): void => {
      received.push((res[0] as any).query.name)
    }
    q.query(core.class.Doc, { name: 'L1' }, callback)
    await settle()
    q.query(core.class.Doc, { name: 'L2' }, callback)
    await settle()

    const released = subscriptions().find((it) => it.query.name === 'L1')
    released?.onResult([{ query: { name: 'L1' } }])
    expect(received).toEqual(['L1', 'L2'])
  })
})
