// SPDX-License-Identifier: EPL-2.0

import { type Domain, type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { workspaceEvents, type QueueWorkspaceMessage } from '@hcengineering/server-core'
import { FullTextIndexPipeline } from '@hcengineering/server-indexer'
import serverToken from '@hcengineering/server-token'
import { randomUUID } from 'crypto'

import { WorkspaceManager } from '../manager'
import { WorkspaceIndexer } from '../workspace'

const broken = 'broken' as Domain
const healthy = 'healthy' as Domain

function fixture (failedDomains: Domain[] = [broken]): any {
  const workspace = randomUUID() as WorkspaceUuid
  const err = new Error('permanent cursor failure')
  const ctx = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), with: jest.fn() }
  ctx.with.mockImplementation(async (_name, _params, fn) => await fn(ctx))
  const failedCursor = { find: jest.fn().mockRejectedValue(err), close: jest.fn().mockResolvedValue(undefined) }
  const healthyCursor = { find: jest.fn().mockResolvedValue([]), close: jest.fn().mockResolvedValue(undefined) }
  const adapter = { clean: jest.fn().mockResolvedValue(undefined) }
  const pipeline = Object.assign(Object.create(FullTextIndexPipeline.prototype), {
    workspace: { uuid: workspace },
    storage: {
      rawFind: jest.fn((_ctx, domain) => (failedDomains.includes(domain) ? failedCursor : healthyCursor))
    },
    fulltextAdapter: adapter
  }) as FullTextIndexPipeline
  // Use the production pipeline, WorkspaceIndexer wrappers and manager dispatch/operation handling.
  // Only storage/adapter boundaries and domain discovery are replaced.
  const indexer = new WorkspaceIndexer(adapter as any)
  indexer.fulltext = pipeline
  jest.spyOn(indexer, 'getIndexClassess').mockResolvedValue([
    { domain: broken, classes: [] },
    { domain: healthy, classes: [] }
  ])
  const reindex = jest.spyOn(indexer, 'reindex')
  const manager = Object.assign(Object.create(WorkspaceManager.prototype), {
    ctx,
    indexers: new Map([[workspace, indexer]]),
    restoring: new Set()
  }) as WorkspaceManager
  const control = { heartbeat: jest.fn().mockResolvedValue(undefined), pause: jest.fn() }
  const send = async (value: QueueWorkspaceMessage): Promise<void> => {
    await (manager as any).processFulltextEvent({ workspace, value }, control)
  }
  return { workspace, ctx, err, failedCursor, healthyCursor, adapter, reindex, send }
}

describe('fulltext event reindex failure containment', () => {
  beforeAll(() => {
    setMetadata(serverToken.metadata.Secret, 'secret')
  })

  it('settles a permanently failing partial reindex so a later message can run', async () => {
    const f = fixture()
    await expect(f.send(workspaceEvents.reindex(broken, []))).resolves.toBeUndefined()
    await f.send(workspaceEvents.reindex(healthy, []))

    expect(f.failedCursor.find).toHaveBeenCalledTimes(1)
    expect(f.failedCursor.close).toHaveBeenCalledTimes(1)
    expect(f.healthyCursor.find).toHaveBeenCalledTimes(1)
    expect(f.adapter.clean).not.toHaveBeenCalled()
    expect(f.ctx.error).toHaveBeenCalledWith('failed to reindex domain', {
      err: f.err,
      workspace: f.workspace,
      domain: broken
    })
    expect(f.ctx.info).not.toHaveBeenCalledWith('reindex done', expect.objectContaining({ domain: broken }))
    expect(f.ctx.info).toHaveBeenCalledWith('reindex done', expect.objectContaining({ domain: healthy }))
  })

  it('continues later domains and messages after a full reindex cursor failure without replaying the drop', async () => {
    const f = fixture()
    await expect(f.send(workspaceEvents.fullReindex())).resolves.toBeUndefined()
    await f.send(workspaceEvents.reindex(healthy, []))

    expect(f.adapter.clean).toHaveBeenCalledTimes(1)
    expect(f.failedCursor.find).toHaveBeenCalledTimes(1)
    expect(f.failedCursor.close).toHaveBeenCalledTimes(1)
    expect(f.healthyCursor.find).toHaveBeenCalledTimes(2)
    expect(f.reindex.mock.calls.map((call: any[]) => call[1])).toEqual([broken, healthy, healthy])
    expect(f.ctx.error).toHaveBeenCalledWith('failed to restore index state', {
      err: f.err,
      workspace: f.workspace,
      domain: broken,
      processed: 0
    })
    expect(f.ctx.error).toHaveBeenCalledWith('failed to reindex domain', {
      err: f.err,
      workspace: f.workspace,
      domain: broken
    })
    expect(f.ctx.error).toHaveBeenCalledWith('reindex full failed', { workspace: f.workspace, failedDomains: 1 })
    expect(f.ctx.info).not.toHaveBeenCalledWith('reindex full done', expect.anything())
    expect(f.ctx.info).not.toHaveBeenCalledWith('reindex done', expect.objectContaining({ domain: broken }))
    expect(f.ctx.info).toHaveBeenCalledWith('reindex done', expect.objectContaining({ domain: healthy }))
  })

  it('counts every failed domain without claiming full completion', async () => {
    const f = fixture([broken, healthy])
    await expect(f.send(workspaceEvents.fullReindex())).resolves.toBeUndefined()

    expect(f.adapter.clean).toHaveBeenCalledTimes(1)
    expect(f.failedCursor.close).toHaveBeenCalledTimes(2)
    expect(f.ctx.error).toHaveBeenCalledWith('reindex full failed', { workspace: f.workspace, failedDomains: 2 })
    expect(f.ctx.info).not.toHaveBeenCalledWith('reindex full done', expect.anything())
    expect(f.ctx.info).not.toHaveBeenCalledWith('reindex done', expect.anything())
  })

  it('keeps the full completion log when every domain succeeds', async () => {
    const f = fixture([])
    await f.send(workspaceEvents.fullReindex())

    expect(f.adapter.clean).toHaveBeenCalledTimes(1)
    expect(f.healthyCursor.close).toHaveBeenCalledTimes(2)
    expect(f.ctx.info).toHaveBeenCalledWith('reindex full done', { workspace: f.workspace })
    expect(f.ctx.error).not.toHaveBeenCalled()
  })
})
