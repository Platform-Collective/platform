// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import gitlab from '@hcengineering/gitlab'
import type { GitlabDiscussionNote } from '../gitlab/types'
import { discussionKey, mergeRequestKey } from '../sync/keys'
import { ReviewCommentSyncManager } from '../sync/review-comments'
import type { ImageStore } from '../sync/types'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import {
  HOST,
  HULY_USER,
  PROJECT_ID,
  gitlabDiffNote,
  gitlabUser,
  seedMergeRequest,
  seedRepository,
  setImageMode
} from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { docOf, syncDocOf } from './helpers/sync'
import { createTestProvider, ctx, fakeApi, fakeImages, type FakeApi, type TestProvider } from './helpers/provider'

const KEY_3 = mergeRequestKey(HOST, PROJECT_ID, 3)
const THREAD = discussionKey(KEY_3, 'd1')

interface Env {
  memory: MemoryClient
  comments: ReviewCommentSyncManager
  api: FakeApi
  provider: TestProvider
  repo: any
}

/** Merge request !3 with a synced thread for discussion d1. */
function setup (options: { images?: ImageStore } = {}): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  seedMergeRequest(memory)
  memory.docs.push({
    _id: 'thr-1',
    _class: gitlab.class.GitlabReviewThread,
    space: 'prj-1',
    attachedTo: 'mr-1',
    attachedToClass: gitlab.class.GitlabMergeRequest,
    collection: 'activity',
    discussionId: 'd1',
    path: 'src/a.ts',
    oldPath: 'src/a.ts',
    line: 12,
    oldLine: null,
    isResolved: false,
    resolvedBy: null,
    isOutdated: false
  })
  memory.docs.push({
    _id: 'thr-1',
    _class: gitlab.class.DocSyncInfo,
    space: 'prj-1',
    key: THREAD,
    parent: KEY_3,
    objectClass: gitlab.class.GitlabReviewThread,
    repository: 'repo-1',
    gitlabIid: 0,
    needSync: GITLAB_SYNC_VERSION
  })
  const api = fakeApi({
    createMergeRequestDiscussionNote: async (_p: number, _i: number, _d: string, body: string) =>
      gitlabDiffNote(90, { body, author: gitlabUser(5) }),
    updateMergeRequestDiscussionNote: async (_p: number, _i: number, _d: string, id: number, body: string) =>
      gitlabDiffNote(id, { body, updated_at: '2026-01-03T00:00:00.000Z' }),
    deleteMergeRequestDiscussionNote: async () => {}
  })
  const provider = createTestProvider(memory, [repo], api, options)
  return { memory, comments: new ReviewCommentSyncManager(provider), api, provider, repo }
}

const commentDocs = (memory: MemoryClient): any[] =>
  memory.docs.filter((d) => d._class === gitlab.class.GitlabReviewComment)
const commentInfos = (memory: MemoryClient): any[] =>
  memory.docs.filter((d) => d._class === gitlab.class.DocSyncInfo && d.objectClass === gitlab.class.GitlabReviewComment)

/** What the worker does for pending comments: sync each with its Huly doc and parent sync doc, store the result. */
async function syncPending (env: Env): Promise<void> {
  for (const info of commentInfos(env.memory).filter((it) => it.needSync === '')) {
    const existing = docOf(env.memory, info._id, gitlab.class.GitlabReviewComment)
    const parent = env.memory.docs.find(
      (d) =>
        d._class === gitlab.class.DocSyncInfo &&
        (info.parent !== undefined ? d.key === info.parent : d._id === info.attachedTo)
    )
    const update = await env.comments.sync(
      ctx,
      existing === undefined ? undefined : { ...existing },
      { ...info },
      parent === undefined ? undefined : ({ ...parent } as any)
    )
    await env.memory.update(info, update)
  }
}

async function imported (env: Env, notes: GitlabDiscussionNote[]): Promise<void> {
  await env.comments.storeNotes(ctx, env.repo, THREAD, notes)
  await syncPending(env)
}

/** A reply written in Huly into `discussionId`, queued by the trigger. */
function hulyReply (env: Env, discussionId = 'd1'): void {
  env.memory.docs.push({
    _id: 'c-1',
    _class: gitlab.class.GitlabReviewComment,
    space: 'prj-1',
    attachedTo: 'mr-1',
    attachedToClass: gitlab.class.GitlabMergeRequest,
    collection: 'reviewComments',
    discussionId,
    body: env.provider.markdown.toMarkup('Looks good'),
    modifiedBy: HULY_USER
  })
  env.memory.docs.push({
    _id: 'c-1',
    _class: gitlab.class.DocSyncInfo,
    space: 'prj-1',
    key: '',
    objectClass: gitlab.class.GitlabReviewComment,
    repository: null,
    gitlabIid: 0,
    attachedTo: 'mr-1',
    needSync: ''
  })
}

