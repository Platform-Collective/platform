// SPDX-License-Identifier: EPL-2.0

import core, { Hierarchy, type Doc, type Ref } from '@hcengineering/core'
import { clearOptimisticCreate, isOptimisticCreate, markOptimisticCreate } from '../optimistic'
import { Refs } from '../refs'
import { ResultArray } from '../results'
import type { Query } from '../types'
import { genMinModel } from './minmodel'

function document (id: string, modifiedOn: number): Doc {
  return {
    _id: id as Ref<Doc>,
    _class: core.class.Doc,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn
  }
}

function query (hierarchy: Hierarchy, id: number): Query {
  return {
    id,
    _class: core.class.Doc,
    query: {},
    result: new ResultArray([], hierarchy),
    total: 0,
    callbacks: new Map(),
    refresh: async () => {},
    refreshId: 0,
    pendingCreates: new Map(),
    refsRegistered: false
  }
}

describe('create confirmation cache revisions', () => {
  let hierarchy: Hierarchy
  let refs: Refs

  beforeEach(() => {
    hierarchy = new Hierarchy()
    for (const tx of genMinModel()) {
      hierarchy.tx(tx)
    }
    refs = new Refs(() => hierarchy)
  })

  it('only moves the reconciled optimistic cache entry backwards', () => {
    const own = document('own', 500)
    const other = document('other', 600)
    markOptimisticCreate(own)
    markOptimisticCreate(other)
    const first = query(hierarchy, 1)
    const second = query(hierarchy, 2)
    refs.updateDocuments(first, [own, other])
    refs.updateDocuments(second, [own, other])

    refs.updateDocuments(second, [document('own', 100), document('other', 200)], false, own._id)

    expect(refs.findFromDocs(core.class.Doc, { _id: own._id })?.[0].modifiedOn).toBe(100)
    expect(refs.findFromDocs(core.class.Doc, { _id: other._id })?.[0].modifiedOn).toBe(600)
  })

  it('tracks in-place skewed edits before timestamp reconciliation', () => {
    const own = { ...document('own', 500), createdOn: 500 }
    markOptimisticCreate(own)
    const first = query(hierarchy, 1)
    refs.updateDocuments(first, [own])

    clearOptimisticCreate(own)
    own.modifiedOn = 200
    refs.updateDocuments(first, [own])
    refs.updateDocuments(first, [{ ...own, createdOn: 100 }], false, own._id)

    expect(refs.findFromDocs(core.class.Doc, { _id: own._id })?.[0]).toMatchObject({
      createdOn: 100,
      modifiedOn: 200
    })
  })

  it('only releases membership when cleaning a discarded optimistic copy', () => {
    const own = document('own', 500)
    markOptimisticCreate(own)
    const retained = query(hierarchy, 1)
    const departing = query(hierarchy, 2)
    refs.updateDocuments(retained, [own])
    refs.updateDocuments(departing, [own])
    refs.updateDocuments(retained, [document('own', 100)], false, own._id)

    refs.updateDocuments(departing, [own], true)

    const cached = refs.findFromDocs(core.class.Doc, { _id: own._id })?.[0]
    expect(cached?.modifiedOn).toBe(100)
    if (cached === undefined) throw new Error('Expected a retained authoritative cache copy')
    expect(isOptimisticCreate(cached)).toBe(false)
    refs.updateDocuments(retained, [cached], true)
    expect(refs.findFromDocs(core.class.Doc, { _id: own._id })).toBeNull()
  })

  it('preserves provenance when stripping lookup data from a cached copy', () => {
    const own = { ...document('own', 500), $lookup: {} }
    markOptimisticCreate(own)
    const first = query(hierarchy, 1)
    first.options = { lookup: { space: core.class.Space } }
    refs.updateDocuments(first, [own])

    const copy = refs.findFromDocs(core.class.Doc, {}, { limit: 1 })?.[0]
    expect(copy).toBeDefined()
    if (copy === undefined) throw new Error('Expected an optimistic cache copy')
    expect(copy).not.toBe(own)
    expect(copy.$lookup).toBeUndefined()
    expect(isOptimisticCreate(copy)).toBe(true)
    expect(isOptimisticCreate(document('own', 500))).toBe(false)
  })

  it('does not downgrade a newer server copy of the reconciled document', () => {
    const own = document('own', 500)
    const first = query(hierarchy, 1)
    const second = query(hierarchy, 2)
    refs.updateDocuments(first, [own])
    refs.updateDocuments(second, [document('own', 100)], false, own._id)

    expect(refs.findFromDocs(core.class.Doc, { _id: own._id })?.[0].modifiedOn).toBe(500)
    // The second query still holds the newer cached revision when the first query leaves.
    refs.updateDocuments(first, [own], true)
    expect(refs.findFromDocs(core.class.Doc, { _id: own._id })?.[0].modifiedOn).toBe(500)
  })
})
