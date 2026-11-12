// SPDX-License-Identifier: EPL-2.0

import core, {
  type Doc,
  Hierarchy,
  type LowLevelStorage,
  MeasureMetricsContext,
  ModelDb,
  type Ref,
  toFindResult,
  TxOperations,
  type WorkspaceUuid
} from '@hcengineering/core'
import { type Middleware, type Pipeline, type PipelineContext, wrapPipeline } from '@hcengineering/server-core'
import { LookupMiddleware } from '../lookup'
import { NormalizeTxMiddleware } from '../normalizeTx'

async function fixture (): Promise<any> {
  const hierarchy = new Hierarchy()
  jest.spyOn(hierarchy, 'updateLookupMixin').mockImplementation((_class, doc) => doc)
  jest.spyOn(hierarchy, 'isMixin').mockReturnValue(false)
  jest.spyOn(hierarchy, 'isDerived').mockReturnValue(false)
  const context: PipelineContext = {
    hierarchy,
    modelDb: new ModelDb(hierarchy),
    workspace: { uuid: 'test-workspace' as WorkspaceUuid, url: 'test-workspace' },
    branding: null,
    contextVars: {},
    lowLevelStorage: {} as LowLevelStorage
  }
  const doc = {
    _id: 'tracker:viewlet:IssueList' as Ref<Doc>,
    _class: core.class.Doc,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn: 0,
    name: 'Issues',
    active: false,
    count: 0
  }
  const received = jest.fn(async () => ({}))
  const terminal = {
    findAll: jest.fn(async () => toFindResult([{ ...doc }], 7)),
    tx: received
  } as unknown as Middleware
  const ctx = new MeasureMetricsContext('wrapped-pipeline', {})
  const lookup = await LookupMiddleware.create(ctx, context, terminal)
  const normalize = await NormalizeTxMiddleware.create(ctx, context, terminal)
  const pipeline = {
    context,
    findAll: lookup.findAll.bind(lookup),
    tx: normalize.tx.bind(normalize)
  } as unknown as Pipeline
  return { client: wrapPipeline(ctx, pipeline, context.workspace), doc, received, hierarchy, lookup, ctx }
}

afterEach(() => {
  jest.restoreAllMocks()
})

it.each(['findAll', 'findOne'] as const)('%s returns an updateable document after scalar query compression', async (method) => {
  const { client, doc, received, lookup, ctx } = await fixture()
  const query = { _id: doc._id }
  // The real middleware removes the queried ID before the in-process client receives it.
  expect((await lookup.findAll(ctx, doc._class, query))[0]._id).toBeUndefined()
  const result = await client[method](doc._class, query)
  const found = method === 'findAll' ? result[0] : result
  expect(found._id).toBe(doc._id)
  await new TxOperations(client, core.account.System).update(found, { name: 'Updated' })
  expect(received).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ objectId: doc._id })])
  if (method === 'findAll') expect(result.total).toBe(7)
})

it('restores scalar class, space, false and zero before applying mixin proxies', async () => {
  const { client, doc, hierarchy } = await fixture()
  const query = { _class: doc._class, space: doc.space, active: false, count: 0 }
  const result = await client.findAll(doc._class, query)
  expect(result[0]).toMatchObject(query)
  expect(hierarchy.updateLookupMixin).toHaveBeenCalledWith(doc._class, expect.objectContaining(query), undefined)
})

it('keeps operator queries and the returned class intact for mixin lookups', async () => {
  const { client, doc, hierarchy } = await fixture()
  const mixin = 'test:mixin:View' as Ref<any>
  const options = { projection: { name: 1 }, lookup: {} }
  await client.findAll(mixin, { _id: { $in: [doc._id] } }, options)
  expect(hierarchy.updateLookupMixin).toHaveBeenCalledWith(mixin, expect.objectContaining(doc), options)
})
