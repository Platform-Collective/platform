// SPDX-License-Identifier: EPL-2.0

import { type Domain, type MeasureContext } from '@hcengineering/core'
import { type IndexedDoc } from '@hcengineering/server-core'
import { FullTextIndexPipeline } from './indexer'

interface ReindexFixture {
  ctx: { info: jest.Mock, warn: jest.Mock, error: jest.Mock, with: jest.Mock }
  cursor: { find: jest.Mock, close: jest.Mock }
  adapter: { updateMany: jest.Mock, update: jest.Mock }
  run: () => Promise<void>
}

function fixture (): ReindexFixture {
  const ctx = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), with: jest.fn() }
  ctx.with.mockImplementation(async (_name, _params, fn) => await fn(ctx))
  const cursor = {
    find: jest
      .fn()
      .mockResolvedValueOnce([{ _id: 'doc', _class: 'test:class:Doc' }])
      .mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined)
  }
  const adapter = { updateMany: jest.fn().mockResolvedValue(undefined), update: jest.fn() }
  const pipeline = Object.assign(Object.create(FullTextIndexPipeline.prototype), {
    workspace: { uuid: 'workspace-uuid' },
    storage: { rawFind: jest.fn().mockReturnValue(cursor) },
    hierarchy: { isDerived: () => false, getClassifierProp: () => true },
    contexts: new Map(),
    fulltextAdapter: adapter,
    indexDocuments: jest.fn(
      async (
        _ctx: unknown,
        _class: unknown,
        _docs: unknown,
        queue: Parameters<FullTextIndexPipeline['indexDocuments']>[3]
      ) => {
        const doc: IndexedDoc = {
          id: 'doc' as IndexedDoc['id'],
          _class: [],
          space: 'space' as IndexedDoc['space'],
          modifiedOn: 0,
          modifiedBy: 'person' as IndexedDoc['modifiedBy']
        }
        await queue.push(doc)
      }
    )
  }) as FullTextIndexPipeline
  const run = async (): Promise<void> => {
    await pipeline.reindex(ctx as unknown as MeasureContext, 'tracker' as Domain, [])
  }
  return { ctx, cursor, adapter, run }
}

describe('domain reindex acceptance logs', () => {
  it('binds successful completion and its processed count to workspace and domain', async () => {
    const { ctx, cursor, run } = fixture()
    await run()
    expect(ctx.info).toHaveBeenCalledWith('reindex done', {
      workspace: 'workspace-uuid',
      domain: 'tracker',
      processed: 1,
      processedCommunication: 0
    })
    expect(ctx.error).not.toHaveBeenCalled()
    expect(cursor.close).toHaveBeenCalledTimes(1)
  })

  it('logs a cursor failure with workspace/domain and never reports completion', async () => {
    const { ctx, cursor, run } = fixture()
    const err = new Error('cursor failed')
    cursor.find.mockReset().mockRejectedValue(err)
    await expect(run()).rejects.toThrow(err)
    expect(ctx.error).toHaveBeenCalledWith('failed to restore index state', {
      err,
      workspace: 'workspace-uuid',
      domain: 'tracker',
      processed: 0
    })
    expect(ctx.info).not.toHaveBeenCalledWith('reindex done', expect.anything())
    expect(cursor.close).toHaveBeenCalledTimes(1)
  })

  it('makes an individual indexing failure visible even after bulk fallback', async () => {
    const { ctx, adapter, run } = fixture()
    const err = new Error('index unavailable')
    adapter.updateMany.mockRejectedValue(err)
    adapter.update.mockRejectedValue(err)
    await run()
    expect(ctx.error).toHaveBeenCalledWith('failed to index document', {
      err,
      workspace: 'workspace-uuid',
      document: 'doc'
    })
  })
})
