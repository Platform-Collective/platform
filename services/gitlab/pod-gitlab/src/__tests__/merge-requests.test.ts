// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import activity from '@hcengineering/activity'
import attachment from '@hcengineering/attachment'
import gitlab from '@hcengineering/gitlab'
import { GitlabApiError } from '../gitlab/api'
import { mergeRequestKey } from '../sync/keys'
import type { ImageStore } from '../sync/types'
import { MERGE_REQUEST_MOVED, MergeRequestSyncManager } from '../sync/merge-requests'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import {
  HOST,
  MR_TASK_TYPE,
  PROJECT_ID,
  gitlabDiffNote,
  gitlabDiscussion,
  gitlabMergeRequest,
  gitlabNote,
  gitlabUser,
  seedMergeRequest,
  seedRepository,
  setImageMode
} from './helpers/fixtures'
import { NoteSyncManager } from '../sync/notes'
import { ReviewThreadSyncManager } from '../sync/discussions'
import { ReviewCommentSyncManager } from '../sync/review-comments'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { docOf, runSync, syncDocOf, syncDocsOf } from './helpers/sync'
import {
  asApi,
  createTestProvider,
  ctx,
  fakeApi,
  fakeImages,
  type FakeApi,
  type TestProvider
} from './helpers/provider'

const KEY_3 = mergeRequestKey(HOST, PROJECT_ID, 3)

interface Env {
  memory: MemoryClient
  provider: TestProvider
  mergeRequests: MergeRequestSyncManager
  api: FakeApi
  repo: any
}

function setup (api: FakeApi = fakeApi(), options: { images?: ImageStore } = {}): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  const provider = createTestProvider(memory, [repo], api, options)
  return { memory, provider, mergeRequests: new MergeRequestSyncManager(provider), api, repo }
}

const syncDoc = async (env: Env, id: string): Promise<any> =>
  await runSync(env.mergeRequests, env.memory, id, gitlab.class.GitlabMergeRequest)

/** Imports GitLab merge request !3 and returns its id. */
async function imported (env: Env, overrides: any = {}): Promise<string> {
  await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(3, overrides))
  const info = syncDocsOf(env.memory)[0]
  await syncDoc(env, info._id)
  return info._id
}

/** A newer GitLab version of !3, delivered by a webhook sent by GitLab user 5. */
async function gitlabChange (env: Env, overrides: any): Promise<void> {
  env.api.getMergeRequest.mockResolvedValueOnce(
    gitlabMergeRequest(3, { updated_at: '2026-01-02T00:00:00.000Z', ...overrides })
  )
  await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3, 'sid-5' as any)
}

