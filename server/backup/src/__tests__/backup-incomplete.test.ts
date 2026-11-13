// SPDX-License-Identifier: EPL-2.0

import core, {
  DOMAIN_TX,
  MeasureMetricsContext,
  type Doc,
  type DocInfo,
  type Domain,
  type LowLevelStorage,
  type MeasureContext,
  type Ref,
  type WorkspaceIds,
  type WorkspaceUuid
} from '@hcengineering/core'
import type { AccountDB } from '@hcengineering/account'
import type { Pipeline } from '@hcengineering/server-core'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { backup } from '../backup'
import { createFileBackupStorage, type BackupStorage } from '../storage'
import { type BackupInfo } from '../types'
import { loadDigest } from '../utils'

jest.setTimeout(60000)

const wsIds: WorkspaceIds = { uuid: 'workspace' as WorkspaceUuid, url: 'workspace' }

const serverDocs: Doc[] = ['tx-1', 'tx-2'].map((id) => ({
  _id: id as Ref<Doc>,
  _class: core.class.TxCreateDoc,
  space: core.space.Tx,
  modifiedBy: core.account.System,
  modifiedOn: 1
}))

/**
 * Workspace storage with two documents in the transaction domain. `failLoad` makes every
 * document load fail, like a database that times out while the backup runs.
 */
function createWorkspaceStorage (): { storage: LowLevelStorage, state: { failLoad: boolean }, load: jest.Mock } {
  const state = { failLoad: false }
  const load = jest.fn(async (_ctx: MeasureContext, _domain: Domain, ids: Ref<Doc>[]): Promise<Doc[]> => {
    if (state.failLoad) throw new Error('connection timeout')
    return serverDocs.filter((it) => ids.includes(it._id))
  })
  const storage = {
    find: (_ctx: MeasureContext, domain: Domain) => {
      let done = domain !== DOMAIN_TX
      return {
        next: async (): Promise<DocInfo[]> => {
          if (done) return []
          done = true
          return serverDocs.map((it) => ({ id: it._id, hash: `${it._id}-hash`, size: 10 }))
        },
        close: async () => {}
      }
    },
    load,
    getDomainHash: async () => 'domain-hash'
  }
  return { storage: storage as unknown as LowLevelStorage, state, load }
}

function createPipeline (storage: LowLevelStorage): Pipeline {
  return {
    context: { lowLevelStorage: storage, hierarchy: { domains: () => [] } },
    findAll: async () => []
  } as unknown as Pipeline
}

async function readInfo (storage: BackupStorage): Promise<BackupInfo> {
  return JSON.parse(gunzipSync(new Uint8Array(await storage.loadFile('backup.json.gz'))).toString())
}

describe('backup completeness', () => {
  const ctx = new MeasureMetricsContext('test', {})
  let dir: string
  let storage: BackupStorage

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    dir = mkdtempSync(join(tmpdir(), 'backup-incomplete-'))
    storage = await createFileBackupStorage(dir)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  function runBackup (
    pipeline: Pipeline,
    options: { fullVerify?: boolean, isCanceled?: () => boolean } = {}
  ): ReturnType<typeof backup> {
    return backup(ctx, pipeline, wsIds, storage, {} as unknown as AccountDB, {
      include: new Set([DOMAIN_TX]),
      skipDomains: [],
      force: true,
      timeout: 0,
      connectTimeout: 1000,
      skipBlobContentTypes: [],
      blobDownloadLimit: 10,
      keepSnapshots: 10,
      ...options
    })
  }

  it.each([false, true])(
    'fails when a block of documents could not be loaded (fullVerify: %s) and backs it up on the next run',
    async (fullVerify) => {
      const workspace = createWorkspaceStorage()
      workspace.state.failLoad = true

      const failed = await runBackup(createPipeline(workspace.storage), { fullVerify })
      expect(workspace.load).toHaveBeenCalledTimes(3)
      expect(failed.result).toBe(false)
      const info = await readInfo(storage)
      // The domain must be scanned again, and the backup must not be marked as up to date.
      expect(info.domainHashes[DOMAIN_TX]).toBeUndefined()
      expect(info.lastTxId).toBe('')
      // Partial progress must be usable by the next run, without claiming a complete backup.
      expect(await storage.exists('blob-info.json.gz')).toBe(true)
      expect(info.backupSize).toBeGreaterThan(0)

      // The database is back: the next run picks up the skipped documents.
      workspace.state.failLoad = false
      const recovered = await runBackup(createPipeline(workspace.storage), { fullVerify })
      expect(recovered.result).toBe(true)
      expect((await readInfo(storage)).domainHashes[DOMAIN_TX]).toBe('domain-hash')
      const digest = await loadDigest(ctx, storage, (await readInfo(storage)).snapshots, DOMAIN_TX)
      expect(Array.from(digest.keys()).sort()).toEqual(['tx-1', 'tx-2'])
    }
  )

  it('fails when the backup was canceled', async () => {
    const workspace = createWorkspaceStorage()
    const result = await runBackup(createPipeline(workspace.storage), { isCanceled: () => true })
    expect(result.result).toBe(false)
    expect(workspace.load).not.toHaveBeenCalled()
  })

  it('succeeds when all documents were backed up', async () => {
    const workspace = createWorkspaceStorage()
    const result = await runBackup(createPipeline(workspace.storage))
    expect(result.result).toBe(true)
    const info = await readInfo(storage)
    expect(info.domainHashes[DOMAIN_TX]).toBe('domain-hash')
    const digest = await loadDigest(ctx, storage, info.snapshots, DOMAIN_TX)
    expect(Array.from(digest.keys()).sort()).toEqual(['tx-1', 'tx-2'])
  })
})
