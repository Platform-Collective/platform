//
// Copyright © 2020 Anticrm Platform Contributors.
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

import { MeasureMetricsContext } from '@hcengineering/measurements'
import type { IntlString } from '@hcengineering/platform'
import { PlatformError } from '@hcengineering/platform'
import { type Client, type DomainParams, type DomainRequestOptions, type DomainResult } from '..'
import type { Class, Doc, Obj, Mixin, OperationDomain, PersonId, Ref, Space } from '../classes'
import { ClassifierKind } from '../classes'
import core from '../component'
import { Hierarchy } from '../hierarchy'
import { ModelDb, TxDb } from '../memdb'
import { TxOperations } from '../operations'
import {
  type DocumentQuery,
  type FindOptions,
  type FindPageOptions,
  type FindPageResult,
  type IterateOptions,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  SortingOrder,
  type WithLookup
} from '../storage'
import { TxFactory, type DocumentUpdate, type Tx, type TxCreateDoc, type TxMixin, type TxUpdateDoc } from '../tx'
import { createDoc, genMinModel, test, updateDoc, type TestMixin } from './minmodel'

const txes = genMinModel()

class ClientModel extends ModelDb implements Client {
  notify?: ((...tx: Tx[]) => void) | undefined

  getHierarchy (): Hierarchy {
    return this.hierarchy
  }

  getModel (): ModelDb {
    return this
  }

  async findOne<T extends Doc> (
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<WithLookup<T> | undefined> {
    return (await this.findAll(_class, query, options)).shift()
  }

  async findAllPage<T extends Doc> (
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options: FindPageOptions<T>
  ): Promise<FindPageResult<T>> {
    const { cursor, limit, ...findOptions } = options
    const docs = await this.findAll(_class, query, findOptions)
    const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10)
    const start = Number.isNaN(offset) ? 0 : offset
    const pageDocs = docs.slice(start, start + limit)
    const nextOffset = start + pageDocs.length
    return {
      docs: pageDocs,
      nextCursor: nextOffset < docs.length ? String(nextOffset) : undefined,
      total: options.total === true ? docs.length : undefined
    }
  }

  async *iterateAll<T extends Doc> (
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: IterateOptions<T>
  ): AsyncIterable<WithLookup<T>> {
    let cursor: string | undefined
    do {
      const page = await this.findAllPage(_class, query, {
        ...options,
        limit: options?.limit ?? 500,
        cursor
      })
      yield* page.docs
      cursor = page.nextCursor
    } while (cursor !== undefined)
  }

  async searchFulltext (query: SearchQuery, options: SearchOptions): Promise<SearchResult> {
    return { docs: [] }
  }

  async domainRequest<T> (
    domain: OperationDomain,
    params: DomainParams,
    options?: DomainRequestOptions
  ): Promise<DomainResult<T>> {
    return { domain, value: null as any }
  }

  async close (): Promise<void> {}
}

async function createModel (modelTxes: Tx[] = txes): Promise<{ model: ClientModel, hierarchy: Hierarchy, txDb: TxDb }> {
  const hierarchy = new Hierarchy()
  for (const tx of modelTxes) {
    hierarchy.tx(tx)
  }
  const model = new ClientModel(hierarchy)
  for (const tx of modelTxes) {
    await model.tx(tx)
  }
  const txDb = new TxDb(hierarchy)
  for (const tx of modelTxes) await txDb.tx(tx)
  return { model, hierarchy, txDb }
}

