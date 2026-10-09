// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import gitlab from '@hcengineering/gitlab'
import { GitlabApiError } from '../gitlab/api'
import type { GitlabDiscussion } from '../gitlab/types'
import { ReviewThreadSyncManager } from '../sync/discussions'
import { mergeRequestKey } from '../sync/keys'
import { ReviewCommentSyncManager } from '../sync/review-comments'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import {
  HOST, HULY_USER, PROJECT_ID, gitlabDiffNote, gitlabDiscussion, gitlabNote, gitlabUser, seedMergeRequest, seedRepository
} from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { asApi, createTestProvider, ctx, fakeApi, type FakeApi } from './helpers/provider'

const KEY_3 = mergeRequestKey(HOST, PROJECT_ID, 3)

interface Env {
  memory: MemoryClient
  threads: ReviewThreadSyncManager
  comments: ReviewCommentSyncManager
  api: FakeApi
  repo: any
}

/** Merge request !3 whose head commit is `headSha`. */
function setup (headSha = 'sha-2'): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  seedMergeRequest(memory, headSha)
  const api = fakeApi({
    listMergeRequestDiscussions: async () => [],
    resolveMergeRequestDiscussion: async (_p: number, _i: number, id: string, resolved: boolean) =>
      gitlabDiscussion(id, [gitlabDiffNote(51, { resolved, resolved_by: resolved ? gitlabUser(5) : null })])
  })
  const provider = createTestProvider(memory, [repo], api)
  const comments = new ReviewCommentSyncManager(provider)
  return { memory, threads: new ReviewThreadSyncManager(provider, comments), comments, api, repo }
}

const d1 = (): GitlabDiscussion => gitlabDiscussion('d1', [gitlabDiffNote(51), gitlabDiffNote(52, { author: gitlabUser(7), body: 'Reply' })])
const syncOf = (memory: MemoryClient, id: string): any => memory.docs.find((d) => d._id === id && d._class === gitlab.class.DocSyncInfo)
const threadDocs = (memory: MemoryClient): any[] => memory.docs.filter((d) => d._class === gitlab.class.GitlabReviewThread)
const commentDocs = (memory: MemoryClient): any[] => memory.docs.filter((d) => d._class === gitlab.class.GitlabReviewComment)
const infosOf = (memory: MemoryClient, objectClass: string): any[] =>
  memory.docs.filter((d) => d._class === gitlab.class.DocSyncInfo && d.objectClass === objectClass)

/** What the worker does: threads first, then comments, each with its Huly doc and parent sync doc. */
async function syncPending (env: Env): Promise<void> {
  for (const objectClass of [gitlab.class.GitlabReviewThread, gitlab.class.GitlabReviewComment]) {
    const manager = objectClass === gitlab.class.GitlabReviewThread ? env.threads : env.comments
    for (const info of infosOf(env.memory, objectClass).filter((it) => it.needSync === '')) {
      const existing = env.memory.docs.find((d) => d._id === info._id && d._class === objectClass)
      const parent = env.memory.docs.find((d) => d._class === gitlab.class.DocSyncInfo && d.key === info.parent)
      const update = await manager.sync(ctx, existing === undefined ? undefined : ({ ...existing } as any), { ...info } as any, parent === undefined ? undefined : ({ ...parent } as any))
      await env.memory.update(info, update)
    }
  }
}

async function refreshed (env: Env, discussions: GitlabDiscussion[]): Promise<void> {
  env.api.listMergeRequestDiscussions.mockResolvedValue(discussions)
  await env.threads.refreshDiscussions(ctx, env.repo, asApi(env.api), 3)
  await syncPending(env)
}

