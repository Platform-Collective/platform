// SPDX-License-Identifier: EPL-2.0

// The title of a document's metadata is kept as "<code> <title>" of the document.
// The metadata that receives it is the stored DocumentMeta the document belongs
// to, in the same space as the document. Anything else the document points to is
// left untouched.

import core from '@hcengineering/core'
import documents, { DocumentState } from '@hcengineering/controlled-documents'
import { OnDocHasBecomeEffective, OnDocTitleChanged } from '../index'

const SPACE = 'doc-space'
const OTHER_SPACE = 'other-space'
const DOC_CLASS: string = documents.class.ControlledDocument
const META_CLASS: string = documents.class.DocumentMeta
const ISSUE_CLASS = 'tracker:class:Issue'

function makeControl (docs: any[]): any {
  const findAll = jest.fn(async (_ctx: unknown, _class: unknown, q: any, opts?: any) => {
    const found = docs.filter((d) => {
      if (d._class !== _class) return false
      if (q._id !== undefined) return d._id === q._id
      // Older versions of the same document: none in these tests.
      return false
    })
    const limited = opts?.limit !== undefined ? found.slice(0, opts.limit) : found
    return limited.map((d) => structuredClone(d))
  })
  const txFactory = {
    createTxUpdateDoc: (_class: any, space: any, objectId: any, operations: any) => ({
      _class: core.class.TxUpdateDoc,
      objectClass: _class,
      objectSpace: space,
      objectId,
      operations
    })
  }
  const hierarchy = {
    isDerived: (a: unknown, b: unknown) => a === b,
    hasMixin: () => false
  }
  return { ctx: {}, findAll, txFactory, hierarchy, txes: [], removedMap: new Map() }
}

function draft (attachedTo: string, attachedToClass: string, extra: Record<string, unknown> = {}): any {
  return {
    _id: 'doc',
    _class: DOC_CLASS,
    space: SPACE,
    attachedTo,
    attachedToClass,
    collection: 'documents',
    code: 'DOC-1',
    title: 'Changed',
    state: DocumentState.Draft,
    template: null,
    seqNumber: 1,
    major: 0,
    minor: 1,
    patch: 0,
    ...extra
  }
}

function meta (_id: string, space: string = SPACE): any {
  return { _id, _class: META_CLASS, space, title: 'Original', documents: 1 }
}

function titleTx (): any {
  return {
    _id: 'tx-title',
    _class: core.class.TxUpdateDoc,
    objectId: 'doc',
    objectClass: DOC_CLASS,
    objectSpace: SPACE,
    operations: { title: 'Changed' }
  }
}

function metaWrites (res: any[]): any[] {
  return res.filter((tx) => tx.objectId !== 'doc')
}

describe('document metadata title', () => {
  it('writes "<code> <title>" to the stored metadata of a draft', async () => {
    const control = makeControl([draft('meta', META_CLASS), meta('meta')])

    const res = await OnDocTitleChanged([titleTx()], control)

    expect(res).toEqual([
      {
        _class: core.class.TxUpdateDoc,
        objectClass: META_CLASS,
        objectSpace: SPACE,
        objectId: 'meta',
        operations: { title: 'DOC-1 Changed' }
      }
    ])
  })

  it('leaves an issue untouched when a draft points to it', async () => {
    const issue = { _id: 'issue', _class: ISSUE_CLASS, space: OTHER_SPACE, title: 'Original' }
    const control = makeControl([draft('issue', ISSUE_CLASS), issue])

    const res = await OnDocTitleChanged([titleTx()], control)

    expect(metaWrites(res)).toEqual([])
  })

  it('leaves the target untouched when the stored target is not metadata', async () => {
    const issue = { _id: 'issue', _class: ISSUE_CLASS, space: SPACE, title: 'Original' }
    const control = makeControl([draft('issue', META_CLASS), issue])

    const res = await OnDocTitleChanged([titleTx()], control)

    expect(metaWrites(res)).toEqual([])
  })

  it('leaves metadata in another space untouched', async () => {
    const control = makeControl([draft('meta', META_CLASS), meta('meta', OTHER_SPACE)])

    const res = await OnDocTitleChanged([titleTx()], control)

    expect(metaWrites(res)).toEqual([])
  })

  it('leaves the target untouched when it does not exist', async () => {
    const control = makeControl([draft('missing', META_CLASS)])

    const res = await OnDocTitleChanged([titleTx()], control)

    expect(metaWrites(res)).toEqual([])
  })

  it('writes the title to the stored metadata when a document becomes effective', async () => {
    const control = makeControl([draft('meta', META_CLASS, { state: DocumentState.Effective }), meta('meta')])

    const res = await OnDocHasBecomeEffective([titleTx()], control)

    expect(metaWrites(res)).toEqual([
      {
        _class: core.class.TxUpdateDoc,
        objectClass: META_CLASS,
        objectSpace: SPACE,
        objectId: 'meta',
        operations: { title: 'DOC-1 Changed' }
      }
    ])
  })

  it('leaves an issue untouched when a document pointing to it becomes effective', async () => {
    const issue = { _id: 'issue', _class: ISSUE_CLASS, space: OTHER_SPACE, title: 'Original' }
    const control = makeControl([draft('issue', ISSUE_CLASS, { state: DocumentState.Effective }), issue])

    const res = await OnDocHasBecomeEffective([titleTx()], control)

    expect(metaWrites(res)).toEqual([])
  })
})