describe('memdb', () => {
  it('should save all tx', async () => {
    const { txDb } = await createModel()

    const result = await txDb.findAll(core.class.Tx, {})
    expect(result.length).toBe(txes.length)
  })

  it('should create space', async () => {
    const { model } = await createModel()

    const client = new TxOperations(model, core.account.System)
    const result = await client.findAll(core.class.Space, {})
    expect(result).toHaveLength(2)

    await client.createDoc(core.class.Space, core.space.Model, {
      private: false,
      name: 'NewSpace',
      description: '',
      members: [],
      archived: false
    })
    const result2 = await client.findAll(core.class.Space, {})
    expect(result2).toHaveLength(3)

    await client.createDoc(core.class.Space, core.space.Model, {
      private: false,
      name: 'NewSpace',
      description: '',
      members: [],
      archived: false
    })
    const result3 = await client.findAll(core.class.Space, {})
    expect(result3).toHaveLength(4)
  })

  it('should query model', async () => {
    const { model } = await createModel()
    const result = await model.findAll(core.class.Class, {})
    const names = result.map((d) => d._id)
    expect(names.includes(core.class.Class)).toBe(true)
    const result2 = await model.findAll(core.class.Class, { _id: undefined })
    expect(result2.length).toBe(0)
  })

  it('should fail query wrong class', async () => {
    const { model } = await createModel()

    await expect(model.findAll('class:workbench.Application' as Ref<Class<Doc>>, { _id: undefined })).rejects.toThrow()
  })

  it('should create mixin', async () => {
    const { model } = await createModel()
    const ops = new TxOperations(model, core.account.System)

    await ops.createMixin<Doc, TestMixin>(core.class.Obj, core.class.Class, core.space.Model, test.mixin.TestMixin, {
      arr: ['hello']
    })
    const objClass = (await model.findAll(core.class.Class, { _id: core.class.Obj }))[0] as any
    expect(objClass['test:mixin:TestMixin'].arr).toEqual(expect.arrayContaining(['hello']))
  })

  it('should allow delete', async () => {
    const { model } = await createModel()
    const result = await model.findAll(core.class.Space, {})
    expect(result.length).toBe(2)

    const ops = new TxOperations(model, core.account.System)
    await ops.removeDoc(result[0]._class, result[0].space, result[0]._id)
    const result2 = await model.findAll(core.class.Space, {})
    expect(result2).toHaveLength(1)
  })

  it('should query model with params', async () => {
    const { model } = await createModel()
    const first = await model.findAll(core.class.Class, {
      _id: txes[1].objectId as Ref<Class<Obj>>,
      kind: 0
    })
    expect(first.length).toBe(1)
    const second = await model.findAll(core.class.Class, {
      _id: { $in: [txes[1].objectId as Ref<Class<Obj>>, txes[3].objectId as Ref<Class<Obj>>] }
    })
    expect(second.length).toBe(2)
    const incorrectId = await model.findAll(core.class.Class, {
      _id: (txes[1].objectId + 'test') as Ref<Class<Obj>>
    })
    expect(incorrectId.length).toBe(0)
    const result = await model.findAll(core.class.Class, {
      _id: txes[1].objectId as Ref<Class<Obj>>,
      kind: 1
    })
    expect(result.length).toBe(0)
    const multipleParam = await model.findAll(core.class.Doc, {
      space: { $in: [core.space.Model, core.space.Tx] }
    })
    expect(multipleParam.length).toBeGreaterThan(5)

    const classes = await model.findAll(core.class.Class, {})
    const gt = await model.findAll(core.class.Class, {
      kind: { $gt: 1 }
    })
    expect(gt.length).toBe(classes.filter((p) => p.kind > 1).length)
    const gte = await model.findAll(core.class.Class, {
      kind: { $gte: 1 }
    })
    expect(gte.length).toBe(classes.filter((p) => p.kind >= 1).length)
    const lt = await model.findAll(core.class.Class, {
      kind: { $lt: 1 }
    })
    expect(lt.length).toBe(classes.filter((p) => p.kind < 1).length)
    const lte = await model.findAll(core.class.Class, {
      kind: { $lt: 1 }
    })
    expect(lte.length).toBe(classes.filter((p) => p.kind <= 1).length)
  })

  it('should query model like params', async () => {
    const { model } = await createModel()
    const expectedLength = txes.filter((tx) => tx.objectSpace === core.space.Model).length
    const without = await model.findAll(core.class.Doc, {
      space: { $like: core.space.Model }
    })
    expect(without).toHaveLength(expectedLength)
    const begin = await model.findAll(core.class.Doc, {
      space: { $like: '%Model' }
    })
    expect(begin).toHaveLength(expectedLength)
    const zero = await model.findAll(core.class.Doc, {
      space: { $like: 'Model' }
    })
    expect(zero).toHaveLength(0)
    const end = await model.findAll(core.class.Doc, {
      space: { $like: 'core:space:M%' }
    })
    expect(end).toHaveLength(expectedLength)
    const mid = await model.findAll(core.class.Doc, {
      space: { $like: '%M%de%' }
    })
    expect(mid).toHaveLength(expectedLength)
    const all = await model.findAll(core.class.Doc, {
      space: { $like: '%Mod%' }
    })
    expect(all).toHaveLength(expectedLength)

    const regex = await model.findAll(core.class.Doc, {
      space: { $regex: '.*Mod.*' }
    })
    expect(regex).toHaveLength(expectedLength)
  })

  it('limit and sorting', async () => {
    const hierarchy = new Hierarchy()
    for (const tx of txes) hierarchy.tx(tx)
    const model = new TxOperations(new ClientModel(hierarchy), core.account.System)
    for (const tx of txes) await model.tx(tx)

    const without = await model.findAll(core.class.Space, {})
    expect(without).toHaveLength(2)

    const limit = await model.findAll(core.class.Space, {}, { limit: 1 })
    expect(limit).toHaveLength(1)

    const sortAsc = await model.findAll(core.class.Space, {}, { limit: 1, sort: { name: SortingOrder.Ascending } })
    expect(sortAsc[0].name).toMatch('Sp1')

    const sortDesc = await model.findAll(core.class.Space, {}, { limit: 1, sort: { name: SortingOrder.Descending } })
    expect(sortDesc[0].name).toMatch('Sp2')

    const numberSortDesc = await model.findAll(core.class.Doc, {}, { sort: { modifiedOn: SortingOrder.Descending } })
    expect(numberSortDesc[0].modifiedOn).toBeGreaterThanOrEqual(numberSortDesc[numberSortDesc.length - 1].modifiedOn)

    const numberSort = await model.findAll(core.class.Doc, {}, { sort: { modifiedOn: SortingOrder.Ascending } })
    expect(numberSort[0].modifiedOn).toBeLessThanOrEqual(numberSort[numberSortDesc.length - 1].modifiedOn)
  })

  it('should add attached document', async () => {
    const { model } = await createModel()

    const client = new TxOperations(model, core.account.System)
    const result = await client.findAll(core.class.Space, {})
    expect(result).toHaveLength(2)

    await client.addCollection(test.class.TestComment, core.space.Model, result[0]._id, result[0]._class, 'comments', {
      message: 'msg'
    })
    const result2 = await client.findAll(test.class.TestComment, {})
    expect(result2).toHaveLength(1)
  })

  it('check associations', async () => {
    const { model } = await createModel()
    const operations = new TxOperations(model, core.account.System)
    const association = await operations.findOne(core.class.Association, {})
    if (association == null) {
      throw new Error('Association not found')
    }

    const spaces = await operations.findAll(core.class.Space, {})
    expect(spaces).toHaveLength(2)

    const first = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      spaces[0]._id,
      spaces[0]._class,
      'comments',
      {
        message: 'msg'
      }
    )

    const second = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      first,
      test.class.TestComment,
      'comments',
      {
        message: 'msg2'
      }
    )

    await operations.createDoc(core.class.Relation, '' as Ref<Space>, {
      docA: first,
      docB: second,
      association: association._id
    })

    const r = await operations.findAll(
      test.class.TestComment,
      { _id: first },
      {
        associations: [[association._id, 1]]
      }
    )
    expect(r.length).toEqual(1)
    expect((r[0].$associations?.[association._id + '_b'][0] as any)?._id).toEqual(second)
  })

  it('check deep associations', async () => {
    const { model } = await createModel()
    const operations = new TxOperations(model, core.account.System)
    const association = await operations.findOne(core.class.Association, {})
    if (association == null) {
      throw new Error('Association not found')
    }

    const spaces = await operations.findAll(core.class.Space, {})
    expect(spaces).toHaveLength(2)

    const zero = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      spaces[0]._id,
      spaces[0]._class,
      'comments',
      {
        message: 'msg'
      }
    )

    const first = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      spaces[0]._id,
      spaces[0]._class,
      'comments',
      {
        message: 'msg'
      }
    )

    const second = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      first,
      test.class.TestComment,
      'comments',
      {
        message: 'msg2'
      }
    )

    const second2 = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      first,
      test.class.TestComment,
      'comments',
      {
        message: 'msg2'
      }
    )

    const third = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      spaces[0]._id,
      spaces[0]._class,
      'comments',
      {
        message: 'msg3'
      }
    )
    await operations.createDoc(core.class.Relation, '' as Ref<Space>, {
      docA: first,
      docB: second,
      association: association._id
    })

    await operations.createDoc(core.class.Relation, '' as Ref<Space>, {
      docA: first,
      docB: second2,
      association: association._id
    })

    await operations.createDoc(core.class.Relation, '' as Ref<Space>, {
      docA: second,
      docB: third,
      association: association._id
    })

    const r = await operations.findAll(
      test.class.TestComment,
      { _id: { $in: [zero, first] } },
      {
        associations: [[association._id, 1, [[association._id, 1]]]]
      }
    )
    expect(r.length).toEqual(2)
    expect(r[1].$associations?.[`${association._id}_b`]).toHaveLength(2)
    expect((r[1].$associations?.[`${association._id}_b`][0] as any)?._id).toEqual(second)
    expect(r[1].$associations?.[`${association._id}_b`][1]?.$associations?.[`${association._id}_b`]).toHaveLength(0)
    expect(
      (r[1].$associations?.[`${association._id}_b`][0]?.$associations?.[`${association._id}_b`][0] as any)?._id
    ).toEqual(third)
  })

  it('check reverse associations', async () => {
    const { model } = await createModel()
    const operations = new TxOperations(model, core.account.System)
    const association = await operations.findOne(core.class.Association, {})
    if (association == null) {
      throw new Error('Association not found')
    }

    const spaces = await operations.findAll(core.class.Space, {})
    const first = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      spaces[0]._id,
      spaces[0]._class,
      'comments',
      { message: 'msg' }
    )
    const second = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      first,
      test.class.TestComment,
      'comments',
      { message: 'msg2' }
    )

    await operations.createDoc(core.class.Relation, '' as Ref<Space>, {
      docA: first,
      docB: second,
      association: association._id
    })

    // direction -1 walks the relation from docB back to docA
    const r = await operations.findAll(
      test.class.TestComment,
      { _id: second },
      { associations: [[association._id, -1]] }
    )
    expect(r.length).toEqual(1)
    expect((r[0].$associations?.[association._id + '_a'][0] as any)?._id).toEqual(first)
  })

  it('association lookup should skip an unknown association', async () => {
    const { model } = await createModel()
    const operations = new TxOperations(model, core.account.System)
    const spaces = await operations.findAll(core.class.Space, {})
    const first = await operations.addCollection(
      test.class.TestComment,
      core.space.Model,
      spaces[0]._id,
      spaces[0]._class,
      'comments',
      { message: 'msg' }
    )

    const bogusAssoc = 'association:bogus' as any
    const r = await operations.findAll(test.class.TestComment, { _id: first }, { associations: [[bogusAssoc, 1]] })
    expect(r.length).toEqual(1)
    expect(r[0].$associations?.[`${bogusAssoc}_b`]).toBeUndefined()
  })

  it('findAll should treat an explicit null _id as no match', async () => {
    const { model } = await createModel()
    const result = await model.findAll(core.class.Class, { _id: null as any })
    expect(result.length).toBe(0)
  })

  it('findAllSync should treat an explicit null _id as no match', async () => {
    const { model } = await createModel()
    const result = model.findAllSync(core.class.Class, { _id: null as any })
    expect(result.length).toBe(0)
  })

  it('findAllSync should honor sort options', async () => {
    const { model } = await createModel()
    const asc = model.findAllSync(core.class.Space, {}, { sort: { name: SortingOrder.Ascending } })
    expect(asc[0].name).toBe('Sp1')
  })

  it('lookups', async () => {
    const { model } = await createModel()

    const client = new TxOperations(model, core.account.System)
    const spaces = await client.findAll(core.class.Space, {})
    expect(spaces).toHaveLength(2)

    const first = await client.addCollection(
      test.class.TestComment,
      core.space.Model,
      spaces[0]._id,
      spaces[0]._class,
      'comments',
      {
        message: 'msg'
      }
    )

    const second = await client.addCollection(
      test.class.TestComment,
      core.space.Model,
      first,
      test.class.TestComment,
      'comments',
      {
        message: 'msg2'
      }
    )

    await client.addCollection(test.class.TestComment, core.space.Model, spaces[0]._id, spaces[0]._class, 'comments', {
      message: 'msg3'
    })

    const simple = await client.findAll(
      test.class.TestComment,
      { _id: first },
      { lookup: { attachedTo: spaces[0]._class } }
    )
    expect(simple[0].$lookup?.attachedTo).toEqual(spaces[0])

    const nested = await client.findAll(
      test.class.TestComment,
      { _id: second },
      { lookup: { attachedTo: [test.class.TestComment, { attachedTo: spaces[0]._class } as any] } }
    )
    expect((nested[0].$lookup?.attachedTo as any).$lookup?.attachedTo).toEqual(spaces[0])

    const reverse = await client.findAll(
      spaces[0]._class,
      { _id: spaces[0]._id },
      { lookup: { _id: { comments: test.class.TestComment } } }
    )
    expect((reverse[0].$lookup as any).comments).toHaveLength(2)
  })

  it('mixin lookups', async () => {
    const { model } = await createModel()

    const client = new TxOperations(model, core.account.System)
    const spaces = await client.findAll(core.class.Space, {})
    expect(spaces).toHaveLength(2)

    const task = await client.createDoc(test.class.Task, spaces[0]._id, {
      name: 'TSK1',
      number: 1,
      state: 0
    })

    await client.createMixin(task, test.class.Task, spaces[0]._id, test.mixin.TaskMixinTodos, {
      todos: 0
    })

    await client.addCollection(test.class.TestMixinTodo, spaces[0]._id, task, test.mixin.TaskMixinTodos, 'todos', {
      text: 'qwe'
    })
    await client.addCollection(test.class.TestMixinTodo, spaces[0]._id, task, test.mixin.TaskMixinTodos, 'todos', {
      text: 'qwe2'
    })

    const results = await client.findAll(
      test.class.TestMixinTodo,
      {},
      { lookup: { attachedTo: test.mixin.TaskMixinTodos } }
    )
    expect(results.length).toEqual(2)
    const attached = results[0].$lookup?.attachedTo
    expect(attached).toBeDefined()
    expect(Hierarchy.mixinOrClass(attached as Doc)).toEqual(test.mixin.TaskMixinTodos)
  })

  it('createDoc for AttachedDoc', async () => {
    expect.assertions(1)
    const { model } = await createModel()

    const client = new TxOperations(model, core.account.System)
    const spaces = await client.findAll(core.class.Space, {})
    const task = await client.createDoc(test.class.Task, spaces[0]._id, {
      name: 'TSK1',
      number: 1,
      state: 0
    })
    try {
      await client.createDoc(test.class.TestMixinTodo, spaces[0]._id, {
        text: '',
        attachedTo: task,
        attachedToClass: test.mixin.TaskMixinTodos,
        collection: 'todos'
      })
    } catch (e) {
      expect(e).toEqual(new Error('createDoc cannot be used for objects inherited from AttachedDoc'))
    }
  })

  it('addTxes coalesces orphan-targeted transactions into a single info line', async () => {
    const { MeasureMetricsContext } = await import('@hcengineering/measurements')
    const { TxFactory } = await import('../tx')
    const { generateId } = await import('../utils')

    const infoCalls: Array<{ message: string, args?: Record<string, any> }> = []
    const warnCalls: Array<{ message: string, args?: Record<string, any> }> = []
    const recordingLogger = {
      info: (message: string, args?: Record<string, any>) => {
        infoCalls.push({ message, args })
      },
      warn: (message: string, args?: Record<string, any>) => {
        warnCalls.push({ message, args })
      },
      error: () => {},
      logOperation: () => {},
      childLogger: () => recordingLogger,
      close: async () => {}
    }
    const ctx = new MeasureMetricsContext('test', {}, {}, undefined, recordingLogger as any)

    const hierarchy = new Hierarchy()
    for (const tx of txes) hierarchy.tx(tx)
    const db = new ModelDb(hierarchy)
    db.addTxes(ctx, txes, true)

    // Reset capture and apply a batch of orphan-targeted transactions
    infoCalls.length = 0
    warnCalls.length = 0

    const factory = new TxFactory(core.account.System)
    const orphanA = generateId<Doc>()
    const orphanB = generateId<Doc>()
    const orphanC = generateId<Doc>()
    const orphans: Tx[] = [
      factory.createTxUpdateDoc(core.class.Space, core.space.Model, orphanA, { name: 'X' } as any),
      factory.createTxUpdateDoc(core.class.Space, core.space.Model, orphanA, { name: 'Y' } as any),
      factory.createTxUpdateDoc(test.class.Task, core.space.Model, orphanB, { name: 'X' } as any),
      factory.createTxRemoveDoc(test.class.Task, core.space.Model, orphanC)
    ]
    db.addTxes(ctx, orphans, true)

    // Single coalesced info line (not one warn per orphan)
    const orphanInfo = infoCalls.find((c) => c.message.startsWith('skipped model transactions'))
    expect(orphanInfo).toBeDefined()
    expect(orphanInfo?.args?.total).toEqual(4)
    expect(orphanInfo?.args?.byClass).toMatchObject({
      [core.class.TxUpdateDoc]: 3,
      [core.class.TxRemoveDoc]: 1
    })
    expect(warnCalls.find((c) => c.message.includes('no document found'))).toBeUndefined()
  })

  it('addTxes emits no orphan summary when all transactions apply cleanly', async () => {
    const { MeasureMetricsContext } = await import('@hcengineering/measurements')

    const infoCalls: Array<{ message: string, args?: Record<string, any> }> = []
    const recordingLogger = {
      info: (message: string, args?: Record<string, any>) => {
        infoCalls.push({ message, args })
      },
      warn: () => {},
      error: () => {},
      logOperation: () => {},
      childLogger: () => recordingLogger,
      close: async () => {}
    }
    const ctx = new MeasureMetricsContext('test', {}, {}, undefined, recordingLogger as any)

    const hierarchy = new Hierarchy()
    for (const tx of txes) hierarchy.tx(tx)
    const db = new ModelDb(hierarchy)
    db.addTxes(ctx, txes, true)

    // No orphan summary emitted because all model txes apply cleanly
    expect(infoCalls.find((c) => c.message.includes('skipped model transactions'))).toBeUndefined()
  })

  it('lookup on undefined reference field should return undefined without attaching random doc', async () => {
    const { model } = await createModel()

    // Create an existing task in memdb
    await model.tx(
      createDoc(test.class.Task, {
        name: 'Existing Task',
        number: 1,
        state: 0
      })
    )

    // Create a task where reference property is undefined
    const taskTx = createDoc(test.class.Task, {
      name: 'Task with undefined reference',
      number: 2,
      state: 0
    })
    await model.tx(taskTx)

    const spyFindAll = jest.spyOn(model, 'findAll')

    const results = await model.findAll(
      test.class.Task,
      { _id: taskTx.objectId },
      { lookup: { attachedTo: test.class.Task } as any }
    )
    expect(results).toHaveLength(1)
    expect((results[0].$lookup as any)?.attachedTo).toBeUndefined()

    // Verify that findAll was NOT called for lookup when refId is undefined
    expect(spyFindAll).not.toHaveBeenCalledWith(test.class.Task, { _id: undefined })
    expect(spyFindAll).not.toHaveBeenCalledWith(test.class.Task, { _id: null })

    spyFindAll.mockRestore()
  })

  it('reverse lookup should return empty array when collection is empty', async () => {
    const { model } = await createModel()

    const taskTx = createDoc(test.class.Task, {
      name: 'Task without comments',
      number: 3,
      state: 0
    })
    await model.tx(taskTx)

    const results = await model.findAll(
      test.class.Task,
      { _id: taskTx.objectId },
      { lookup: { _id: { comments: test.class.TestComment } } as any }
    )
    expect(results).toHaveLength(1)
    expect((results[0].$lookup as any)?.comments).toHaveLength(0)
  })

  it('getObject should throw PlatformError for a non-existent document', async () => {
    const { model } = await createModel()

    expect(() => model.getObject('space:bogus' as Ref<Doc>)).toThrow(PlatformError)
  })

  it('reverse lookup should support the [class, field] array form', async () => {
    const { model } = await createModel()

    const client = new TxOperations(model, core.account.System)
    const spaces = await client.findAll(core.class.Space, {})
    expect(spaces).toHaveLength(2)

    await client.addCollection(test.class.TestComment, core.space.Model, spaces[0]._id, spaces[0]._class, 'comments', {
      message: 'msg'
    })
    await client.addCollection(test.class.TestComment, core.space.Model, spaces[0]._id, spaces[0]._class, 'comments', {
      message: 'msg2'
    })

    const reverse = await client.findAll(
      spaces[0]._class,
      { _id: spaces[0]._id },
      { lookup: { _id: { comments: [test.class.TestComment, 'attachedTo'] } as any } }
    )
    expect((reverse[0].$lookup as any).comments).toHaveLength(2)
  })

  it('findOne (base MemDb implementation) should return a single matching document', async () => {
    const hierarchy = new Hierarchy()
    for (const tx of txes) hierarchy.tx(tx)
    const model = new ModelDb(hierarchy)
    for (const tx of txes) await model.tx(tx)

    const space = await model.findOne(core.class.Space, {})
    expect(space).toBeDefined()
    expect(space?._class).toBe(core.class.Space)
  })

  it('findAllSync should filter out documents without the queried mixin', async () => {
    const { model } = await createModel()
    const ops = new TxOperations(model, core.account.System)

    const spaces = model.findAllSync(core.class.Space, {})
    const withMixin = await ops.createDoc(test.class.Task, spaces[0]._id, { name: 'T1', number: 1, state: 0 })
    await ops.createDoc(test.class.Task, spaces[0]._id, { name: 'T2', number: 2, state: 0 })
    await ops.createMixin(withMixin, test.class.Task, spaces[0]._id, test.mixin.TaskMixinTodos, { todos: 0 })

    const mixed = model.findAllSync(test.mixin.TaskMixinTodos, {})
    expect(mixed.map((d) => d._id)).toEqual([withMixin])
  })

  it('delDoc should throw PlatformError for a non-existent document', async () => {
    const { model } = await createModel()

    expect(() => {
      model.delDoc('space:bogus' as Ref<Doc>)
    }).toThrow(PlatformError)
  })

  it('TxDb protected tx handlers should throw Method not implemented', async () => {
    const { txDb } = await createModel()
    const anyDb = txDb as any

    expect(() => anyDb.txCreateDoc({})).toThrow('Method not implemented.')
    expect(() => anyDb.txUpdateDoc({})).toThrow('Method not implemented.')
    expect(() => anyDb.txRemoveDoc({})).toThrow('Method not implemented.')
    expect(() => anyDb.txMixin({})).toThrow('Method not implemented.')
  })

  it('addTxes should warn and keep indexing when a created doc has an unknown class', async () => {
    const hierarchy = new Hierarchy()
    for (const tx of txes) hierarchy.tx(tx)
    const model = new ModelDb(hierarchy)
    for (const tx of txes) await model.tx(tx)
    const ctx = { warn: jest.fn(), info: jest.fn() } as any

    const unknownTx = createDoc('test:class:Unknown' as Ref<Class<Doc>>, {} as any)
    const spaceTx = createDoc(core.class.Space, {
      name: 'Y',
      description: '',
      private: false,
      members: [],
      archived: false
    })
    model.addTxes(ctx, [unknownTx, spaceTx], false)

    expect(ctx.warn).toHaveBeenCalledWith(
      'failed to index model document, skipping',
      expect.objectContaining({ _id: unknownTx.objectId })
    )
    const spaces = model.findAllSync(core.class.Space, { _id: spaceTx.objectId })
    expect(spaces).toHaveLength(1)
  })

  it('addTxes should warn and continue when applying a transaction to the hierarchy fails', async () => {
    const hierarchy = new Hierarchy()
    for (const tx of txes) hierarchy.tx(tx)
    const model = new ModelDb(hierarchy)
    for (const tx of txes) await model.tx(tx)
    const ctx = { warn: jest.fn() } as any

    const spy = jest.spyOn(hierarchy, 'tx').mockImplementationOnce(() => {
      throw new Error('boom')
    })

    const newSpaceTx = createDoc(core.class.Space, {
      name: 'X',
      description: '',
      private: false,
      members: [],
      archived: false
    })
    model.addTxes(ctx, [newSpaceTx], false)

    expect(ctx.warn).toHaveBeenCalledWith(
      'failed to apply model transaction to hierarchy, skipping',
      expect.objectContaining({ _id: newSpaceTx._id })
    )
    // the document itself must still be applied to the model despite the hierarchy failure
    expect(model.getObject(newSpaceTx.objectId as Ref<Doc>)).toBeDefined()

    spy.mockRestore()
  })

  it('addTxes applies an update after its create transaction when loading an unordered model', async () => {
    const hierarchy = new Hierarchy()
    for (const tx of txes) hierarchy.tx(tx)
    const model = new ModelDb(hierarchy)
    for (const tx of txes) await model.tx(tx)
    const ctx = { warn: jest.fn(), info: jest.fn() } as any

    const space = createDoc(core.class.Space, {
      name: 'Original',
      description: '',
      private: false,
      members: [],
      archived: false
    })
    const update = updateDoc<Space>(core.class.Space, core.space.Model, space.objectId, {
      name: 'Updated'
    })

    model.addTxes(ctx, [update, space], false)

    expect(model.getObject<Space>(space.objectId).name).toBe('Updated')
    expect(ctx.info).not.toHaveBeenCalled()
  })

  it('addTxes fails when a required model transaction is skipped', async () => {
    const { model } = await createModel()
    const ctx = { warn: jest.fn(), info: jest.fn() } as any
    const unknown = createDoc<Doc>('test:class:Unknown' as Ref<Class<Doc>>, {})

    expect(() => {
      model.addTxes(ctx, [unknown], false, new Set([unknown._id]))
    }).toThrow(`Failed to apply required model transactions: ${unknown._id}`)
  })

  it('txUpdateDoc via tx() should swallow errors for a missing document', async () => {
    const { model } = await createModel()

    const bogusId = 'space:bogus-update' as Ref<Doc>
    const result = await model.tx(updateDoc(core.class.Space, core.space.Model, bogusId as any, { name: 'x' }))
    expect(result).toEqual([{}])
  })

  it('txUpdateDoc via tx() should apply the update and honor the retrieve flag', async () => {
    const { model } = await createModel()
    const ops = new TxOperations(model, core.account.System)
    const space = await ops.createDoc(core.class.Space, core.space.Model, {
      name: 'RetrieveMe',
      description: '',
      private: false,
      members: [],
      archived: false
    })

    const txFactory = new TxFactory(core.account.System)
    const updateTx = txFactory.createTxUpdateDoc(core.class.Space, core.space.Model, space, { name: 'Updated' }, true)
    const [result] = await model.tx(updateTx)
    expect((result as any).object?.name).toBe('Updated')
  })

  it('txMixin via tx() should throw PlatformError for a missing document', async () => {
    const { model } = await createModel()
    const txFactory = new TxFactory(core.account.System)

    const bogusId = 'space:bogus-txmixin' as Ref<Doc>
    const mixinTx = txFactory.createTxMixin(bogusId as any, core.class.Space, core.space.Model, test.mixin.TestMixin, {
      arr: []
    } as any)
    await expect(model.tx(mixinTx)).rejects.toThrow(PlatformError)
  })
})

