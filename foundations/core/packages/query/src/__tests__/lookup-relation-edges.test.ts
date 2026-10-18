// Lookup and association edge branches not reached by deep-lookup.test.ts, lookup-add.test.ts,
// associations.test.ts or edge-branches.test.ts. Target lines are called out per describe block;
// they were re-derived from a fresh lcov/BRDA run against the current src/index.ts (see the
// session report for the drift found vs. the original task description).
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
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type Ref,
  type Relation,
  type Space
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { ResultArray } from '../results'
import { connect } from './connection'
import { test, type AttachedComment, type ParticipantsHolder } from './minmodel'

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
  txErrors: Error[]
  close: () => Promise<void>
}> {
  const storage = await createClient(connect)
  const liveQuery = new LiveQuery(storage)
  const txErrors: Error[] = []
  storage.notify = (...tx) => {
    liveQuery.tx(...tx).catch((err) => txErrors.push(err))
  }
  return {
    liveQuery,
    factory: new TxOperations(storage, core.account.System),
    storage,
    txErrors,
    close: async () => {
      await liveQuery.close()
    }
  }
}

// Subscribes and resolves once the first callback fires; the mock keeps recording later calls.
async function subscribe<T extends Doc> (
  liveQuery: LiveQuery,
  _class: Ref<Class<T>>,
  query: any,
  options?: any
): Promise<{ mock: jest.Mock }> {
  const mock = jest.fn()
  await new Promise<void>((resolve) => {
    let resolved = false
    liveQuery.query<T>(
      _class,
      query,
      (res) => {
        mock(res)
        if (!resolved) {
          resolved = true
          resolve()
        }
      },
      options
    )
  })
  return { mock }
}

// tx() is fired without being awaited by the client (storage.notify above), so a plain fixed
// delay after a write is racy. Poll for the next callback instead.
async function waitForNextCall (mock: jest.Mock, from: number, timeoutMs = 2000): Promise<any[]> {
  const start = Date.now()
  while (mock.mock.calls.length <= from) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for a LiveQuery callback')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return mock.mock.calls[mock.mock.calls.length - 1][0]
}

function last (mock: jest.Mock): any[] {
  return mock.mock.calls[mock.mock.calls.length - 1][0]
}

// Fixed wait used only to prove a callback did NOT fire again; short enough to keep the suite
// fast, long enough for the fire-and-forget tx() call above to have settled.
const settle = async (ms = 80): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// Local-apply update branches need tx.modifiedOn strictly greater than the doc's stored value,
// else the code takes the refresh-from-server path (see lookup-add.test.ts).
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 2))
}

