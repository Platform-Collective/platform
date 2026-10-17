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

import core, {
  createClient,
  generateId,
  TxOperations,
  type Association,
  type Class,
  type Client,
  type Doc,
  type Ref,
  type Relation,
  type Space,
  type Tx,
  type WithLookup
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { test, type ParticipantsHolder } from './minmodel'

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

async function createHolder (factory: TxOperations, participants: Ref<Doc>[]): Promise<Ref<ParticipantsHolder>> {
  return await factory.createDoc(test.class.ParticipantsHolder, core.space.Model, { participants })
}

async function createRelation (
  factory: TxOperations,
  docA: Ref<Doc>,
  docB: Ref<Doc>,
  association: Ref<Association>
): Promise<Ref<Relation>> {
  return await factory.createDoc(core.class.Relation, core.space.Model, { docA, docB, association })
}

// Subscribe and resolve on the first callback; `last()` keeps returning the latest result.
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

describe('LiveQuery associations', () => {
  it('fills the direct side ($associations[assoc_b]) when a Relation doc arrives', async () => {
    const { liveQuery, factory } = await getClient()
    const projectId = await createProject(factory, 'direct-src')
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { _id: projectId },
      {
        associations: [[test.association.ProjectHolder, 1]]
      }
    )

    const participants = [generateId(), generateId()]
    const holderId = await createHolder(factory, participants)
    await createRelation(factory, projectId, holderId, test.association.ProjectHolder)
    await settle()

    const doc = q.last()[0] as WithLookup<TestProject>
    const linked = doc.$associations?.[`${test.association.ProjectHolder}_b`]
    expect(linked).toHaveLength(1)
    expect(linked?.[0]._id).toBe(holderId)
    expect((linked?.[0] as unknown as ParticipantsHolder).participants).toEqual(participants)
  })

  it('fills the reverse side ($associations[assoc_a]) when queried from classB', async () => {
    const { liveQuery, factory } = await getClient()
    const holderId = await createHolder(factory, [])
    const q = await subscribe<ParticipantsHolder>(
      liveQuery,
      test.class.ParticipantsHolder,
      { _id: holderId },
      {
        associations: [[test.association.ProjectHolder, -1]]
      }
    )

    const projectId = await createProject(factory, 'reverse-target')
    await createRelation(factory, projectId, holderId, test.association.ProjectHolder)
    await settle()

    const doc = q.last()[0] as WithLookup<ParticipantsHolder>
    const linked = doc.$associations?.[`${test.association.ProjectHolder}_a`]
    expect(linked).toHaveLength(1)
    expect((linked?.[0] as unknown as TestProject).prjName).toBe('reverse-target')
  })

  it('replaces (not duplicates) an existing joined doc when a second Relation points at it', async () => {
    const { liveQuery, factory } = await getClient()
    const projectId = await createProject(factory, 'replace-src')
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { _id: projectId },
      {
        associations: [[test.association.ProjectHolder, 1]]
      }
    )

    const holderId = await createHolder(factory, [generateId()])
    await createRelation(factory, projectId, holderId, test.association.ProjectHolder)
    await settle()
    expect(
      (q.last()[0] as WithLookup<TestProject>).$associations?.[`${test.association.ProjectHolder}_b`]
    ).toHaveLength(1)

    // A second Relation doc for the very same (docA, docB) pair must replace the existing entry
    // in place, not push a duplicate - this is the `exists !== -1` branch in fillRelationDoc.
    await createRelation(factory, projectId, holderId, test.association.ProjectHolder)
    await settle()

    const linked = (q.last()[0] as WithLookup<TestProject>).$associations?.[`${test.association.ProjectHolder}_b`]
    expect(linked).toHaveLength(1)
    expect(linked?.[0]._id).toBe(holderId)
  })

  it('fills a nested association (assoc[2]) recursively through an already-joined doc', async () => {
    const { liveQuery, factory } = await getClient()
    const projectId = await createProject(factory, 'nested-src')
    const holderId = await createHolder(factory, [])
    // First-level relation must exist before subscribing, so the holder is already in
    // $associations when the nested Relation event arrives and fillRelationDoc recurses.
    await createRelation(factory, projectId, holderId, test.association.ProjectHolder)

    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { _id: projectId },
      {
        associations: [[test.association.ProjectHolder, 1, [[test.association.HolderProject, 1]]]]
      }
    )

    const project2Id = await createProject(factory, 'nested-target')
    await createRelation(factory, holderId, project2Id, test.association.HolderProject)
    await settle()

    const doc = q.last()[0] as WithLookup<TestProject>
    const holder = doc.$associations?.[`${test.association.ProjectHolder}_b`]?.[0] as WithLookup<ParticipantsHolder>
    const nested = holder?.$associations?.[`${test.association.HolderProject}_b`]
    expect(nested).toHaveLength(1)
    expect((nested?.[0] as unknown as TestProject).prjName).toBe('nested-target')
  })

  it('propagates a TxUpdateDoc on a joined doc into $associations, without a server refetch', async () => {
    const { liveQuery, factory } = await getClient()
    const projectId = await createProject(factory, 'update-src')
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { _id: projectId },
      {
        associations: [[test.association.ProjectHolder, 1]]
      }
    )

    const holderId = await createHolder(factory, [])
    await createRelation(factory, projectId, holderId, test.association.ProjectHolder)
    await settle()

    const updated = [generateId(), generateId()]
    await factory.updateDoc(test.class.ParticipantsHolder, core.space.Model, holderId, { participants: updated })
    await settle()

    const doc = q.last()[0] as WithLookup<TestProject>
    const linked = doc.$associations?.[`${test.association.ProjectHolder}_b`]?.[0] as unknown as ParticipantsHolder
    expect(linked.participants).toEqual(updated)
  })

  it('drops the joined doc after the Relation is removed', async () => {
    const { liveQuery, factory } = await getClient()
    const projectId = await createProject(factory, 'remove-src')
    const q = await subscribe<TestProject>(
      liveQuery,
      test.class.TestProject,
      { _id: projectId },
      {
        associations: [[test.association.ProjectHolder, 1]]
      }
    )

    const holderId = await createHolder(factory, [])
    const relationId = await createRelation(factory, projectId, holderId, test.association.ProjectHolder)
    await settle()
    expect(
      (q.last()[0] as WithLookup<TestProject>).$associations?.[`${test.association.ProjectHolder}_b`]
    ).toHaveLength(1)

    await factory.removeDoc(core.class.Relation, core.space.Model, relationId)
    await settle()

    const linked = (q.last()[0] as WithLookup<TestProject>).$associations?.[`${test.association.ProjectHolder}_b`]
    expect(linked ?? []).toHaveLength(0)
  })
})
