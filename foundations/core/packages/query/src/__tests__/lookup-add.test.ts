// Lookup paths that only fire when a document is ADDED by tx (not from the initial findAll),
// and $push/$pull updates on a lookup array key.
//
// Copyright © 2024 Hardcore Engineering Inc.
//

import core, {
  createClient,
  generateId,
  Ref,
  TxOperations,
  type AttachedData,
  type Class,
  type Doc,
  type Space
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { AttachedComment, test } from './minmodel'

// `kids` is not part of the test model: it only has to exist and be truthy on the doc.
interface CommentWithKids extends AttachedComment {
  kids: number
}

async function getClient (): Promise<{ liveQuery: LiveQuery, factory: TxOperations, close: () => Promise<void> }> {
  const storage = await createClient(connect)
  const liveQuery = new LiveQuery(storage)
  storage.notify = (...tx) => {
    void liveQuery.tx(...tx)
  }
  return {
    liveQuery,
    factory: new TxOperations(storage, core.account.System),
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

// tx() is fired without being awaited by the client (see storage.notify above), so a plain
// fixed-delay sleep after a write is racy under load. Poll for the next callback instead.
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

// __updateLookup only runs when tx.modifiedOn exceeds the doc's stored value; same-millisecond
// writes take the refresh-from-server path, which can't resolve an array-of-refs lookup key.
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 2))
}

describe('LiveQuery lookup on doc ADD', () => {
  it('resolves a plain ref lookup for a document added after the query subscribed', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'add-plain-ref',
      description: '',
      private: false,
      members: [],
      archived: false
    })

    const { mock } = await subscribe(
      liveQuery,
      test.class.TestComment,
      { message: 'plain-ref-child' },
      {
        lookup: { space: core.class.Space }
      }
    )
    const before = mock.mock.calls.length

    await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'plain-ref-child'
    })
    const result = await waitForNextCall(mock, before)

    expect(result).toHaveLength(1)
    expect(result[0].$lookup?.space?.name).toBe('add-plain-ref')

    await close()
  })

  it('resolves an array-form lookup with a nested sub-lookup for a document added after subscribe', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'add-nested-space',
      description: '',
      private: false,
      members: [],
      archived: false
    })

    const parent = await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'parent'
    })

    const { mock } = await subscribe(
      liveQuery,
      test.class.TestComment,
      { message: 'nested-child' },
      {
        lookup: { attachedTo: [test.class.TestComment, { space: core.class.Space }] }
      }
    )
    const before = mock.mock.calls.length

    await factory.addCollection(test.class.TestComment, space, parent, test.class.TestComment, 'comments', {
      message: 'nested-child'
    })
    const result = await waitForNextCall(mock, before)

    expect(result).toHaveLength(1)
    const attachedTo = result[0].$lookup?.attachedTo
    expect(attachedTo?.message).toBe('parent')
    expect(attachedTo?.$lookup?.space?.name).toBe('add-nested-space')

    await close()
  })

  it('resolves a reverse lookup for a document added after subscribe, picking up a pre-existing child', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'add-reverse',
      description: '',
      private: false,
      members: [],
      archived: false
    })

    // Reference the parent's id before the parent itself exists.
    const parentId = generateId<AttachedComment>()
    await factory.addCollection(test.class.TestComment, space, parentId, test.class.TestComment, 'comments', {
      message: 'pre-existing-child'
    })

    const { mock } = await subscribe(
      liveQuery,
      test.class.TestComment,
      { message: 'reverse-parent' },
      {
        lookup: { _id: { kids: test.class.TestComment } }
      }
    )
    const before = mock.mock.calls.length

    // Set truthy so getReverseLookupValue does not skip it. Via a variable, otherwise the
    // excess-property check rejects `kids` against the declared AttachedComment.
    const parentAttrs: AttachedData<CommentWithKids> = { message: 'reverse-parent', kids: 1 }
    await factory.addCollection(
      test.class.TestComment,
      space,
      space,
      core.class.Space,
      'comments',
      parentAttrs,
      parentId
    )
    const result = await waitForNextCall(mock, before)

    expect(result).toHaveLength(1)
    expect(result[0].$lookup?.kids).toHaveLength(1)
    expect(result[0].$lookup?.kids[0].message).toBe('pre-existing-child')

    await close()
  })

  it('skips a lookup key whose reference is undefined for a document added after subscribe', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'add-null-ref',
      description: '',
      private: false,
      members: [],
      archived: false
    })

    const { mock } = await subscribe(
      liveQuery,
      test.class.TestComment,
      { message: 'null-ref-child' },
      {
        lookup: { forwardedMessage: test.class.TestComment }
      }
    )
    const before = mock.mock.calls.length

    await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'null-ref-child'
    })
    const result = await waitForNextCall(mock, before)

    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('null-ref-child')
    expect(result[0].$lookup?.forwardedMessage).toBeUndefined()

    await close()
  })

  it('backfills a plain ref lookup on an existing result once the referenced doc is created', async () => {
    const { liveQuery, factory, close } = await getClient()

    // Comment references a space id that does not exist yet.
    const spaceId = generateId<Space>()
    const comment = await factory.addCollection(
      test.class.TestComment,
      spaceId,
      spaceId,
      core.class.Space,
      'comments',
      {
        message: 'waiting-for-space'
      }
    )

    const { mock } = await subscribe(
      liveQuery,
      test.class.TestComment,
      { _id: comment },
      {
        lookup: { space: core.class.Space }
      }
    )
    expect(last(mock)[0].$lookup?.space).toBeUndefined()
    const before = mock.mock.calls.length

    await factory.createDoc(
      core.class.Space,
      core.space.Model,
      { name: 'now-exists', description: '', private: false, members: [], archived: false },
      spaceId
    )
    const result = await waitForNextCall(mock, before)

    expect(result[0].$lookup?.space?.name).toBe('now-exists')

    await close()
  })
})