describe('ReviewCommentSyncManager', () => {
  it('never stores an internal or confidential note of a diff discussion', async () => {
    const env = setup()
    await imported(env, [
      gitlabDiffNote(51),
      gitlabDiffNote(52, { internal: true }),
      gitlabDiffNote(53, { confidential: true })
    ])
    expect(commentDocs(env.memory)).toHaveLength(1)
    expect(commentInfos(env.memory)).toHaveLength(1)
  })

  it('imports the notes of a discussion as review comments written by their authors, without system notes', async () => {
    const env = setup()
    await imported(env, [
      gitlabDiffNote(51),
      gitlabDiffNote(52, { author: gitlabUser(7), body: 'Reply' }),
      gitlabDiffNote(53, { system: true })
    ])
    expect(
      commentDocs(env.memory).map((it) => [
        it.attachedTo,
        it.attachedToClass,
        it.collection,
        it.discussionId,
        it.modifiedBy
      ])
    ).toEqual([
      ['mr-1', gitlab.class.GitlabMergeRequest, 'reviewComments', 'd1', 'sid-2'],
      ['mr-1', gitlab.class.GitlabMergeRequest, 'reviewComments', 'd1', 'sid-7']
    ])
    expect(commentDocs(env.memory)[1].body).toBe(env.provider.markdown.toMarkup('Reply'))
    expect(commentInfos(env.memory).map((it) => it.key)).toEqual([`${THREAD}/notes/51`, `${THREAD}/notes/52`])
  })

  it('waits for its thread', async () => {
    const env = setup()
    env.memory.docs.splice(
      env.memory.docs.findIndex((d) => d._class === gitlab.class.GitlabReviewThread),
      1
    )
    await imported(env, [gitlabDiffNote(51)])
    expect(commentDocs(env.memory)).toEqual([])
    expect(commentInfos(env.memory).map((it) => it.needSync)).toEqual([GITLAB_SYNC_VERSION])
  })

  it('sends a reply written in Huly to its discussion', async () => {
    const env = setup()
    hulyReply(env)
    await syncPending(env)
    expect(env.api.createMergeRequestDiscussionNote).toHaveBeenCalledWith(PROJECT_ID, 3, 'd1', 'Looks good')
    expect(syncDocOf(env.memory, 'c-1')).toMatchObject({
      key: `${THREAD}/notes/90`,
      parent: THREAD,
      repository: 'repo-1',
      needSync: GITLAB_SYNC_VERSION
    })
  })

  it('does not send a GitLab note back, nor import its own reply twice', async () => {
    const env = setup()
    hulyReply(env)
    await syncPending(env)
    await imported(env, [gitlabDiffNote(51), gitlabDiffNote(90, { body: 'Looks good', author: gitlabUser(5) })])
    // The trigger queues imported comments again, because the pod wrote them as their GitLab authors
    for (const info of commentInfos(env.memory)) await env.memory.update(info, { needSync: '' })
    await syncPending(env)
    expect(env.api.createMergeRequestDiscussionNote).toHaveBeenCalledTimes(1)
    expect(env.api.updateMergeRequestDiscussionNote).not.toHaveBeenCalled()
    expect(commentDocs(env.memory)).toHaveLength(2)
  })

  it('records an error for a reply to an unknown discussion', async () => {
    const env = setup()
    hulyReply(env, 'zz')
    await syncPending(env)
    expect(env.api.createMergeRequestDiscussionNote).not.toHaveBeenCalled()
    expect(syncDocOf(env.memory, 'c-1')).toMatchObject({ key: '', retryable: false })
    expect(syncDocOf(env.memory, 'c-1').error).toContain('unknown')
  })

  it('mirrors a GitLab edit, and pushes a Huly edit', async () => {
    const env = setup()
    await imported(env, [gitlabDiffNote(51)])
    await imported(env, [gitlabDiffNote(51, { body: 'Edited', updated_at: '2026-01-02T00:00:00.000Z' })])
    const comment = commentDocs(env.memory)[0]
    expect(comment.body).toBe(env.provider.markdown.toMarkup('Edited'))
    await env.memory.update(comment, { body: env.provider.markdown.toMarkup('Mine') }, false, Date.now(), HULY_USER)
    await env.memory.update(syncDocOf(env.memory, comment._id), { needSync: '' })
    await syncPending(env)
    expect(env.api.updateMergeRequestDiscussionNote).toHaveBeenCalledWith(PROJECT_ID, 3, 'd1', 51, 'Mine')
  })

  it('removes a Huly comment whose note is gone from GitLab', async () => {
    const env = setup()
    await imported(env, [gitlabDiffNote(51), gitlabDiffNote(52)])
    await env.comments.storeNotes(ctx, env.repo, THREAD, [gitlabDiffNote(51)])
    expect(commentDocs(env.memory)).toHaveLength(1)
    expect(commentInfos(env.memory).map((it) => it.key)).toEqual([`${THREAD}/notes/51`])
  })

  it('deletes the GitLab note of a comment deleted in Huly', async () => {
    const env = setup()
    await imported(env, [gitlabDiffNote(51)])
    const info = commentInfos(env.memory)[0]
    expect(await env.comments.handleDelete(ctx, { ...info, deleted: true })).toBe(true)
    expect(env.api.deleteMergeRequestDiscussionNote).toHaveBeenCalledWith(PROJECT_ID, 3, 'd1', 51)
  })

  it('copies a GitLab image into an imported review comment', async () => {
    const env = setup({ images: fakeImages() })
    setImageMode(env.repo, 'copy')
    env.api.downloadUpload.mockResolvedValue({ data: Buffer.from('png'), contentType: 'image/png' })
    await imported(env, [gitlabDiffNote(51, { body: '![shot](/uploads/0123456789abcdef0123456789abcdef/shot.png)' })])
    expect(commentDocs(env.memory)[0].body).toBe(
      env.provider.markdown.toMarkup('![shot](http://front/files?file=blob-1)')
    )
  })
})