describe('MergeRequestSyncManager: GitLab to Huly', () => {
  it('creates a Huly merge request with its mirrored fields', async () => {
    const env = setup()
    const id = await imported(env, { assignees: [gitlabUser(7)], reviewers: [gitlabUser(8)], draft: true })
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest)).toMatchObject({
      title: 'MR 3',
      status: 'st-mr-open',
      kind: MR_TASK_TYPE,
      assignee: 'person-7',
      reviewers: ['person-8'],
      identifier: 'PRJ-1',
      modifiedBy: 'sid-1',
      url: `${HOST}/group/proj/-/merge_requests/3`,
      gitlabIid: 3,
      repository: 'repo-1',
      state: 'opened',
      draft: true,
      sourceBranch: 'feature',
      targetBranch: 'main',
      mergeStatus: 'mergeable',
      hasConflicts: false,
      mergedAt: null
    })
    expect(env.provider.collab.store.get(`${id}:description`)).toBe(env.provider.markdown.toMarkup('MR body 3'))
    expect(env.memory.docs.find((d) => d._class === activity.class.ActivityInfoMessage)).toMatchObject({
      attachedTo: id,
      message: gitlab.string.MergeRequestConnectedActivityInfo,
      props: { number: 3, repoName: 'group/proj' }
    })
    expect(syncDocOf(env.memory, id)).toMatchObject({
      key: KEY_3,
      needSync: GITLAB_SYNC_VERSION,
      current: { state: 'opened', reviewers: ['person-8'], assignee: 'person-7' }
    })
  })

  it('imports merged and closed merge requests as Merged and Closed', async () => {
    const env = setup()
    await env.mergeRequests.receive(
      ctx,
      env.repo,
      gitlabMergeRequest(3, { state: 'merged', merged_at: '2026-01-03T00:00:00.000Z' })
    )
    await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(4, { state: 'closed' }))
    for (const info of syncDocsOf(env.memory)) await syncDoc(env, info._id)
    const result = env.memory.docs
      .filter((d) => d._class === gitlab.class.GitlabMergeRequest)
      .map((d) => [d.gitlabIid, d.status, d.mergedAt])
    expect(result).toEqual([
      [3, 'st-mr-merged', Date.parse('2026-01-03T00:00:00.000Z')],
      [4, 'st-mr-closed', null]
    ])
  })

  it('applies a GitLab change and refreshes the mirrored fields, as the GitLab user who made it', async () => {
    const env = setup()
    const id = await imported(env)
    await gitlabChange(env, { title: 'Renamed in GitLab', detailed_merge_status: 'conflict', has_conflicts: true })
    await syncDoc(env, id)
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest)).toMatchObject({
      title: 'Renamed in GitLab',
      mergeStatus: 'conflict',
      hasConflicts: true,
      modifiedBy: 'sid-5'
    })
  })

  it('ignores a webhook echo with the same updated_at', async () => {
    const env = setup()
    const id = await imported(env)
    env.provider.triggerSync.mockClear()
    env.api.getMergeRequest.mockResolvedValueOnce(gitlabMergeRequest(3))
    await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3)
    expect(syncDocOf(env.memory, id).needSync).toBe(GITLAB_SYNC_VERSION)
    expect(env.provider.triggerSync).not.toHaveBeenCalled()
  })

  it('ignores a merge request webhook GitLab answers with 404', async () => {
    const env = setup()
    env.api.getMergeRequest.mockRejectedValueOnce(new GitlabApiError(404, 'not found'))
    await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3)
    expect(syncDocsOf(env.memory)).toEqual([])
  })

  it('records a retryable error while the project has no merge request task type', async () => {
    const env = setup()
    env.provider.mergeRequestTaskType = async () => undefined
    await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(3))
    const update = await syncDoc(env, syncDocsOf(env.memory)[0]._id)
    expect(update).toMatchObject({ error: expect.stringContaining('task type'), retryable: true })
    expect(env.memory.docs.find((d) => d._class === gitlab.class.GitlabMergeRequest)).toBeUndefined()
  })
})

