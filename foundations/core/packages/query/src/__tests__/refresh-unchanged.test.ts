//
// Copyright © 2026 Intabia Fusion.
//

import core, {
  createClient,
  generateId,
  TxOperations,
  WorkspaceEvent,
  type Tx,
  type TxWorkspaceEvent
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { test } from './minmodel'

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('refresh with unchanged result', () => {
  it('does not call the subscriber again when the refetch returns the same docs', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    storage.notify = (...tx: Tx[]) => {
      void liveQuery.tx(...tx)
    }
    const factory = new TxOperations(storage, core.account.System)
    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'refresh-same',
      description: '',
      private: false,
      members: [],
      archived: false
    })
    await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'first'
    })

    let calls = 0
    const unsubscribe = liveQuery.query(test.class.TestComment, {}, () => {
      calls++
    })
    await settle()
    expect(calls).toBe(1)

    const event: TxWorkspaceEvent = {
      _id: generateId(),
      _class: core.class.TxWorkspaceEvent,
      space: core.space.DerivedTx,
      modifiedOn: Date.now(),
      modifiedBy: core.account.System,
      objectSpace: space,
      event: WorkspaceEvent.BulkUpdate,
      params: { _class: [test.class.TestComment] }
    }
    await liveQuery.tx(event)
    await settle()

    expect(calls).toBe(1)
    unsubscribe()
  })
})