async function createSpace (factory: TxOperations, name: string): Promise<Ref<Space>> {
  return await factory.createDoc(core.class.Space, core.space.Model, {
    name,
    description: '',
    private: false,
    members: [],
    archived: false
  })
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

async function createHolder (factory: TxOperations): Promise<Ref<ParticipantsHolder>> {
  return await factory.createDoc(test.class.ParticipantsHolder, core.space.Model, { participants: [] })
}

describe('processLookupUpdateDoc: unresolved nested lookup parent (index.ts L909)', () => {
  it('skips a result doc whose lookup path resolves to nothing, without crashing', async () => {
    const { liveQuery, factory, txErrors, close } = await getClient()

    const space = await createSpace(factory, 'orphan-space')
    // Parent must exist at subscribe time: ModelDb.getLookupValue can't handle a missing
    // parent, so we can't start from an orphan - we orphan the child afterwards.
    const parentComment = await factory.addCollection(
      test.class.TestComment,
      space,
      space,
      core.class.Space,
      'comments',
      { message: 'parent' }
    )
    const comment = await factory.addCollection(
      test.class.TestComment,
      space,
      parentComment,
      test.class.TestComment,
      'comments',
      { message: 'child' }
    )

    const { mock } = await subscribe(
      liveQuery,
      test.class.TestComment,
      { _id: comment },
      {
        lookup: { attachedTo: [test.class.TestComment, { space: core.class.Space }] }
      }
    )
    expect(last(mock)[0].$lookup?.attachedTo?.message).toBe('parent')
    const before = mock.mock.calls.length

    // Remove the parent: handleDocRemoveLookup nulls out $lookup.attachedTo on our child doc
    // (index.ts ~L1435), so it now resolves to undefined.
    await factory.removeCollection(test.class.TestComment, space, parentComment, space, core.class.Space, 'comments')
    await waitForNextCall(mock, before)
    expect(last(mock)[0].$lookup?.attachedTo).toBeUndefined()
    const beforeSpaceUpdate = mock.mock.calls.length

    // Updates an unrelated Space doc: getLookupWays matches by tx.objectClass alone, so it
    // runs though attachedTo is undefined - skip, don't dereference.
    await tick()
    await factory.updateDoc(core.class.Space, core.space.Model, space, { description: 'renamed' })
    await settle()

    expect(mock.mock.calls.length).toBe(beforeSpaceUpdate)
    expect(last(mock)[0].$lookup?.attachedTo).toBeUndefined()
    expect(txErrors).toHaveLength(0)

    await close()
  })
})

describe('getReverseLookupValue: undefined key on doc ADD (index.ts L1104-1105)', () => {
  it('does not resolve a reverse lookup when the key field on the added doc is undefined', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await createSpace(factory, 'reverse-skip')
    const parentId = generateId<AttachedComment>()
    // Pre-existing child: if the skip did not fire, the reverse lookup would resolve to length 1.
    await factory.addCollection(test.class.TestComment, space, parentId, test.class.TestComment, 'comments', {
      message: 'pre-existing-child'
    })

    const { mock } = await subscribe(
      liveQuery,
      test.class.TestComment,
      { message: 'reverse-parent-skip' },
      {
        lookup: { _id: { kids: test.class.TestComment } }
      }
    )
    const before = mock.mock.calls.length

    // `kids` is a made-up counter field, left unset so getReverseLookupValue must skip it.
    await factory.addCollection(
      test.class.TestComment,
      space,
      space,
      core.class.Space,
      'comments',
      { message: 'reverse-parent-skip' },
      parentId
    )
    const result = await waitForNextCall(mock, before)

    expect(result).toHaveLength(1)
    expect(result[0].$lookup?.kids).toBeUndefined()

    await close()
  })
})

describe('handleDocAdd: needPush flips false once $lookup resolves (index.ts L1154)', () => {
  it('does not push a newly added doc that only matches before its $lookup is resolved', async () => {
    const { liveQuery, factory, close } = await getClient()

    const alpha = await createSpace(factory, 'Alpha')
    const beta = await createSpace(factory, 'Beta')

    // '$lookup.space.name' is a dotted lookup path, not a field of AttachedComment - not in
    // DocumentQuery<T>.
    const { mock } = await subscribe(
      liveQuery,
      test.class.TestComment,
      { '$lookup.space.name': 'Alpha' },
      {
        lookup: { space: core.class.Space }
      }
    )
    const before = mock.mock.calls.length

    // Passes the plain-query gate (no non-$lookup constraints), but fails to match once
    // $lookup.space is actually resolved to Beta.
    await factory.addCollection(test.class.TestComment, beta, beta, core.class.Space, 'comments', {
      message: 'beta-child'
    })
    await settle()
    expect(mock.mock.calls.length).toBe(before)

    await factory.addCollection(test.class.TestComment, alpha, alpha, core.class.Space, 'comments', {
      message: 'alpha-child'
    })
    const result = await waitForNextCall(mock, before)

    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('alpha-child')

    await close()
  })
})

describe('__updateLookup: plain-key array-form lookup refresh (index.ts L1634-1637)', () => {
  it('refreshes an array-typed lookup key on a direct (non-$push) field replace', async () => {
    const { liveQuery, factory, close } = await getClient()

    const p1 = await createProject(factory, 'Project One')
    const p2 = await createProject(factory, 'Project Two')
    const holder = await createHolder(factory)

    const { mock } = await subscribe(
      liveQuery,
      test.class.ParticipantsHolder,
      { _id: holder },
      {
        lookup: { participants: test.class.TestProject }
      }
    )
    const before = mock.mock.calls.length

    await tick()
    // Plain field replace (not $push) on an array-of-refs lookup key.
    await factory.updateDoc(test.class.ParticipantsHolder, core.space.Model, holder, {
      participants: [p1, p2]
    })
    const result = await waitForNextCall(mock, before)

    const names = (result[0].$lookup?.participants ?? []).map((d: any) => d.prjName).sort()
    expect(names).toEqual(['Project One', 'Project Two'])

    await close()
  })
})