describe.each([true, false])('model transaction replay (clone=%s)', (doClone) => {
  interface ReplaySpace extends Space {
    count: number
    arr: string[]
  }

  const spaceMixin = test.mixin.TestMixin as Ref<Mixin<ReplaySpace>>

  function fixture (): {
    db: ModelDb, h: Hierarchy, ctx: MeasureMetricsContext, info: jest.SpyInstance, warn: jest.SpyInstance
  } {
    const h = new Hierarchy()
    const db = new ModelDb(h)
    const ctx = new MeasureMetricsContext('test', {})
    const warn = jest.spyOn(ctx, 'warn').mockImplementation(() => {})
    const info = jest.spyOn(ctx, 'info').mockImplementation(() => {})
    db.addTxes(ctx, genMinModel(), doClone)
    warn.mockClear()
    info.mockClear()
    return { db, h, ctx, info, warn }
  }

  const factory = new TxFactory(core.account.System)
  const orders = ['CON', 'OCN', 'ONC', 'CNO', 'NCO', 'NOC']

  function spaceTx (): TxCreateDoc<ReplaySpace> {
    return createDoc<ReplaySpace>(core.class.Space, {
      name: 'original', description: '', private: false, members: [], archived: false, count: 0, arr: []
    })
  }

  function mutation (create: TxCreateDoc<ReplaySpace>, mixin: boolean, value: string): TxUpdateDoc<Space> | TxMixin<Space, ReplaySpace> {
    return mixin
      ? factory.createTxMixin<Space, ReplaySpace>(create.objectId, core.class.Space, core.space.Model, spaceMixin, {
        arr: [value]
      })
      : factory.createTxUpdateDoc<ReplaySpace>(core.class.Space, core.space.Model, create.objectId, { name: value })
  }

  it.each(['update', 'mixin', 'update/mixin', 'mixin/update'])('preserves supplied %s order around create', (kind) => {
    for (const order of orders) {
      const { db, h, ctx, info, warn } = fixture()
      const create = spaceTx()
      const oldMixin = kind === 'mixin' || kind === 'mixin/update'
      const newMixin = kind === 'mixin' || kind === 'update/mixin'
      const old = mutation(create, oldMixin, 'old')
      const newer = mutation(create, newMixin, 'new')
      old.modifiedOn = 10
      old.modifiedBy = 'account:old' as PersonId
      newer.modifiedOn = 20
      newer.modifiedBy = 'account:new' as PersonId
      const input = { C: create, O: old, N: newer }
      db.addTxes(ctx, [...order].map((key) => input[key as keyof typeof input]), doClone, new Set([old._id, newer._id]))
      const last = order.indexOf('O') > order.indexOf('N') ? old : newer
      const doc = db.getObject(create.objectId)
      expect(doc.modifiedOn).toBe(last.modifiedOn)
      expect(doc.modifiedBy).toBe(last.modifiedBy)
      expect(doc.name).toBe(oldMixin && newMixin ? 'original' : oldMixin ? 'new' : newMixin ? 'old' : last === old ? 'old' : 'new')
      if (oldMixin || newMixin) {
        expect(h.as(doc, spaceMixin).arr).toEqual([
          oldMixin && newMixin ? last === old ? 'old' : 'new' : oldMixin ? 'old' : 'new'
        ])
        expect(db.findAllSync(spaceMixin, {}).map((it) => it._id)).toEqual([create.objectId])
      }
      expect(db.findAllSync(core.class.Space, { name: doc.name }).some((it) => it._id === doc._id)).toBe(true)
      expect(info).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    }
  })

  it.each([false, true])('preserves disjoint fields and applies operators once (mixin=%s)', (mixin) => {
    const { db, h, ctx, info } = fixture()
    const create = spaceTx()
    const ops = (attributes: DocumentUpdate<ReplaySpace>): Tx => mixin
      ? factory.createTxMixin<Space, ReplaySpace>(create.objectId, core.class.Space, core.space.Model, spaceMixin, attributes)
      : factory.createTxUpdateDoc<ReplaySpace>(core.class.Space, core.space.Model, create.objectId, attributes)
    const old = ops({ $inc: { count: 1 }, $push: { arr: 'old' }, description: 'retained' })
    const newer = ops({ $inc: { count: 2 }, $push: { arr: 'new' }, name: 'later' })
    old.modifiedOn = 10
    newer.modifiedOn = 5
    db.addTxes(ctx, [old, create, newer, old], doClone, new Set([old._id, newer._id]))
    const doc = db.getObject(create.objectId)
    const value = mixin ? h.as(doc, spaceMixin) : doc
    expect(value.count).toBe(4)
    expect(value.arr).toEqual(['old', 'new', 'old'])
    expect(value.description).toBe('retained')
    expect(value.name).toBe('later')
    expect(doc.modifiedOn).toBe(10)
    expect(db.findAllSync(core.class.Space, {}).some((it) => it._id === doc._id)).toBe(true)
    expect(info).not.toHaveBeenCalled()
    expect(create.attributes.arr).toEqual(!doClone && !mixin ? ['old', 'new', 'old'] : [])
  })

  const lifecycle = [
    { order: 'CUR', exists: false, applied: true, orphans: 0 },
    { order: 'CRU', exists: false, applied: false, orphans: 1 },
    { order: 'UCR', exists: false, applied: true, orphans: 0 },
    { order: 'URC', exists: true, applied: false, orphans: 2 },
    { order: 'RCU', exists: true, applied: true, orphans: 1 },
    { order: 'RUC', exists: true, applied: true, orphans: 1 }
  ]
  it.each([false, true])('keeps remove at its supplied position (mixin=%s)', (mixin) => {
    for (const { order, exists, applied, orphans } of lifecycle) {
      const { db, h, ctx, info } = fixture()
      const create = spaceTx()
      const update = mutation(create, mixin, 'changed')
      const remove = factory.createTxRemoveDoc(core.class.Space, core.space.Model, create.objectId)
      const input = { C: create, U: update, R: remove }
      const apply = (): void => {
        db.addTxes(ctx, [...order].map((key) => input[key as keyof typeof input]), doClone, new Set([update._id]))
      }
      if (applied) {
        expect(apply).not.toThrow()
      } else {
        expect(apply).toThrow(`Failed to apply required model transactions: ${update._id}`)
      }
      const doc = db.findObject(create.objectId)
      expect(doc !== undefined).toBe(exists)
      expect(db.findAllSync(core.class.Space, {}).some((it) => it._id === create.objectId)).toBe(exists)
      if (doc !== undefined) {
        expect(doc.name).toBe(!mixin && applied ? 'changed' : 'original')
        expect(h.hasMixin(doc, spaceMixin)).toBe(mixin && applied)
      }
      if (orphans === 0) {
        expect(info).not.toHaveBeenCalled()
      } else {
        expect(info).toHaveBeenCalledTimes(1)
        expect(info).toHaveBeenCalledWith('skipped model transactions for orphan documents', {
          total: orphans,
          byClass: { ...(applied ? {} : { [update._class]: 1 }), ...(orphans > (applied ? 0 : 1) ? { [remove._class]: 1 } : {}) }
        })
      }
    }
  })

  it.each([false, true])('separates mutations across removal and replacement (first mixin=%s)', (mixin) => {
    const { db, h, ctx, info } = fixture()
    const create = spaceTx()
    const before = mutation(create, mixin, 'before')
    const after = mutation(create, !mixin, 'after')
    const remove = factory.createTxRemoveDoc(core.class.Space, core.space.Model, create.objectId)
    db.addTxes(ctx, [before, remove, after, create], doClone, new Set([after._id]))
    const doc = db.getObject(create.objectId)
    expect(doc.name).toBe(mixin ? 'after' : 'original')
    expect(h.hasMixin(doc, spaceMixin)).toBe(!mixin)
    expect(info).toHaveBeenCalledWith('skipped model transactions for orphan documents', {
      total: 2, byClass: { [before._class]: 1, [remove._class]: 1 }
    })
    const second = spaceTx()
    second.objectId = create.objectId
    db.addTxes(ctx, [remove, before, second, after], doClone, new Set([before._id, after._id, remove._id]))
    expect(db.getObject(create.objectId)).not.toBe(doc)
    expect(db.findAllSync(core.class.Space, {}).filter((it) => it._id === create.objectId)).toHaveLength(1)
    const replacement = spaceTx()
    replacement.objectId = create.objectId
    db.addTxes(ctx, [before, replacement], doClone)
    expect(db.getObject(create.objectId).name).toBe('original')
    expect(h.hasMixin(db.getObject(create.objectId), spaceMixin)).toBe(false)
    expect(db.findAllSync(core.class.Space, {}).find((it) => it._id === create.objectId)).toBe(db.getObject(create.objectId))
  })

  it('waits for each object independently and preserves the update hook order', () => {
    const { db, ctx } = fixture()
    const first = spaceTx()
    const second = spaceTx()
    const firstUpdate = mutation(first, false, 'first')
    const secondUpdate = mutation(second, false, 'second')
    const later = mutation(first, false, 'later')
    const hook = jest.spyOn(db, 'updateDoc')
    db.addTxes(ctx, [firstUpdate, secondUpdate, first, later, second], doClone)
    expect(hook.mock.calls.map((call) => call[2])).toEqual([firstUpdate, later, secondUpdate])
    expect(db.getObject(first.objectId).name).toBe('later')
    expect(db.getObject(second.objectId).name).toBe('second')
    expect(db.findAllSync(core.class.Space, { name: 'second' }).map((it) => it._id)).toEqual([second.objectId])
  })

  it.each([false, true])('does not mutate a hierarchy-only target while pending (mixin=%s)', (mixin) => {
    const { db, h, ctx } = fixture()
    const create = factory.createTxCreateDoc(core.class.Class, core.space.Model, {
      label: 'original' as IntlString, kind: ClassifierKind.CLASS, extends: core.class.Doc
    })
    h.tx(create)
    const update = mixin
      ? factory.createTxMixin<Doc, TestMixin>(create.objectId, core.class.Class, core.space.Model, test.mixin.TestMixin, { arr: ['pending'] })
      : factory.createTxUpdateDoc(core.class.Class, core.space.Model, create.objectId, { label: 'pending' as IntlString })
    const before = JSON.stringify(h.getClass(create.objectId))
    db.addTxes(ctx, [update], doClone)
    expect(JSON.stringify(h.getClass(create.objectId))).toBe(before)
    expect(db.findObject(create.objectId)).toBeUndefined()
    db.addTxes(ctx, [create], doClone)
    expect(h.getClass(create.objectId)).toBe(db.getObject(create.objectId))
    expect(h.getClass(create.objectId).label).toBe('original')
    expect(h.hasMixin(h.getClass(create.objectId), test.mixin.TestMixin)).toBe(false)
  })

  it('does not carry pending mutations into another batch', () => {
    const { db, ctx } = fixture()
    const create = spaceTx()
    const update = mutation(create, false, 'orphan')
    db.addTxes(ctx, [update], doClone)
    db.addTxes(ctx, [create], doClone)
    expect(db.getObject(create.objectId).name).toBe('original')
  })

  it.each([undefined, new Set<Ref<Tx>>()])('aggregates optional failures with required=%s', (required) => {
    const { db, ctx, info, warn } = fixture()
    const create = spaceTx()
    const update = mutation(create, false, 'missing')
    const mixin = mutation(create, true, 'missing')
    const remove = factory.createTxRemoveDoc(core.class.Space, core.space.Model, create.objectId)
    db.addTxes(ctx, [update, mixin, remove], doClone, required)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith('skipped model transactions for orphan documents', {
      total: 3, byClass: { [update._class]: 1, [mixin._class]: 1, [remove._class]: 1 }
    })
    expect(warn).not.toHaveBeenCalled()
    expect(db.findObject(create.objectId)).toBeUndefined()
    expect(() => {
      db.addTxes(ctx, [], doClone, new Set([update._id]))
    }).not.toThrow()
  })

  it('keeps a failed occurrence required even when the same ID succeeds later', () => {
    const { db, ctx } = fixture()
    const create = spaceTx()
    const update = mutation(create, false, 'changed')
    const remove = factory.createTxRemoveDoc(core.class.Space, core.space.Model, create.objectId)
    expect(() => {
      db.addTxes(ctx, [update, remove, create, update], doClone, new Set([update._id]))
    })
      .toThrow(`Failed to apply required model transactions: ${update._id}`)
    expect(db.getObject(create.objectId).name).toBe('changed')
  })

  it.each([false, true])('retains genuine hierarchy failures after materialization (deferred=%s)', (deferred) => {
    const { db, h, ctx, info, warn } = fixture()
    const create = spaceTx()
    const update = mutation(create, false, 'changed')
    const original = h.tx.bind(h)
    jest.spyOn(h, 'tx').mockImplementation((tx, doc) => {
      if (tx === update) throw new Error('hierarchy failure')
      original(tx, doc)
    })
    expect(() => {
      db.addTxes(ctx, deferred ? [update, create] : [create, update], doClone, new Set([update._id]))
    })
      .toThrow(`Failed to apply required model transactions: ${update._id}`)
    expect(db.getObject(create.objectId).name).toBe('changed')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(info).not.toHaveBeenCalled()
  })

  it('keeps required index failures and missing removes hard', () => {
    const { db, ctx } = fixture()
    const unknown = createDoc('test:class:Unknown' as Ref<Class<Doc>>, {})
    expect(() => {
      db.addTxes(ctx, [unknown], doClone, new Set([unknown._id]))
    })
      .toThrow(`Failed to apply required model transactions: ${unknown._id}`)
    expect(db.findObject(unknown.objectId)).toBeDefined()
    const create = spaceTx()
    const remove = factory.createTxRemoveDoc(core.class.Space, core.space.Model, create.objectId)
    expect(() => {
      db.addTxes(ctx, [remove, create], doClone, new Set([remove._id]))
    })
      .toThrow(`Failed to apply required model transactions: ${remove._id}`)
    expect(db.getObject(create.objectId).name).toBe('original')
  })

  it.each([false, true])('propagates unexpected operator errors (mixin=%s)', (mixin) => {
    const { db, ctx, info } = fixture()
    const create = spaceTx()
    const invalid = mixin
      ? factory.createTxMixin<Space, ReplaySpace>(create.objectId, core.class.Space, core.space.Model, spaceMixin, { $invalid: {} } as unknown as DocumentUpdate<ReplaySpace>)
      : factory.createTxUpdateDoc<ReplaySpace>(core.class.Space, core.space.Model, create.objectId, { $invalid: {} } as unknown as DocumentUpdate<ReplaySpace>)
    expect(() => {
      db.addTxes(ctx, [invalid, create], doClone)
    }).toThrow()
    expect(info).not.toHaveBeenCalled()
  })

  it('replays bootstrap classes and attributes against an empty hierarchy', () => {
    const h = new Hierarchy()
    const db = new ModelDb(h)
    const ctx = new MeasureMetricsContext('test', {})
    const child = 'test:class:Child' as Ref<Class<Doc>>
    const parent = 'test:class:Parent' as Ref<Class<Doc>>
    const classTx = (id: Ref<Class<Obj>>, ext: Ref<Class<Obj>>): TxCreateDoc<Class<Obj>> =>
      factory.createTxCreateDoc(core.class.Class, core.space.Model, {
        kind: ClassifierKind.CLASS, extends: ext, label: 'class' as IntlString
      }, id)
    const create = classTx(child, core.class.Doc)
    const old = factory.createTxUpdateDoc(core.class.Class, core.space.Model, child, {
      extends: parent, $push: { implements: test.interface.DummyWithState }
    })
    const newer = factory.createTxUpdateDoc(core.class.Class, core.space.Model, child, { label: 'later' as IntlString })
    const attr = factory.createTxCreateDoc(core.class.Attribute, core.space.Model, {
      attributeOf: child, name: 'initial', label: 'attribute' as IntlString, type: { _class: core.class.TypeString }
    })
    const rename = factory.createTxUpdateDoc(core.class.Attribute, core.space.Model, attr.objectId, { name: 'middle' })
    const finalRename = factory.createTxUpdateDoc(core.class.Attribute, core.space.Model, attr.objectId, { name: 'final' })
    const doc = factory.createTxCreateDoc(child, core.space.Model, {})
    const batch = [
      ...genMinModel(), classTx(core.class.Attribute, core.class.Doc), doc,
      old, create, newer, rename, attr, finalRename, classTx(parent, core.class.Doc)
    ]
    db.addTxes(ctx, batch, doClone, new Set(batch.map((tx) => tx._id)))
    expect(h.getClass(child)).toBe(db.getObject(child))
    expect(h.getClass(child).label).toBe('later')
    expect(h.getClass(child).implements).toEqual([test.interface.DummyWithState])
    expect(h.getAncestors(child)).toContain(parent)
    expect(h.findAttribute(child, 'initial')).toBeUndefined()
    expect(h.findAttribute(child, 'middle')).toBeUndefined()
    expect(h.findAttribute(child, 'final')).toBe(db.getObject(attr.objectId))
    expect(db.findAllSync(parent, {}).map((it) => it._id)).toEqual([doc.objectId])
    expect(db.findAllSync(core.class.Attribute, {}).map((it) => it._id)).toContain(attr.objectId)
  })

  it('keeps parent and sibling frozen data intact through replay and copy on write', () => {
    const base = fixture()
    base.db.freeze()
    const h = new Hierarchy(base.h)
    const db = new ModelDb(h, base.db)
    const siblingH = new Hierarchy(base.h)
    const sibling = new ModelDb(siblingH, base.db)
    const before = JSON.stringify(base.db.findAllSync(core.class.Doc, {}))
    const create = spaceTx()
    const old = mutation(create, true, 'old')
    const newer = mutation(create, false, 'new')
    const push = factory.createTxUpdateDoc(core.class.Class, core.space.Model, test.class.Task, {
      $push: { implements: test.interface.WithState }
    })
    db.addTxes(base.ctx, [old, create, newer, push], doClone)
    expect(h.getClass(test.class.Task)).toBe(db.getObject(test.class.Task))
    expect(h.getClass(test.class.Task)).not.toBe(base.h.getClass(test.class.Task))
    expect(h.getClass(test.class.Task).implements).toEqual([test.interface.DummyWithState, test.interface.WithState])
    expect(db.getObject(create.objectId).name).toBe('new')
    expect(h.as(db.getObject(create.objectId), spaceMixin).arr).toEqual(['old'])
    expect(JSON.stringify(base.db.findAllSync(core.class.Doc, {}))).toBe(before)
    expect(JSON.stringify(sibling.findAllSync(core.class.Doc, {}))).toBe(before)
    expect(siblingH.getClass(test.class.Task)).toBe(base.h.getClass(test.class.Task))
    expect(Object.isFrozen(base.h.getClass(test.class.Task))).toBe(true)
  })
})
