// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import gitlab from '@hcengineering/gitlab'
import { GitlabApiError } from '../gitlab/api'
import { MergeRequestSyncManager } from '../sync/merge-requests'
import { MAX_PATCH_BYTES } from '../sync/patch'
import { gitlabMergeRequest, seedRepository } from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { docOf, runSync, syncDocOf } from './helpers/sync'
import { asApi, createTestProvider, ctx, fakeApi, type FakeApi, rawDiffs } from './helpers/provider'

const RAW = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n'

interface FakePatches {
  files: Map<string, string>
  put: jest.Mock
  remove: jest.Mock
}

function fakePatches (): FakePatches {
  const files = new Map<string, string>()
  let n = 0
  return {
    files,
    put: jest.fn(async (_ctx: unknown, patch: string) => {
      const name = `blob-${++n}`
      files.set(name, patch)
      return { file: name, size: Buffer.byteLength(patch) }
    }),
    remove: jest.fn(async (_ctx: unknown, file: string) => {
      files.delete(file)
    })
  }
}

interface Env {
  memory: MemoryClient
  mergeRequests: MergeRequestSyncManager
  api: FakeApi
  patches: FakePatches
  repo: any
}

function setup (options: { storage?: boolean } = {}): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  const api = fakeApi({
    readMergeRequestRawDiffs: rawDiffs(RAW),
    listMergeRequestCommits: async () => [{ id: 'a' }, { id: 'b' }],
    getMergeRequestApprovals: async () => ({ approved_by: [] }),
    listMergeRequestReviewers: async () => []
  })
  const patches = fakePatches()
  const provider = createTestProvider(memory, [repo], api, { patches: options.storage === false ? undefined : patches })
  return { memory, mergeRequests: new MergeRequestSyncManager(provider), api, patches, repo }
}

const patchDocs = (memory: MemoryClient): any[] => memory.docs.filter((d) => d._class === gitlab.class.GitlabPatch)

const syncDoc = async (env: Env, id: string): Promise<any> =>
  await runSync(env.mergeRequests, env.memory, id, gitlab.class.GitlabMergeRequest)

async function imported (env: Env): Promise<string> {
  await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(3))
  const id = env.memory.docs.find((d) => d._class === gitlab.class.DocSyncInfo)?._id
  await syncDoc(env, id)
  return id
}

async function gitlabChange (env: Env, id: string, overrides: any, updatedAt: string): Promise<void> {
  env.api.getMergeRequest.mockResolvedValueOnce(gitlabMergeRequest(3, { updated_at: updatedAt, ...overrides }))
  await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3)
  await syncDoc(env, id)
}

describe('MergeRequestSyncManager: diff', () => {
  it('stores the diff as a hidden patch doc with commit, file and line counts', async () => {
    const env = setup()
    const id = await imported(env)
    expect(patchDocs(env.memory)).toEqual([
      expect.objectContaining({
        attachedTo: id,
        attachedToClass: gitlab.class.GitlabMergeRequest,
        collection: 'patch',
        file: 'blob-1',
        size: Buffer.byteLength(RAW)
      })
    ])
    const [patch] = patchDocs(env.memory)
    for (const field of ['name', 'type', 'readonly']) expect(patch).not.toHaveProperty(field)
    expect(env.patches.files.get('blob-1')).toBe(RAW)
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest)).toMatchObject({
      commits: 2,
      files: 1,
      additions: 1,
      deletions: 1
    })
    expect(syncDocOf(env.memory, id).patchSha).toBe('sha-1')
  })

  it('does not fetch the diff again while the head commit stays the same', async () => {
    const env = setup()
    const id = await imported(env)
    await gitlabChange(env, id, { title: 'Renamed' }, '2026-01-02T00:00:00.000Z')
    expect(env.api.readMergeRequestRawDiffs).toHaveBeenCalledTimes(1)
  })

  it('points the patch doc at a new blob when the head commit changes, and removes the old blob', async () => {
    const env = setup()
    const id = await imported(env)
    await gitlabChange(env, id, { sha: 'sha-2' }, '2026-01-02T00:00:00.000Z')
    expect(patchDocs(env.memory)).toEqual([expect.objectContaining({ file: 'blob-2' })])
    expect([...env.patches.files.keys()]).toEqual(['blob-2'])
    expect(syncDocOf(env.memory, id).patchSha).toBe('sha-2')
  })

  it('removes the stored diff when a newer one is over 5 MB', async () => {
    const env = setup()
    const id = await imported(env)
    env.api.readMergeRequestRawDiffs.mockImplementation(rawDiffs('diff --git a/x b/x\n' + 'x'.repeat(MAX_PATCH_BYTES)))
    await gitlabChange(env, id, { sha: 'sha-2' }, '2026-01-02T00:00:00.000Z')
    expect(patchDocs(env.memory)).toEqual([])
    expect(env.patches.files.size).toBe(0)
    expect(syncDocOf(env.memory, id).patchSha).toBe('sha-2')
  })

  it('removes the new blob when the patch doc cannot be written, and tries again on the next sync', async () => {
    const env = setup()
    const addCollection = env.memory.addCollection
    env.memory.addCollection = async (...args: Parameters<MemoryClient['addCollection']>) => {
      if (args[0] === gitlab.class.GitlabPatch) throw new Error('db down')
      return await addCollection(...args)
    }
    const id = await imported(env)
    expect(env.patches.files.size).toBe(0)
    expect(syncDocOf(env.memory, id).patchSha).toBeUndefined()
  })

  it('does not store a diff over 5 MB, but keeps the counts', async () => {
    const env = setup()
    env.api.readMergeRequestRawDiffs.mockImplementation(
      rawDiffs('diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+' + 'x'.repeat(MAX_PATCH_BYTES) + '\n+b\n')
    )
    const id = await imported(env)
    expect(env.patches.put).not.toHaveBeenCalled()
    expect(patchDocs(env.memory)).toEqual([])
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest)).toMatchObject({
      commits: 2,
      files: 1,
      additions: 2,
      deletions: 1
    })
    expect(syncDocOf(env.memory, id).patchSha).toBe('sha-1')
  })

  it('keeps the merge request in sync when the diff fails, and retries on its next sync', async () => {
    const env = setup()
    env.api.readMergeRequestRawDiffs.mockRejectedValueOnce(new GitlabApiError(500, 'boom'))
    const id = await imported(env)
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest)).toBeDefined()
    expect(syncDocOf(env.memory, id)).toMatchObject({ error: null })
    expect(syncDocOf(env.memory, id).patchSha).toBeUndefined()
    await gitlabChange(env, id, { title: 'Renamed' }, '2026-01-02T00:00:00.000Z')
    expect(patchDocs(env.memory)).toHaveLength(1)
    expect(syncDocOf(env.memory, id).patchSha).toBe('sha-1')
  })

  it('stores no diff when the pod has no storage', async () => {
    const env = setup({ storage: false })
    await imported(env)
    expect(env.api.readMergeRequestRawDiffs).not.toHaveBeenCalled()
  })
})