describe('MergeRequestSyncManager: Huly to GitLab', () => {
  it('pushes a Huly title, reviewer and close to GitLab', async () => {
    const env = setup()
    const id = await imported(env)
    env.api.updateMergeRequest.mockResolvedValueOnce(
      gitlabMergeRequest(3, {
        title: 'Huly title',
        reviewers: [gitlabUser(9)],
        state: 'closed',
        updated_at: '2026-01-02T00:00:00.000Z'
      })
    )
    Object.assign(docOf(env.memory, id, gitlab.class.GitlabMergeRequest), {
      title: 'Huly title',
      reviewers: ['person-9'],
      status: 'st-mr-closed'
    })
    await syncDoc(env, id)
    expect(env.api.updateMergeRequest).toHaveBeenCalledWith(PROJECT_ID, 3, {
      title: 'Huly title',
      reviewer_ids: [9],
      state_event: 'close'
    })
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest)).toMatchObject({
      state: 'closed',
      status: 'st-mr-closed'
    })
    expect(syncDocOf(env.memory, id).current).toMatchObject({
      title: 'Huly title',
      reviewers: ['person-9'],
      state: 'closed'
    })
  })

  it('reopens a closed merge request moved to an open status in Huly', async () => {
    const env = setup()
    const id = await imported(env, { state: 'closed' })
    env.api.updateMergeRequest.mockResolvedValueOnce(
      gitlabMergeRequest(3, { state: 'opened', updated_at: '2026-01-02T00:00:00.000Z' })
    )
    docOf(env.memory, id, gitlab.class.GitlabMergeRequest).status = 'st-mr-open'
    await syncDoc(env, id)
    expect(env.api.updateMergeRequest).toHaveBeenCalledWith(PROJECT_ID, 3, { state_event: 'reopen' })
  })

  it('removes every GitLab reviewer when Huly clears them', async () => {
    const env = setup()
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    env.api.updateMergeRequest.mockResolvedValueOnce(
      gitlabMergeRequest(3, { reviewers: [], updated_at: '2026-01-02T00:00:00.000Z' })
    )
    docOf(env.memory, id, gitlab.class.GitlabMergeRequest).reviewers = []
    await syncDoc(env, id)
    expect(env.api.updateMergeRequest).toHaveBeenCalledWith(PROJECT_ID, 3, { reviewer_ids: [0] })
  })

  it('reverts a Merged status set in Huly on an open merge request, without calling GitLab', async () => {
    const env = setup()
    const id = await imported(env)
    docOf(env.memory, id, gitlab.class.GitlabMergeRequest).status = 'st-mr-merged'
    await syncDoc(env, id)
    expect(env.api.updateMergeRequest).not.toHaveBeenCalled()
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest).status).toBe('st-mr-open')
    expect(syncDocOf(env.memory, id).current.state).toBe('opened')
  })

  it('keeps the state of a merged merge request', async () => {
    const env = setup()
    const id = await imported(env, { state: 'merged' })
    docOf(env.memory, id, gitlab.class.GitlabMergeRequest).status = 'st-mr-closed'
    await syncDoc(env, id)
    expect(env.api.updateMergeRequest).not.toHaveBeenCalled()
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest).status).toBe('st-mr-merged')
  })

  it('keeps a Huly reviewer without a GitLab identity, also after a GitLab change', async () => {
    const env = setup()
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    docOf(env.memory, id, gitlab.class.GitlabMergeRequest).reviewers = ['person-8', 'person-huly']
    await syncDoc(env, id)
    expect(env.api.updateMergeRequest).not.toHaveBeenCalled()
    await gitlabChange(env, { reviewers: [gitlabUser(8), gitlabUser(9)] })
    await syncDoc(env, id)
    expect(
      [...docOf(env.memory, id, gitlab.class.GitlabMergeRequest).reviewers].sort((a: string, b: string) =>
        a.localeCompare(b)
      )
    ).toEqual(['person-8', 'person-9', 'person-huly'])
  })

  it('never creates a merge request in GitLab', async () => {
    const env = setup()
    env.memory.docs.push({
      _id: 'mr-x',
      _class: gitlab.class.DocSyncInfo,
      space: 'prj-1',
      key: '',
      objectClass: gitlab.class.GitlabMergeRequest,
      repository: null,
      gitlabIid: 0,
      needSync: ''
    })
    expect(await syncDoc(env, 'mr-x')).toEqual({ needSync: GITLAB_SYNC_VERSION })
  })

  it('keeps the sync doc of a merge request deleted in Huly, so it is not imported again', async () => {
    const env = setup()
    const id = await imported(env)
    expect(await env.mergeRequests.handleDelete(ctx, syncDocOf(env.memory, id))).toBe(false)
  })
})

