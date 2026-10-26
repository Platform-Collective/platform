// SPDX-License-Identifier: EPL-2.0

import core, { Hierarchy, type Doc, type Ref } from '@hcengineering/core'
import { clearOptimisticCreate, markOptimisticCreate } from '../optimistic'
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
