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

// The whole result registers in Refs once (`q.refsRegistered`), not per callback, so every
// path registers the right object and unregisters what it drops - the old pass is gone.

import core, {
  createClient,
  Hierarchy,
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
import { Refs } from '../refs'
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

// The registry is private on purpose - these tests are about what it holds, not about the API.
function refsOf (liveQuery: LiveQuery): Map<string, Map<Ref<Doc>, { doc: Doc, queries: Set<string> }>> {
  return (liveQuery as any).refs.documentRefs
}

function refEntry (liveQuery: LiveQuery, id: Ref<Doc>): { doc: Doc, queries: Set<string> } | undefined {
  for (const [, docs] of refsOf(liveQuery)) {
    const entry = docs.get(id)
    if (entry !== undefined) return entry
  }
}

function singleQuery (liveQuery: LiveQuery): any {
  const all: any[] = []
  for (const [, byId] of (liveQuery as any).queries as Map<string, Map<number, any>>) {
    for (const [, q] of byId) all.push(q)
  }
  expect(all.length).toBe(1)
  return all[0]
}

describe('Refs registration', () => {
  it('registers the document the result holds, not the copy it was pushed from', async () => {
    const { liveQuery, factory } = await getClient()
    await subscribe<TestProject>(liveQuery, test.class.TestProject, { prjName: 'late-arrival' })

    const id = await createProject(factory, 'late-arrival')
    await settle()

    const q = singleQuery(liveQuery)
    const inResult = q.result.findDoc(id)
    expect(inResult).toBeDefined()
    // `push` clones, so registering the pre-clone object leaves Refs pointing at a doc nothing
    // updates in place any more - stale lookups and associations follow.
    expect(refEntry(liveQuery, id)?.doc).toBe(inResult)
  })

  it('keeps the cached copy in step with in-place lookup updates', async () => {
    const { liveQuery, factory } = await getClient()
    const prj = await createProject(factory, 'lookup-host')
    await subscribe(
      liveQuery,
      test.class.TestComment,
      { attachedTo: prj },
      { lookup: { attachedTo: test.class.TestProject } }
    )

    const comment = await factory.addCollection(
      test.class.TestComment,
      core.space.Model,
      prj,
      test.class.TestProject,
      'comments',
      { message: 'hello' }
    )
    await settle()

    await factory.updateDoc(test.class.TestProject, core.space.Model, prj, { prjName: 'lookup-host-renamed' })
    await settle()

    const cached: any = await liveQuery.findOne(
      test.class.TestComment,
      { _id: comment },
      { lookup: { attachedTo: test.class.TestProject } }
    )
    expect(cached?.$lookup?.attachedTo?.prjName).toBe('lookup-host-renamed')
  })

  it('does not keep a document the window pushed straight back out', async () => {
    const { liveQuery, factory } = await getClient()
    const second = await createProject(factory, 'b-second')
    await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { prjName: { $in: ['a-first', 'b-second'] } },
      { limit: 1, sort: { prjName: SortingOrder.Ascending } }
    )

    // 'a-first' sorts ahead, so 'b-second' leaves the window - and nothing holds it any more.
    await createProject(factory, 'a-first')
    await settle()

    const q = singleQuery(liveQuery)
    expect(q.result.findDoc(second)).toBeUndefined()
    expect(refEntry(liveQuery, second)?.queries.has(q.id)).not.toBe(true)
  })
})

describe('Refs.updateDocuments', () => {
  let hierarchy: Hierarchy

  beforeAll(async () => {
    hierarchy = (await createClient(connect)).getHierarchy()
  })

  const makeQuery = (id: number): any => ({ id, _class: core.class.Space, query: {}, options: undefined })

  const doc = (modifiedOn: number): Doc => ({
    _id: 'doc-1' as Ref<Doc>,
    _class: core.class.Space,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn
  })

  it('registers a query holding an older revision of the document', () => {
    const refs = new Refs(() => hierarchy)
    const q1 = makeQuery(1)
    const q2 = makeQuery(2)

    refs.updateDocuments(q1, [doc(200)])
    // q2 arrived with a copy another query has already moved past: the revision loses, the
    // membership must not - otherwise q1 leaving drops a document q2 still holds.
    refs.updateDocuments(q2, [doc(100)])
    refs.updateDocuments(q1, [doc(200)], true)

    expect(refs.findFromDocs(core.class.Space, { _id: 'doc-1' as Ref<Doc> }, undefined)).not.toBeNull()
  })
})