describe('MergeRequestSyncManager: approvals keep updated_at', () => {
  it('re-queues the same version when the webhook reports an approval, and only then', async () => {
    const env = setup()
    const id = await imported(env)
    env.api.getMergeRequest.mockResolvedValue(gitlabMergeRequest(3))
    await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3, 'sid-5' as any)
    expect(syncDocOf(env.memory, id).needSync).toBe(GITLAB_SYNC_VERSION)
    await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3, 'sid-5' as any, true)
    expect(syncDocOf(env.memory, id).needSync).toBe('')
  })

  it('still drops an older version that arrives with an approval event', async () => {
    const env = setup()
    const id = await imported(env, { updated_at: '2026-01-05T00:00:00.000Z' })
    env.api.getMergeRequest.mockResolvedValue(gitlabMergeRequest(3, { updated_at: '2026-01-04T00:00:00.000Z' }))
    await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3, undefined, true)
    expect(syncDocOf(env.memory, id).needSync).toBe(GITLAB_SYNC_VERSION)
  })

  it('re-queues open merge requests that are in sync, and leaves merged ones', async () => {
    const env = setup()
    const open = await imported(env)
    await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(4, { state: 'merged' }))
    const merged = syncDocsOf(env.memory).find((it) => it.gitlabIid === 4)._id
    await syncDoc(env, merged)
    env.provider.triggerSync.mockClear()
    expect(await env.mergeRequests.requeueOpen(env.repo)).toEqual([3])
    expect(syncDocOf(env.memory, open).needSync).toBe('')
    expect(syncDocOf(env.memory, merged).needSync).toBe(GITLAB_SYNC_VERSION)
    expect(env.provider.triggerSync).toHaveBeenCalled()
  })
})

describe('MergeRequestSyncManager: moved in Huly', () => {
  it('imports no GitLab notes or threads under a detached merge request', async () => {
    const env = setup(
      fakeApi({
        listNotes: async () => [gitlabNote(41, { noteable_type: 'MergeRequest', noteable_iid: 3 })],
        getNote: async () => gitlabNote(42, { noteable_type: 'MergeRequest', noteable_iid: 3 }),
        listMergeRequestDiscussions: async () => [gitlabDiscussion('d1', [gitlabDiffNote(51)])],
        getMergeRequestDiscussion: async () => gitlabDiscussion('d2', [gitlabDiffNote(52)])
      })
    )
    seedMergeRequest(env.memory)
    const mr = env.memory.docs.find((d) => d._id === 'mr-1' && d._class === gitlab.class.GitlabMergeRequest) as any
    mr.space = 'prj-2'
    const info = env.memory.docs.find((d) => d._id === 'mr-1' && d._class === gitlab.class.DocSyncInfo) as any
    await env.mergeRequests.handleMove(ctx, { ...mr }, { ...info })
    const notes = new NoteSyncManager(env.provider)
    const threads = new ReviewThreadSyncManager(env.provider, new ReviewCommentSyncManager(env.provider))
    const api = asApi(env.api)
    await notes.refreshNotes(ctx, env.repo, api, { iid: 3 }, 'merge_requests')
    await notes.handleNoteEvent(ctx, env.repo, api, 3, 42, 'merge_requests')
    await threads.refreshDiscussions(ctx, env.repo, api, 3)
    await threads.handleDiscussionEvent(ctx, env.repo, api, 3, 'd2')
    expect(env.memory.docs.filter((d) => d._class === gitlab.class.DocSyncInfo && d._id !== 'mr-1')).toEqual([])
  })

  it('detaches the merge request: GitLab unchanged, the sync doc a tombstone, the error shown', async () => {
    const env = setup()
    seedMergeRequest(env.memory)
    const mr = env.memory.docs.find((d) => d._id === 'mr-1' && d._class === gitlab.class.GitlabMergeRequest) as any
    mr.space = 'prj-2'
    const info = env.memory.docs.find((d) => d._id === 'mr-1' && d._class === gitlab.class.DocSyncInfo) as any
    await env.mergeRequests.handleMove(ctx, { ...mr }, { ...info })
    expect(mr.syncError).toBe(MERGE_REQUEST_MOVED)
    expect(info).toMatchObject({ deleted: true, retryable: false, error: MERGE_REQUEST_MOVED })
    // A later GitLab change does not import it again into the repository's project
    await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(3, { updated_at: '2026-02-01T00:00:00.000Z' }))
    expect(
      env.memory.docs.filter(
        (d) => d._class === gitlab.class.DocSyncInfo && d.objectClass === gitlab.class.GitlabMergeRequest
      )
    ).toHaveLength(1)
  })
})