describe('MergeRequestSyncManager: first-import cost', () => {
  const OLD = {
    state: 'merged' as const,
    updated_at: '2025-10-01T00:00:00.000Z',
    merged_at: '2025-10-01T00:00:00.000Z'
  }

  it('imports an old merged merge request without diff, commits, reviewers or approvals', async () => {
    const env = setup()
    await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(3, OLD))
    const id = env.memory.docs.find((d) => d._class === gitlab.class.DocSyncInfo)?._id
    await syncDoc(env, id)
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest)).toMatchObject({ state: 'merged' })
    expect(env.api.readMergeRequestRawDiffs).not.toHaveBeenCalled()
    expect(env.api.listMergeRequestCommits).not.toHaveBeenCalled()
    expect(env.api.listMergeRequestReviewers).not.toHaveBeenCalled()
    expect(env.api.getMergeRequestApprovals).not.toHaveBeenCalled()
    expect(syncDocOf(env.memory, id).reviews).toBeUndefined()
  })

  it('loads the diff and reviews of an old merge request at its next change', async () => {
    const env = setup()
    await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(3, OLD))
    const id = env.memory.docs.find((d) => d._class === gitlab.class.DocSyncInfo)?._id
    await syncDoc(env, id)
    await gitlabChange(env, id, OLD, '2026-01-10T00:00:00.000Z')
    expect(env.api.readMergeRequestRawDiffs).toHaveBeenCalledTimes(1)
    expect(env.api.getMergeRequestApprovals).toHaveBeenCalledTimes(1)
    expect(patchDocs(env.memory)).toHaveLength(1)
  })

  it('marks a merged merge request whose diff failed for a retry by the next full sync', async () => {
    const env = setup()
    env.api.readMergeRequestRawDiffs.mockRejectedValueOnce(new GitlabApiError(500, 'boom'))
    await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(3, { state: 'merged' }))
    const id = env.memory.docs.find((d) => d._class === gitlab.class.DocSyncInfo)?._id
    await syncDoc(env, id)
    expect(syncDocOf(env.memory, id)).toMatchObject({ retryable: true })
    expect(syncDocOf(env.memory, id).patchSha).toBeUndefined()
  })

  it('does not retry a diff GitLab refuses for good', async () => {
    const env = setup()
    env.api.readMergeRequestRawDiffs.mockRejectedValueOnce(new GitlabApiError(403, 'forbidden'))
    await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(3, { state: 'merged' }))
    const id = env.memory.docs.find((d) => d._class === gitlab.class.DocSyncInfo)?._id
    await syncDoc(env, id)
    expect(syncDocOf(env.memory, id).retryable).toBe(false)
  })

  it('reports a webhook for a merge request GitLab no longer returns', async () => {
    const env = setup()
    env.api.getMergeRequest.mockRejectedValueOnce(new GitlabApiError(404, 'not found'))
    expect(await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3)).toBe(false)
    env.api.getMergeRequest.mockResolvedValueOnce(gitlabMergeRequest(3))
    expect(await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3)).toBe(true)
  })
})
