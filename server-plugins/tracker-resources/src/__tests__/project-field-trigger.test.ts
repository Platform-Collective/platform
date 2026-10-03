//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import core, { type Ref, type Space, type Tx } from '@hcengineering/core'
import tracker, { MAX_PROJECT_FIELDS } from '@hcengineering/tracker'

import { OnProjectFieldCreate, OnProjectFieldRemove } from '../index'

const SPACE = 'project-1' as Ref<Space>

function makeControl (docs: Record<string, any[]>, removed: Map<any, any> = new Map()): any {
  return {
    ctx: {},
    removedMap: removed,
    findAll: async (_ctx: unknown, cls: string) => docs[cls] ?? [],
    txFactory: {
      createTxRemoveDoc: (_class: string, space: string, id: string) => ({ kind: 'remove', _class, space, id }),
      createTxUpdateDoc: (_class: string, space: string, id: string, update: any) => ({
        kind: 'update',
        _class,
        space,
        id,
        update
      })
    }
  }
}

describe('OnProjectFieldCreate', () => {
  const createTx = { _class: core.class.TxCreateDoc, objectSpace: SPACE } as unknown as Tx

  it('keeps everything at the limit', async () => {
    const fields = Array.from({ length: MAX_PROJECT_FIELDS }, (_, i) => ({ _id: `f${i}`, createdOn: i, space: SPACE }))
    const res = await OnProjectFieldCreate([createTx], makeControl({ [tracker.class.ProjectField]: fields }))
    expect(res).toEqual([])
  })

  it('removes the newest fields beyond the limit', async () => {
    const fields = Array.from({ length: MAX_PROJECT_FIELDS + 2 }, (_, i) => ({
      _id: `f${i}`,
      _class: tracker.class.ProjectField,
      createdOn: i,
      space: SPACE
    }))
    const res: any[] = await OnProjectFieldCreate([createTx], makeControl({ [tracker.class.ProjectField]: fields }))
    expect(res.map((r) => r.id)).toEqual([`f${MAX_PROJECT_FIELDS}`, `f${MAX_PROJECT_FIELDS + 1}`])
  })
})

describe('OnProjectFieldRemove', () => {
  it('strips the value from issues that have it and skips the rest', async () => {
    const issues = [
      { _id: 'i1', _class: tracker.class.Issue, space: SPACE, customFields: { size: 3, team: 'a' } },
      { _id: 'i2', _class: tracker.class.Issue, space: SPACE, customFields: { team: 'b' } },
      { _id: 'i3', _class: tracker.class.Issue, space: SPACE }
    ]
    const removed = new Map([['field-1', { _id: 'field-1', key: 'size', space: SPACE }]])
    const tx = { objectId: 'field-1' } as unknown as Tx
    const res: any[] = await OnProjectFieldRemove([tx], makeControl({ [tracker.class.Issue]: issues }, removed))
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('i1')
    expect(res[0].update).toEqual({ customFields: { team: 'a' } })
  })

  it('does nothing when the removed doc is unknown', async () => {
    const res = await OnProjectFieldRemove([{ objectId: 'x' } as unknown as Tx], makeControl({}))
    expect(res).toEqual([])
  })
})