describe('__updateLookup: plain-key single-ref lookup refresh (index.ts L1643)', () => {
  it('refreshes a single-ref lookup key on a direct (non-$push) field replace', async () => {
    const { liveQuery, factory, close } = await getClient()

    const spaceA = await createSpace(factory, 'space-a')
    const spaceB = await createSpace(factory, 'space-b')
    const comment = await factory.addCollection(test.class.TestComment, spaceA, spaceA, core.class.Space, 'comments', {
      message: 'moving-comment'
    })

    const { mock } = await subscribe(
      liveQuery,
      test.class.TestComment,
      { _id: comment },
      {
        lookup: { space: core.class.Space }
      }
    )
    expect(last(mock)[0].$lookup?.space?.name).toBe('space-a')
    const before = mock.mock.calls.length

    await tick()
    // Plain field replace (not $push) on a single-ref lookup key.
    await factory.updateDoc(test.class.TestComment, spaceA, comment, { space: spaceB })
    const result = await waitForNextCall(mock, before)

    expect(result[0].$lookup?.space?.name).toBe('space-b')

    await close()
  })
})

describe('__updateLookup: $pull against an unpopulated lookup array (index.ts L1688-1689)', () => {
  it('initializes the $lookup array before filtering when nothing was ever $pushed to it', async () => {
    const { liveQuery, factory, txErrors, close } = await getClient()

    const p1 = await createProject(factory, 'Project Pull')
    const holder = await createHolder(factory)

    const { mock } = await subscribe(
      liveQuery,
      test.class.ParticipantsHolder,
      { _id: holder },
      {
        lookup: { participants: test.class.TestProject }
      }
    )
    const before = mock.mock.calls.length

    await tick()
    // $pull with no prior $push: $lookup.participants was never set on this doc.
    await factory.updateDoc(test.class.ParticipantsHolder, core.space.Model, holder, {
      $pull: { participants: p1 }
    })
    const result = await waitForNextCall(mock, before)

    expect(result[0].$lookup?.participants).toEqual([])
    expect(txErrors).toHaveLength(0)

    await close()
  })
})

describe('fillRelationDoc: associations undefined (index.ts L1239)', () => {
  it('returns false without iterating when associations is undefined', async () => {
    const { liveQuery, close } = await getClient()

    // fillRelationDoc returns before touching `relation`, so a minimal well-typed stub is enough.
    const relation: Relation = {
      _id: generateId(),
      _class: core.class.Relation,
      space: core.space.Model,
      modifiedOn: Date.now(),
      modifiedBy: core.account.System,
      docA: generateId(),
      docB: generateId(),
      association: test.association.ProjectHolder
    }
    const qRes = new ResultArray([], liveQuery.getHierarchy())

    await expect(liveQuery.fillRelationDoc(qRes, [], undefined, relation)).resolves.toBe(false)

    await close()
  })
})

describe('fillRelationDoc: Relation target does not exist (index.ts L1264)', () => {
  it('skips a Relation pointing at a document that does not exist', async () => {
    const { liveQuery, factory, close } = await getClient()

    const projectId = await createProject(factory, 'dangling-src')
    const { mock } = await subscribe(
      liveQuery,
      test.class.TestProject,
      { _id: projectId },
      {
        associations: [[test.association.ProjectHolder, 1]]
      }
    )

    const missingHolder = generateId<Doc>()
    await factory.createDoc(core.class.Relation, core.space.Model, {
      docA: projectId,
      docB: missingHolder,
      association: test.association.ProjectHolder
    })
    await settle()

    const doc = last(mock)[0]
    const linked = doc.$associations?.[`${test.association.ProjectHolder}_b`]
    expect(linked ?? []).toHaveLength(0)

    await close()
  })
})