describe('ReviewThreadSyncManager', () => {
  it('does not import a discussion whose first note is internal', async () => {
    const env = setup()
    await refreshed(env, [gitlabDiscussion('d3', [gitlabDiffNote(70, { internal: true }), gitlabDiffNote(71)])])
    expect(threadDocs(env.memory)).toHaveLength(0)
    expect(commentDocs(env.memory)).toHaveLength(0)
  })

  it('imports a diff discussion as a thread with its position, and its notes as comments; other discussions stay out', async () => {
    const env = setup()
    await refreshed(env, [d1(), gitlabDiscussion('d2', [gitlabNote(60, { noteable_type: 'MergeRequest', type: 'DiscussionNote' })])])
    expect(threadDocs(env.memory)).toEqual([
      expect.objectContaining({
        attachedTo: 'mr-1', attachedToClass: gitlab.class.GitlabMergeRequest, collection: 'activity', discussionId: 'd1',
        path: 'src/a.ts', oldPath: 'src/a.ts', line: 12, oldLine: null, isResolved: false, resolvedBy: null,
        isOutdated: false, modifiedBy: 'sid-2'
      })
    ])
    expect(syncOf(env.memory, threadDocs(env.memory)[0]._id)).toMatchObject({
      key: `${KEY_3}/discussions/d1`, parent: KEY_3, needSync: GITLAB_SYNC_VERSION, current: { isResolved: false }
    })
    expect(commentDocs(env.memory).map((it) => it.discussionId)).toEqual(['d1', 'd1'])
  })

  it('marks a thread outdated when the merge request has a newer head commit', async () => {
    const env = setup('sha-3')
    await refreshed(env, [d1()])
    expect(threadDocs(env.memory)[0].isOutdated).toBe(true)
  })

  it('follows the position GitLab moves a thread to after a push', async () => {
    const env = setup()
    await refreshed(env, [d1()])
    const moved = {
      base_sha: 'base', start_sha: 'base', head_sha: 'sha-2', position_type: 'text',
      old_path: 'src/a.ts', new_path: 'src/b.ts', old_line: 9, new_line: 15
    }
    await refreshed(env, [gitlabDiscussion('d1', [gitlabDiffNote(51, { position: moved }), gitlabDiffNote(52, { author: gitlabUser(7), body: 'Reply' })])])
    expect(threadDocs(env.memory)[0]).toMatchObject({ path: 'src/b.ts', oldPath: 'src/a.ts', line: 15, oldLine: 9, isOutdated: false })
  })

  it('resolves the discussion in GitLab when a Huly user resolves the thread', async () => {
    const env = setup()
    await refreshed(env, [d1()])
    const thread = threadDocs(env.memory)[0]
    await env.memory.update(thread, { isResolved: true, resolvedBy: HULY_USER }, false, Date.now(), HULY_USER)
    await env.memory.update(syncOf(env.memory, thread._id), { needSync: '' })
    await syncPending(env)
    expect(env.api.resolveMergeRequestDiscussion).toHaveBeenCalledWith(PROJECT_ID, 3, 'd1', true)
    expect(syncOf(env.memory, thread._id)).toMatchObject({ current: { isResolved: true }, external: { resolved: true } })
    expect(threadDocs(env.memory)[0]).toMatchObject({ isResolved: true, resolvedBy: HULY_USER })
  })

  it('shows a thread resolved in GitLab as resolved by its resolver', async () => {
    const env = setup()
    await refreshed(env, [d1()])
    const resolved = { resolved: true, resolved_by: gitlabUser(7) }
    await refreshed(env, [gitlabDiscussion('d1', [gitlabDiffNote(51, resolved), gitlabDiffNote(52, { ...resolved, author: gitlabUser(7), body: 'Reply' })])])
    expect(threadDocs(env.memory)[0]).toMatchObject({ isResolved: true, resolvedBy: 'sid-7' })
    expect(env.api.resolveMergeRequestDiscussion).not.toHaveBeenCalled()
  })

  it('removes the thread and its comments when the discussion is gone from GitLab', async () => {
    const env = setup()
    await refreshed(env, [d1()])
    await refreshed(env, [])
    expect(threadDocs(env.memory)).toEqual([])
    expect(commentDocs(env.memory)).toEqual([])
    expect(infosOf(env.memory, gitlab.class.GitlabReviewThread)).toEqual([])
    expect(infosOf(env.memory, gitlab.class.GitlabReviewComment)).toEqual([])
  })

  it('keeps a thread deleted in Huly out of Huly, and GitLab untouched', async () => {
    const env = setup()
    await refreshed(env, [d1()])
    const thread = threadDocs(env.memory)[0]
    env.memory.docs.splice(env.memory.docs.indexOf(thread), 1)
    const info = syncOf(env.memory, thread._id)
    await env.memory.update(info, { deleted: true })
    expect(await env.threads.handleDelete(ctx, { ...info })).toBe(false)
    await env.memory.update(info, { needSync: GITLAB_SYNC_VERSION })
    await refreshed(env, [d1()])
    expect(threadDocs(env.memory)).toEqual([])
    expect(syncOf(env.memory, thread._id).deleted).toBe(true)
    expect(env.api.resolveMergeRequestDiscussion).not.toHaveBeenCalled()
  })

  it('fetches the discussion a diff note webhook names, and removes the thread on 404', async () => {
    const env = setup()
    env.api.getMergeRequestDiscussion.mockResolvedValueOnce(d1())
    await env.threads.handleDiscussionEvent(ctx, env.repo, asApi(env.api), 3, 'd1')
    await syncPending(env)
    expect(threadDocs(env.memory)).toHaveLength(1)
    env.api.getMergeRequestDiscussion.mockRejectedValueOnce(new GitlabApiError(404, 'gone'))
    await env.threads.handleDiscussionEvent(ctx, env.repo, asApi(env.api), 3, 'd1')
    expect(threadDocs(env.memory)).toEqual([])
    expect(commentDocs(env.memory)).toEqual([])
  })

  it('ignores threads that start in Huly', async () => {
    const env = setup()
    const update = await env.threads.sync(ctx, undefined, { _id: 'x', key: '', objectClass: gitlab.class.GitlabReviewThread } as any, undefined)
    expect(update).toEqual({ needSync: GITLAB_SYNC_VERSION })
  })
})