describe('MergeRequestSyncManager: images', () => {
  it('copies a GitLab image into the Huly description', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const env = setup(fakeApi(), { images: fakeImages() })
    setImageMode(env.repo, 'copy')
    env.api.downloadUpload.mockResolvedValue({ data: Buffer.from('png'), contentType: 'image/png' })
    const id = await imported(env, { description: `![shot](/uploads/${S}/shot.png)` })
    expect(env.provider.collab.store.get(`${id}:description`)).toBe(
      env.provider.markdown.toMarkup('![shot](http://front/files?file=blob-1)')
    )
  })
  it('records the images left on GitLab on the merge request', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const env = setup(fakeApi(), { images: fakeImages() })
    const id = await imported(env, { description: `See ![shot](/uploads/${S}/shot.png)` })
    const absolute = `${HOST}/-/project/${PROJECT_ID}/uploads/${S}/shot.png`
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest).images).toEqual([absolute])
    await gitlabChange(env, { description: 'No images now' })
    await syncDoc(env, id)
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest).images).toEqual([])
  })
  it('reads the images of the description GitLab returned after a push', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const env = setup(fakeApi(), { images: fakeImages() })
    const id = await imported(env, { description: 'Plain' })
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest).images).toEqual([])
    const absolute = `${HOST}/-/project/${PROJECT_ID}/uploads/${S}/shot.png`
    env.api.updateMergeRequest.mockResolvedValue(
      gitlabMergeRequest(3, {
        description: `Edited ![shot](/uploads/${S}/shot.png)`,
        updated_at: '2026-01-05T00:00:00.000Z'
      })
    )
    env.provider.collab.store.set(
      `${id}:description`,
      env.provider.markdown.toMarkup(`Edited [shot](${absolute}#gitlab-image)`)
    )
    syncDocOf(env.memory, id).needSync = ''
    await syncDoc(env, id)
    expect(env.api.updateMergeRequest).toHaveBeenCalledWith(
      PROJECT_ID,
      3,
      expect.objectContaining({ description: `Edited ![shot](/uploads/${S}/shot.png)` })
    )
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest).images).toEqual([absolute])
  })
  it('sends a description again when GitLab still shows a Huly image link', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const images = fakeImages()
    images.blobs.set('huly-1', { data: Buffer.from('png'), contentType: 'image/png' })
    const env = setup(fakeApi(), { images })
    env.api.uploadFile.mockResolvedValue({ alt: 'photo', url: `/uploads/${S}/photo.png`, full_path: '', markdown: '' })
    // The image is a file of the project
    env.memory.docs.push({
      _id: 'att-huly-1',
      _class: attachment.class.Attachment,
      space: 'prj-1',
      attachedTo: 'mr-other',
      attachedToClass: gitlab.class.GitlabMergeRequest,
      collection: 'attachments',
      file: 'huly-1',
      name: 'photo.png',
      type: 'image/png',
      size: 3
    })
    env.api.updateMergeRequest.mockResolvedValue(
      gitlabMergeRequest(3, {
        description: `![photo](/uploads/${S}/photo.png)`,
        updated_at: '2026-01-03T00:00:00.000Z'
      })
    )
    const id = await imported(env, { description: '![photo](http://front/files?file=huly-1)' })
    syncDocOf(env.memory, id).needSync = ''
    await syncDoc(env, id)
    expect(env.api.updateMergeRequest).toHaveBeenCalledWith(
      PROJECT_ID,
      3,
      expect.objectContaining({ description: `![photo](/uploads/${S}/photo.png)` })
    )
  })
})
