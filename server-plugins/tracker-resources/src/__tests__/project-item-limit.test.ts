//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import core, { type Ref, type Space, type Tx } from '@hcengineering/core'
import tracker, { MAX_PROJECT_ITEMS } from '@hcengineering/tracker'

import { OnProjectItemLimit } from '../index'
import { makeControl } from './mockControl'

const SPACE = 'project-1' as Ref<Space>
const OTHER = 'project-2' as Ref<Space>

function createTx (id: string, space: Ref<Space> = SPACE, objectClass: string = tracker.class.Issue): Tx {
  return { _class: core.class.TxCreateDoc, objectId: id, objectClass, objectSpace: space } as unknown as Tx
}

// A project that holds `count` issues, without building 50,000 documents: the trigger only asks for the total
function projectWith (count: number, space: Ref<Space> = SPACE): any {
  const docs: any[] = []
  const control = makeControl({ docs: { [tracker.class.Issue]: docs } })
  const findAll = control.findAll
  control.findAll = async (ctx: unknown, cls: string, query: any, options: any) => {
    const res = await findAll(ctx, cls, query, options)
    if (cls === tracker.class.Issue && options?.total === true && query.space === space) (res as any).total = count
    return res
  }
  return control
}

describe('OnProjectItemLimit', () => {
  it('lets a project below the limit grow', async () => {
    expect(await OnProjectItemLimit([createTx('i1')], projectWith(MAX_PROJECT_ITEMS - 1))).toEqual([])
  })

  it('lets a project grow up to the limit', async () => {
    expect(await OnProjectItemLimit([createTx('i1')], projectWith(MAX_PROJECT_ITEMS))).toEqual([])
  })

  it('removes the issue that goes over the limit', async () => {
    const res: any[] = await OnProjectItemLimit([createTx('i1')], projectWith(MAX_PROJECT_ITEMS + 1))
    expect(res).toHaveLength(1)
    expect(res[0]._class).toBe(core.class.TxRemoveDoc)
    expect(res[0].objectId).toBe('i1')
    expect(res[0].objectClass).toBe(tracker.class.Issue)
    expect(res[0].objectSpace).toBe(SPACE)
  })

  it('removes only the newest issues of a batch, as many as exceed the limit', async () => {
    const txes = [createTx('i1'), createTx('i2'), createTx('i3')]
    const res: any[] = await OnProjectItemLimit(txes, projectWith(MAX_PROJECT_ITEMS + 2))
    expect(res.map((r) => r.objectId)).toEqual(['i2', 'i3'])
  })

  it('never removes issues that existed before the batch', async () => {
    const res: any[] = await OnProjectItemLimit([createTx('i1')], projectWith(MAX_PROJECT_ITEMS + 500))
    expect(res.map((r) => r.objectId)).toEqual(['i1'])
  })

  it('counts every project on its own', async () => {
    const control = projectWith(MAX_PROJECT_ITEMS + 1, OTHER)
    const res: any[] = await OnProjectItemLimit([createTx('i1', SPACE), createTx('i2', OTHER)], control)
    // the mock answers the real (empty) count for the first project and the full one for the second
    expect(res.map((r) => r.objectId)).toEqual(['i2'])
    expect(res[0].objectSpace).toBe(OTHER)
  })

  it('ignores other documents and other kinds of transactions', async () => {
    const control = projectWith(MAX_PROJECT_ITEMS + 10)
    const update = { _class: core.class.TxUpdateDoc, objectId: 'i9', objectClass: tracker.class.Issue, objectSpace: SPACE }
    expect(await OnProjectItemLimit([createTx('c1', SPACE, tracker.class.Component), update as any], control)).toEqual([])
  })

  it('asks only for the count of the issues, not for the issues', async () => {
    const calls: any[] = []
    const control = makeControl({ docs: {}, calls })
    await OnProjectItemLimit([createTx('i1')], control)
    expect(calls).toEqual([
      { _class: tracker.class.Issue, query: { space: SPACE }, options: { limit: 1, total: true, projection: { _id: 1 } } }
    ])
  })
})
