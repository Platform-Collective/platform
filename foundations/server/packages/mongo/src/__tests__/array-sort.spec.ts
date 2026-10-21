// SPDX-License-Identifier: EPL-2.0

import core, { Hierarchy, MeasureMetricsContext, ModelDb, SortingOrder, type WorkspaceUuid } from '@hcengineering/core'
import { type Db, type Document, type MongoClient } from 'mongodb'
import { createMongoAdapter } from '../storage'
import * as utils from '../utils'
import { createDoc, genMinModel, test } from './minmodel'

interface TestContext {
  adapter: Awaited<ReturnType<typeof createMongoAdapter>>
  ctx: MeasureMetricsContext
  aggregate: jest.Mock<unknown, [Document[]]>
  findOne: jest.Mock<Promise<null>, []>
}

describe('array length sorting', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  async function createTestContext (): Promise<TestContext> {
    const ctx = new MeasureMetricsContext('test', {})
    const hierarchy = new Hierarchy()
    const txes = genMinModel()
    for (const attributeOf of [core.class.Space, test.mixin.TestMixin]) {
      txes.push(
        createDoc(core.class.Attribute, {
          attributeOf,
          name: 'members',
          label: core.string.Class,
          type: { _class: core.class.ArrOf, of: { _class: core.class.TypeString } }
        })
      )
    }
    for (const tx of txes) hierarchy.tx(tx)

    const aggregate = jest.fn((_pipeline: Document[]) => ({
      next: async () => null,
      readBufferedDocuments: () => [],
      close: async () => {}
    }))
    const findOne = jest.fn(async () => null)
    const db = { collection: () => ({ aggregate, findOne }) } as unknown as Db
    jest.spyOn(utils, 'getMongoClient').mockReturnValue({
      getClient: async () => ({}) as unknown as MongoClient,
      close: () => {}
    })
    jest.spyOn(utils, 'getWorkspaceMongoDB').mockReturnValue(db)
    const adapter = await createMongoAdapter(
      ctx,
      hierarchy,
      '',
      { uuid: 'test' as WorkspaceUuid, url: 'test' },
      new ModelDb(hierarchy)
    )
    return { adapter, ctx, aggregate, findOne }
  }

  it.each([SortingOrder.Ascending, SortingOrder.Descending])('sorts counts before limiting (%s)', async (order) => {
    const { adapter, ctx, aggregate, findOne } = await createTestContext()
    await adapter.findAll(ctx, core.class.Space, {}, { sort: { 'members.length': order, name: 1 }, limit: 1 })

    expect(findOne).not.toHaveBeenCalled()
    expect(aggregate).toHaveBeenCalledTimes(1)
    const pipeline = aggregate.mock.calls[0][0]
    const fields = pipeline.find((stage) => stage.$addFields !== undefined)?.$addFields
    expect(fields).toBeDefined()
    const [field] = Object.keys(fields)
    expect(fields[field]).toEqual({ $size: { $ifNull: ['$members', []] } })
    const sortIndex = pipeline.findIndex((stage) => stage.$sort !== undefined)
    expect(pipeline[sortIndex]).toEqual({ $sort: { [field]: order, name: 1 } })
    expect(pipeline.findIndex((stage) => stage.$addFields !== undefined)).toBeLessThan(sortIndex)
    expect(pipeline.findIndex((stage) => stage.$limit === 1)).toBeGreaterThan(sortIndex)
    expect(pipeline).toContainEqual({ $unset: [field] })
  })

  it('resolves mixin arrays', async () => {
    const { adapter, ctx, aggregate } = await createTestContext()
    await adapter.findAll(
      ctx,
      core.class.Space,
      {},
      {
        sort: { [`${test.mixin.TestMixin}.members.length`]: 1 },
        limit: 1
      }
    )

    expect(aggregate).toHaveBeenCalledTimes(1)
    const fields = aggregate.mock.calls[0][0].find((stage) => stage.$addFields !== undefined)?.$addFields
    expect(Object.values(fields)).toEqual([{ $size: { $ifNull: [`$${test.mixin.TestMixin}.members`, []] } }])
  })

  it('preserves ordinary length fields', async () => {
    const { adapter, ctx, aggregate, findOne } = await createTestContext()
    await adapter.findAll(ctx, core.class.Space, {}, { sort: { 'description.length': 1 }, limit: 1 })

    expect(aggregate).not.toHaveBeenCalled()
    expect(findOne).toHaveBeenCalledWith(expect.anything(), { sort: { 'description.length': 1 } })
  })
})
