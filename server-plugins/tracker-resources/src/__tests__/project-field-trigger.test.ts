//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import core, { type Ref, type Space, type Tx } from '@hcengineering/core'
import tracker, { MAX_PROJECT_FIELDS, ProjectFieldType } from '@hcengineering/tracker'

import { OnIterationRemove, OnProjectFieldCreate, OnProjectFieldRemove, OnProjectRemove } from '../index'

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

describe('OnProjectFieldRemove for an iteration field', () => {
  it('removes the iterations of the field and strips the values', async () => {
    const issues = [
      { _id: 'i1', _class: tracker.class.Issue, space: SPACE, customFields: { sprint: 'it1' } },
      { _id: 'i2', _class: tracker.class.Issue, space: SPACE, customFields: { other: 'x' } }
    ]
    const iterations = [
      { _id: 'it1', _class: tracker.class.Iteration, space: SPACE, field: 'field-1' },
      { _id: 'it2', _class: tracker.class.Iteration, space: SPACE, field: 'field-1' }
    ]
    const removed = new Map([['field-1', { _id: 'field-1', key: 'sprint', type: ProjectFieldType.Iteration, space: SPACE }]])
    const res: any[] = await OnProjectFieldRemove(
      [{ objectId: 'field-1' } as unknown as Tx],
      makeControl({ [tracker.class.Issue]: issues, [tracker.class.Iteration]: iterations }, removed)
    )
    expect(res.filter((r) => r.kind === 'remove').map((r) => r.id)).toEqual(['it1', 'it2'])
    const updates = res.filter((r) => r.kind === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].update).toEqual({ customFields: {} })
  })

  it('does not look for iterations of other field types', async () => {
    const iterations = [{ _id: 'it1', _class: tracker.class.Iteration, space: SPACE, field: 'field-1' }]
    const removed = new Map([['field-1', { _id: 'field-1', key: 'size', type: ProjectFieldType.Number, space: SPACE }]])
    const res = await OnProjectFieldRemove(
      [{ objectId: 'field-1' } as unknown as Tx],
      makeControl({ [tracker.class.Iteration]: iterations }, removed)
    )
    expect(res).toEqual([])
  })
})

describe('OnIterationRemove', () => {
  const issues = [
    { _id: 'i1', _class: tracker.class.Issue, space: SPACE, customFields: { sprint: 'it1', team: 'a' } },
    { _id: 'i2', _class: tracker.class.Issue, space: SPACE, customFields: { sprint: 'it2' } },
    { _id: 'i3', _class: tracker.class.Issue, space: SPACE, customFields: { sprint: 'it3' } },
    { _id: 'i4', _class: tracker.class.Issue, space: SPACE }
  ]
  const sprintField = { _id: 'field-1', key: 'sprint', type: ProjectFieldType.Iteration, space: SPACE }
  const removedIteration = (id: string, field = 'field-1'): [string, any] => [
    id,
    { _id: id, _class: tracker.class.Iteration, space: SPACE, field }
  ]

  it('strips the deleted iteration from the issues that were in it', async () => {
    const removed = new Map([removedIteration('it1')])
    const res: any[] = await OnIterationRemove(
      [{ objectId: 'it1' } as unknown as Tx],
      makeControl({ [tracker.class.Issue]: issues, [tracker.class.ProjectField]: [sprintField] }, removed)
    )
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('i1')
    expect(res[0].update).toEqual({ customFields: { team: 'a' } })
  })

  it('handles several iterations removed together with one update per issue', async () => {
    const removed = new Map([removedIteration('it1'), removedIteration('it2')])
    const res: any[] = await OnIterationRemove(
      [{ objectId: 'it1' }, { objectId: 'it2' }] as unknown as Tx[],
      makeControl({ [tracker.class.Issue]: issues, [tracker.class.ProjectField]: [sprintField] }, removed)
    )
    expect(res.map((r) => r.id).sort()).toEqual(['i1', 'i2'])
  })

  it('leaves the issues alone when the owning field is gone', async () => {
    const removed = new Map([removedIteration('it1')])
    const res = await OnIterationRemove(
      [{ objectId: 'it1' } as unknown as Tx],
      makeControl({ [tracker.class.Issue]: issues, [tracker.class.ProjectField]: [] }, removed)
    )
    expect(res).toEqual([])
  })

  it('does nothing for an unknown removed doc', async () => {
    const res = await OnIterationRemove([{ objectId: 'zzz' } as unknown as Tx], makeControl({}))
    expect(res).toEqual([])
  })
})

describe('OnProjectRemove', () => {
  it('removes the iterations together with the rest of the project', async () => {
    const iterations = [{ _id: 'it1', _class: tracker.class.Iteration, space: SPACE }]
    const control = makeControl({ [tracker.class.Iteration]: iterations })
    control.ctx = { contextData: { broadcast: { targets: {} } } }
    const res: any[] = await OnProjectRemove([{ objectId: SPACE } as unknown as Tx], control)
    expect(res.map((r) => r.id)).toEqual(['it1'])
  })
})
