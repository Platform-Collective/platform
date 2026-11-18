//
// Copyright © 2026 Hardcore Engineering Inc.
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
  type AttachedDoc,
  type Class,
  type Doc,
  type Domain,
  MeasureMetricsContext,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxUpdateDoc,
  TxFactory
} from '@hcengineering/core'
import type { SessionFindAll } from '@hcengineering/server-core'
import { TriggersMiddleware } from '../triggers'

const PARENT_CLASS = 'test:class:Parent' as Ref<Class<Doc>>
const CHILD_CLASS = 'test:class:Child' as Ref<Class<AttachedDoc>>
const SPACE = 'test:space:Space' as Ref<Space>
const PARENT = 'parent-1' as Ref<Doc>
const CHILD = 'child-1' as Ref<AttachedDoc>

const factory = new TxFactory('test-user' as PersonId)

function makeMiddleware (): TriggersMiddleware {
  // Avoid the constructor: it starts a cache cleanup interval and needs a full model.
  const middleware = Object.create(TriggersMiddleware.prototype) as TriggersMiddleware
  ;(middleware as any).context = {
    hierarchy: {
      getDomain: () => 'test' as Domain,
      getBaseClass: (_class: Ref<Class<Doc>>) => _class
    }
  }
  return middleware
}

function makeCtx (removed: Doc[] = []): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = { removedMap: new Map(removed.map((it) => [it._id, it])) } as any
  return ctx
}

const parentDoc: Doc = {
  _id: PARENT,
  _class: PARENT_CLASS,
  space: SPACE,
  modifiedBy: 'test-user' as PersonId,
  modifiedOn: 0
}

const childDoc: AttachedDoc = {
  ...parentDoc,
  _id: CHILD,
  _class: CHILD_CLASS,
  attachedTo: PARENT,
  attachedToClass: PARENT_CLASS,
  collection: 'replies'
}

const findAll: SessionFindAll = async (ctx, _class, query) => {
  return ((query as any)._id === PARENT ? [parentDoc] : []) as any
}

function removeChildTx (): Tx {
  return factory.createTxCollectionCUD(
    PARENT_CLASS,
    PARENT,
    SPACE,
    'replies',
    factory.createTxRemoveDoc(CHILD_CLASS, SPACE, CHILD)
  )
}

function createChildTx (): Tx {
  return factory.createTxCollectionCUD(
    PARENT_CLASS,
    PARENT,
    SPACE,
    'replies',
    factory.createTxCreateDoc(CHILD_CLASS, SPACE, {} as any, CHILD)
  )
}

async function processCollection (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<Tx[]> {
  return (makeMiddleware() as any).processCollection(ctx, txes, findAll)
}

function incOf (tx: Tx): number {
  expect(tx._class).toBe(core.class.TxUpdateDoc)
  const utx = tx as TxUpdateDoc<Doc>
  expect(utx.objectId).toBe(PARENT)
  return (utx.operations as any).$inc.replies
}

describe('TriggersMiddleware collection counters', () => {
  it('increments the counter on create', async () => {
    const result = await processCollection(makeCtx(), [createChildTx()])
    expect(result).toHaveLength(1)
    expect(incOf(result[0])).toBe(1)
  })

  it('decrements the counter when an existing document is removed', async () => {
    const result = await processCollection(makeCtx([childDoc]), [removeChildTx()])
    expect(result).toHaveLength(1)
    expect(incOf(result[0])).toBe(-1)
  })

  it('does not decrement the counter when the document was already removed', async () => {
    // The document was not found by DomainTxMiddleware, so it is not in removedMap.
    const result = await processCollection(makeCtx(), [removeChildTx()])
    expect(result).toHaveLength(0)
  })

  it('decrements only once for a duplicate remove in the same batch', async () => {
    const result = await processCollection(makeCtx([childDoc]), [removeChildTx(), removeChildTx()])
    expect(result).toHaveLength(1)
    expect(incOf(result[0])).toBe(-1)
  })

  it('counts a create and a remove of the same document in one batch', async () => {
    // removedMap is filled before the batch is applied, so a document created in the batch is not there.
    const result = await processCollection(makeCtx(), [createChildTx(), removeChildTx(), removeChildTx()])
    expect(result.map(incOf)).toEqual([1, -1])
  })

  it('counts create, remove, create, remove of the same document in one batch', async () => {
    const result = await processCollection(makeCtx(), [
      createChildTx(),
      removeChildTx(),
      createChildTx(),
      removeChildTx()
    ])
    expect(result.map(incOf)).toEqual([1, -1, 1, -1])
  })

  it('does not update the counter of a removed parent', async () => {
    const result = await processCollection(makeCtx([parentDoc, childDoc]), [removeChildTx()])
    expect(result).toHaveLength(0)
  })
})
