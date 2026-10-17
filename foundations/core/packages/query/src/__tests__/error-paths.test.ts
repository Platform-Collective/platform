// Remaining TxMixin / Tx-subscription branch coverage.
//
// Copyright © 2026 Intabia Fusion.
//

import core, { createClient, TxOperations, type Class, type Doc, type Ref, type Space } from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { test } from './minmodel'

async function getClient (): Promise<{ liveQuery: LiveQuery, factory: TxOperations }> {
  const storage = await createClient(connect)
  const liveQuery = new LiveQuery(storage)
  storage.notify = (...tx) => {
    void liveQuery.tx(...tx)
  }
  return { liveQuery, factory: new TxOperations(storage, core.account.System) }
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

// Subscribe and resolve once the first callback fires. Returns an unsubscribe handle.
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

interface TestProject extends Space {
  prjName: string
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

describe('txMixin isTx branch', () => {
  it('adds the mixin tx itself to a query subscribed on a Tx class', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'tx-mixin-doc')

    const q = await subscribe<any>(liveQuery, core.class.TxMixin, {})
    expect(q.last().length).toBe(0)

    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'as-tx'
    })
    await settle()

    expect(q.last().length).toBe(1)
    expect(q.last()[0]?.mixin).toBe(test.mixin.TestProjectMixin)
    expect(q.last()[0]?.objectId).toBe(id)

    q.unsubscribe()
  })
})

describe('__updateMixinDoc', () => {
  it('merges mixin attributes onto an already-cached doc when the tx is strictly newer', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'mixin-merge')

    const q = await subscribe<any>(liveQuery, test.class.TestProject, { _id: id })
    expect(q.last()[0]?.[test.mixin.TestProjectMixin]).toBeUndefined()

    // Date.now() has ms resolution - without a delay the mixin tx can land in the same
    // millisecond as the createDoc and take the getCurrentDoc branch instead.
    await new Promise((resolve) => setTimeout(resolve, 3))

    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'merged-in'
    })
    await settle()

    expect(q.last()[0]?.[test.mixin.TestProjectMixin]?.someField).toBe('merged-in')

    q.unsubscribe()
  })
})

describe('txRemoveDoc isTx branch', () => {
  it('adds the remove tx itself to a query subscribed on a Tx class', async () => {
    const { liveQuery, factory } = await getClient()
    const id = await createProject(factory, 'tx-remove-doc')

    const q = await subscribe<any>(liveQuery, core.class.TxRemoveDoc, {})
    expect(q.last().length).toBe(0)

    await factory.removeDoc(test.class.TestProject, core.space.Model, id)
    await settle()

    expect(q.last().length).toBe(1)
    expect(q.last()[0]?.objectId).toBe(id)

    q.unsubscribe()
  })
})
