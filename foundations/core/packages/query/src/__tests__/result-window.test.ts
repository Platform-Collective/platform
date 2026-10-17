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

// A limited, sorted query is a window over a larger set; every tx must keep size/order right and
// refill from the server when a row leaves - else rows are silently lost or duplicated.

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

async function getClient (): Promise<{ liveQuery: LiveQuery, factory: TxOperations, storage: Client }> {
  const storage = await createClient(connect)
  const liveQuery = new LiveQuery(storage)
  storage.notify = (...tx: Tx[]) => {
    liveQuery.tx(...tx).catch((err) => {
      console.log(err)
    })
  }
  return { liveQuery, factory: new TxOperations(storage, core.account.System), storage }
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

async function subscribe<T extends Doc> (
  liveQuery: LiveQuery,
  _class: Ref<Class<T>>,
  query: any,
  options?: any
): Promise<{ last: () => T[], total: () => number }> {
  let last: T[] = []
  let total = 0
  await new Promise((resolve) => {
    liveQuery.query<T>(
      _class,
      query,
      (res) => {
        last = res
        total = res.total
        resolve(null)
      },
      options
    )
  })
  return { last: () => last, total: () => total }
}

const sortedNames = (docs: TestProject[]): string[] => docs.map((it) => it.prjName)

describe('limited and sorted results', () => {
  it('keeps the window at limit when a higher-sorting document appears', async () => {
    const { liveQuery, factory } = await getClient()
    for (const n of ['w-b', 'w-c', 'w-d']) {
      await createProject(factory, n)
    }
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'w-%' } },
      { sort: { prjName: SortingOrder.Ascending }, limit: 2 }
    )
    expect(sortedNames(q.last())).toEqual(['w-b', 'w-c'])

    await createProject(factory, 'w-a')
    await settle()

    expect(sortedNames(q.last())).toEqual(['w-a', 'w-b'])
  })

  it('ignores a document that sorts past the end of the window', async () => {
    const { liveQuery, factory } = await getClient()
    for (const n of ['x-a', 'x-b']) {
      await createProject(factory, n)
    }
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'x-%' } },
      { sort: { prjName: SortingOrder.Ascending }, limit: 2 }
    )

    await createProject(factory, 'x-z')
    await settle()

    expect(sortedNames(q.last())).toEqual(['x-a', 'x-b'])
  })

  it('refills the window from the server when a row is removed', async () => {
    const { liveQuery, factory } = await getClient()
    const ids: Array<Ref<TestProject>> = []
    for (const n of ['r-a', 'r-b', 'r-c']) {
      ids.push(await createProject(factory, n))
    }
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'r-%' } },
      { sort: { prjName: SortingOrder.Ascending }, limit: 2 }
    )
    expect(sortedNames(q.last())).toEqual(['r-a', 'r-b'])

    await factory.removeDoc(test.class.TestProject, core.space.Model, ids[0])
    await settle()

    // 'r-c' was outside the window and has to be fetched, not just dropped from the tail.
    expect(sortedNames(q.last())).toEqual(['r-b', 'r-c'])
  })

  it('refills the window when a row stops matching the query', async () => {
    const { liveQuery, factory } = await getClient()
    const ids: Array<Ref<TestProject>> = []
    for (const n of ['m-a', 'm-b', 'm-c']) {
      ids.push(await createProject(factory, n))
    }
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'm-%' } },
      { sort: { prjName: SortingOrder.Ascending }, limit: 2 }
    )

    await factory.updateDoc(test.class.TestProject, core.space.Model, ids[0], { prjName: 'gone' })
    await settle()

    expect(sortedNames(q.last())).toEqual(['m-b', 'm-c'])
  })

  it('re-sorts the window when the sorting field changes', async () => {
    const { liveQuery, factory } = await getClient()
    const ids: Array<Ref<TestProject>> = []
    for (const n of ['s-a', 's-b']) {
      ids.push(await createProject(factory, n))
    }
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 's-%' } },
      { sort: { prjName: SortingOrder.Ascending } }
    )
    expect(sortedNames(q.last())).toEqual(['s-a', 's-b'])

    await factory.updateDoc(test.class.TestProject, core.space.Model, ids[0], { prjName: 's-z' })
    await settle()

    expect(sortedNames(q.last())).toEqual(['s-b', 's-z'])
  })

  it('brings in a document that starts matching the query', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'outsider')
    const q = await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: { $like: 'in-%' } })
    expect(q.last()).toHaveLength(0)

    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'in-now' })
    await settle()

    expect(sortedNames(q.last())).toEqual(['in-now'])
  })

  it('tracks total across add and remove', async () => {
    const { liveQuery, factory } = await getClient()
    const ids: Array<Ref<TestProject>> = []
    for (const n of ['t-a', 't-b', 't-c']) {
      ids.push(await createProject(factory, n))
    }
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 't-%' } },
      { sort: { prjName: SortingOrder.Ascending }, total: true }
    )
    expect(q.total()).toBe(3)

    await createProject(factory, 't-d')
    await settle()
    expect(q.total()).toBe(4)

    await factory.removeDoc(test.class.TestProject, core.space.Model, ids[2])
    await settle()
    expect(q.total()).toBe(3)
  })

  it('leaves total stale when a document outside the window is removed', async () => {
    // TxRemoveDoc has no attributes, so a doc the result never held can't be query-tested -
    // handleDocRemove just adjusts total. Refresh self-corrects it; not ideal, but pinned.
    const { liveQuery, factory } = await getClient()
    const ids: Array<Ref<TestProject>> = []
    for (const n of ['o-a', 'o-b', 'o-c']) {
      ids.push(await createProject(factory, n))
    }
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $like: 'o-%' } },
      { sort: { prjName: SortingOrder.Ascending }, limit: 2, total: true }
    )
    expect(q.total()).toBe(3)

    await factory.removeDoc(test.class.TestProject, core.space.Model, ids[2])
    await settle()

    expect(sortedNames(q.last())).toEqual(['o-a', 'o-b'])
    expect(q.total()).toBe(3)
  })
})