describe('isPossibleAssociationTx: TxMixin fallback via mixin class (index.ts L846-850)', () => {
  it('still finds an associated doc via the mixin class when tx.objectClass is unrelated to the association', async () => {
    const { liveQuery, factory, close } = await getClient()

    const projectId = await createProject(factory, 'mixin-src')
    const { mock } = await subscribe(
      liveQuery,
      test.class.TestProject,
      { _id: projectId },
      {
        associations: [[test.association.ProjectHolder, 1]]
      }
    )

    const holderId = await createHolder(factory)
    await factory.createDoc(core.class.Relation, core.space.Model, {
      docA: projectId,
      docB: holderId,
      association: test.association.ProjectHolder
    })
    await settle()
    const before = mock.mock.calls.length

    // objectClass is deliberately test.class.TestComment - unrelated to the association's
    // classA (TestProject) / classB (ParticipantsHolder) - as if the caller reported a
    // symbolic/base class rather than the holder's real class. isPossibleAssociationTx's
    // byClass check is then false, so it must fall back to mixinTx.mixin: TestProjectMixin
    // extends TestProject (classA), so the tx is still recognized as relevant.
    // Widened to Doc on purpose: objectId and objectClass disagree here, which is the whole point.
    await factory.updateMixin<Doc, TestProjectMixin>(
      holderId,
      test.class.TestComment,
      core.space.Model,
      test.mixin.TestProjectMixin,
      { someField: 'hijacked' }
    )
    const result = await waitForNextCall(mock, before)

    const linked = result[0].$associations?.[`${test.association.ProjectHolder}_b`]?.[0]
    expect(linked?.[test.mixin.TestProjectMixin]?.someField).toBe('hijacked')

    await close()
  })

  it('falls through to false for a plain TxUpdateDoc unrelated to the association classes (L850)', async () => {
    const { liveQuery, factory, txErrors, close } = await getClient()

    const projectId = await createProject(factory, 'unrelated-tx-src')
    const { mock } = await subscribe(
      liveQuery,
      test.class.TestProject,
      { _id: projectId },
      {
        associations: [[test.association.ProjectHolder, 1]]
      }
    )
    const before = mock.mock.calls.length

    // TestComment relates to neither classA (TestProject) nor classB (ParticipantsHolder);
    // it's a plain TxUpdateDoc, so isPossibleAssociationTx falls through to `return false`.
    const space = await createSpace(factory, 'unrelated-tx-space')
    const comment = await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'unrelated'
    })
    await tick()
    await factory.updateDoc(test.class.TestComment, space, comment, { message: 'unrelated-updated' })
    await settle()

    // No association-relevant change, so our TestProject subscription must not be touched.
    expect(mock.mock.calls.length).toBe(before)
    expect(txErrors).toHaveLength(0)

    await close()
  })
})

describe('handleDocUpdateRelation: unknown association ref (index.ts L857)', () => {
  it('skips an association entry that does not resolve in the model, without crashing', async () => {
    const { liveQuery, factory, txErrors, close } = await getClient()

    const projectId = await createProject(factory, 'bogus-assoc-src')
    const bogusAssoc = generateId<Association>()
    const { mock } = await subscribe(
      liveQuery,
      test.class.TestProject,
      { _id: projectId },
      {
        associations: [[bogusAssoc, 1]]
      }
    )
    const before = mock.mock.calls.length

    await tick()
    await factory.updateDoc(test.class.TestProject, core.space.Model, projectId, { prjName: 'Renamed' })
    const result = await waitForNextCall(mock, before)

    expect(result[0].prjName).toBe('Renamed')
    expect(txErrors).toHaveLength(0)

    await close()
  })
})

describe('handleDocRemoveRelation / handleDocRemoveLookup: unrelated doc removal (index.ts L1406, L1414)', () => {
  it('does not refresh the query when an unrelated (non-Relation) doc is removed', async () => {
    const { liveQuery, factory, storage, close } = await getClient()

    let refreshCalls = 0
    const origFindAll = storage.findAll.bind(storage)
    storage.findAll = async <T extends Doc> (
      _class: Ref<Class<T>>,
      query: DocumentQuery<T>,
      options?: FindOptions<T>
    ): Promise<FindResult<T>> => {
      if ((_class as string) === (test.class.TestComment as string)) refreshCalls++
      return await origFindAll(_class, query, options)
    }

    const space = await createSpace(factory, 'remove-unrelated')
    const comment = await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'watcher'
    })

    // 'space' isn't derived from ParticipantsHolder (getLookupWays returns nothing on removal,
    // L1414) nor core.class.Relation (cleanup returns before refresh, L1406).
    await subscribe(
      liveQuery,
      test.class.TestComment,
      { _id: comment },
      {
        lookup: { space: core.class.Space },
        associations: [[test.association.ProjectHolder, 1]]
      }
    )

    const holderId = await createHolder(factory)
    refreshCalls = 0
    await factory.removeDoc(test.class.ParticipantsHolder, core.space.Model, holderId)
    await settle()

    expect(refreshCalls).toBe(0)

    await close()
  })
})
