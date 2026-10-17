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

// A mixin sits on the base doc, so TxMixin must reach queries on the base class, the mixin,
// and neither - a doc enters/leaves as the mixin is added or fields stop matching.

import core, {
  createClient,
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

interface TestProjectMixin extends TestProject {
  someField?: string
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

async function subscribe<T extends Doc> (
  liveQuery: LiveQuery,
  _class: Ref<Class<T>>,
  query: any,
  options?: any
): Promise<{ last: () => T[] }> {
  let last: T[] = []
  await new Promise((resolve) => {
    liveQuery.query<T>(
      _class,
      query,
      (res) => {
        last = res
        resolve(null)
      },
      options
    )
  })
  return { last: () => last }
}

describe('mixin queries', () => {
  it('delivers mixin fields to a query on the base class', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'mx-base')
    const q = await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'mx-base' })

    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'from-mixin'
    })
    await settle()

    const doc = q.last()[0] as any
    expect(doc[test.mixin.TestProjectMixin]?.someField).toBe('from-mixin')
  })

  it('brings a document into a mixin query when the mixin is added', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'mx-join')
    const q = await subscribe<TestProjectMixin>(liveQuery, test.mixin.TestProjectMixin, { prjName: 'mx-join' })
    expect(q.last()).toHaveLength(0)

    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'joined'
    })
    await settle()

    expect(q.last()).toHaveLength(1)
    expect(q.last()[0].someField).toBe('joined')
  })

  it('updates a mixin query when a mixin field changes', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'mx-update')
    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'before'
    })
    const q = await subscribe<TestProjectMixin>(liveQuery, test.mixin.TestProjectMixin, { prjName: 'mx-update' })
    expect(q.last()[0]?.someField).toBe('before')

    await factory.updateMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'after'
    })
    await settle()

    expect(q.last()[0]?.someField).toBe('after')
  })

  it('drops a document from a mixin query when it stops matching', async () => {
    // Filtered on a base-class field: the test storage does not answer queries over mixin
    // attributes, so the mixin part of the assertion is the `_class` of the query, not the filter.
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'mx-leave')
    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'keep'
    })
    const q = await subscribe<TestProjectMixin>(liveQuery, test.mixin.TestProjectMixin, { prjName: 'mx-leave' })
    expect(q.last()).toHaveLength(1)

    await factory.updateDoc(test.class.TestProject, core.space.Model, id, { prjName: 'mx-left' })
    await settle()

    expect(q.last()).toHaveLength(0)
  })

  it('leaves an unrelated query alone when a mixin is added', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'mx-other')
    const other = await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'mx-untouched' })

    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'x'
    })
    await settle()

    expect(other.last()).toHaveLength(0)
  })

  it('asks the server for a mixin findOne, even with the base document cached', async () => {
    // The cache is keyed by the stored class, so a base-class query never answers a mixin one -
    // otherwise a document without the mixin could come back as if it had it.
    const { liveQuery, factory, findAllCalls } = await getClient()
    const id = await createProject(factory, 'mx-cached')
    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'cached'
    })
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'mx-cached' })
    const before = findAllCalls()

    const doc = await liveQuery.findOne<TestProjectMixin>(test.mixin.TestProjectMixin, { prjName: 'mx-cached' })

    expect(doc?.someField).toBe('cached')
    expect(findAllCalls()).toBeGreaterThan(before)
  })

  it('matches a dotted mixin key in matchQuery', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'mx-key')
    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'x'
    })
    const key = `${test.mixin.TestProjectMixin}.someField`
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'mx-key' })
    const query = [...(liveQuery as any).queries.get(test.class.TestProject).values()][0]
    query.query = { [key]: 'x' }
    const tx = {
      _id: 'tx1',
      _class: core.class.TxUpdateDoc,
      objectId: id,
      objectClass: test.class.TestProject,
      objectSpace: core.space.Model,
      space: core.space.Tx,
      modifiedBy: core.account.System,
      modifiedOn: 0,
      operations: { [key]: 'x' }
    }
    expect(await (liveQuery as any).matchQuery(query, tx, new Map())).toBe(true)
    expect(await (liveQuery as any).matchQuery(query, { ...tx, operations: { [key]: 'y' } }, new Map())).toBe(false)
  })
})