describe('LiveQuery __updateLookup $push/$pull', () => {
  async function createHolder (factory: TxOperations): Promise<{ holderSpace: Ref<Space>, holder: Ref<Doc> }> {
    const holderSpace = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'holder-space',
      description: '',
      private: false,
      members: [],
      archived: false
    })
    const holder = await factory.createDoc(test.class.ParticipantsHolder, holderSpace, { participants: [] })
    return { holderSpace, holder }
  }

  it('fills a $push lookup with an array of ids', async () => {
    const { liveQuery, factory, close } = await getClient()

    const p1 = await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'proj-1',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'Project One'
    })
    const p2 = await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'proj-2',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'Project Two'
    })

    const { holderSpace, holder } = await createHolder(factory)

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
    await factory.updateDoc(test.class.ParticipantsHolder, holderSpace, holder, {
      $push: { participants: [p1, p2] }
    })
    const result = await waitForNextCall(mock, before)

    const names = (result[0].$lookup?.participants ?? []).map((d: any) => d.prjName).sort()
    expect(names).toEqual(['Project One', 'Project Two'])

    await close()
  })

  it('fills a $push lookup with a single id', async () => {
    const { liveQuery, factory, close } = await getClient()

    const p3 = await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'proj-3',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'Project Three'
    })

    const { holderSpace, holder } = await createHolder(factory)

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
    await factory.updateDoc(test.class.ParticipantsHolder, holderSpace, holder, {
      $push: { participants: p3 }
    })
    const result = await waitForNextCall(mock, before)

    expect(result[0].$lookup?.participants).toHaveLength(1)
    expect(result[0].$lookup?.participants[0].prjName).toBe('Project Three')

    await close()
  })

  it('removes items from a $push-filled lookup via $pull, both single id and array of ids', async () => {
    const { liveQuery, factory, close } = await getClient()

    const p1 = await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'proj-a',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'Project A'
    })
    const p2 = await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'proj-b',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'Project B'
    })
    const p3 = await factory.createDoc(test.class.TestProject, core.space.Model, {
      name: 'proj-c',
      description: '',
      private: false,
      members: [],
      archived: false,
      prjName: 'Project C'
    })

    const { holderSpace, holder } = await createHolder(factory)

    const { mock } = await subscribe(
      liveQuery,
      test.class.ParticipantsHolder,
      { _id: holder },
      {
        lookup: { participants: test.class.TestProject }
      }
    )
    let before = mock.mock.calls.length

    await tick()
    await factory.updateDoc(test.class.ParticipantsHolder, holderSpace, holder, {
      $push: { participants: [p1, p2, p3] }
    })
    let result = await waitForNextCall(mock, before)
    expect(result[0].$lookup?.participants).toHaveLength(3)

    before = mock.mock.calls.length
    await tick()
    await factory.updateDoc(test.class.ParticipantsHolder, holderSpace, holder, {
      $pull: { participants: p1 }
    })
    result = await waitForNextCall(mock, before)

    const names = result[0].$lookup?.participants.map((d: any) => d.prjName).sort()
    expect(names).toEqual(['Project B', 'Project C'])

    before = mock.mock.calls.length
    await tick()
    await factory.updateDoc(test.class.ParticipantsHolder, holderSpace, holder, {
      $pull: { participants: [p2, p3] }
    })
    result = await waitForNextCall(mock, before)

    expect(result[0].$lookup?.participants).toHaveLength(0)

    await close()
  })
})
