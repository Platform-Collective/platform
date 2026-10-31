// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import gitlab from '@hcengineering/gitlab'
import { GitlabApiError } from '../gitlab/api'
import type { GitlabUserRef } from '../gitlab/types'
import { mergeRequestKey } from '../sync/keys'
import { ReviewSyncManager } from '../sync/reviews'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import { HOST, HULY_USER, PROJECT_ID, gitlabUser, seedMergeRequest, seedRepository } from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { createTestProvider, ctx, fakeApi, type FakeApi, type TestProvider } from './helpers/provider'

const KEY_3 = mergeRequestKey(HOST, PROJECT_ID, 3)

interface Env {
  memory: MemoryClient
  reviews: ReviewSyncManager
  api: FakeApi
  provider: TestProvider
}

function setup (ownUser?: GitlabUserRef | null): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  seedMergeRequest(memory)
  const api = fakeApi({
    getMergeRequestApprovals: async () => ({ approved_by: [] }),
    approveMergeRequest: async () => {},
    unapproveMergeRequest: async () => {}
  })
  const provider = createTestProvider(memory, [repo], api, { ownUser })
  return { memory, reviews: new ReviewSyncManager(provider), api, provider }
}

const docOf = (memory: MemoryClient, id: string, _class: string): any =>
  memory.docs.find((d) => d._id === id && d._class === _class)

/** A review message a Huly user created through the approvals footer, queued by the trigger. */
function hulyReview (memory: MemoryClient, state: string, key = ''): void {
  memory.docs.push({
    _id: 'rv-1',
    _class: gitlab.class.GitlabReview,
    space: 'prj-1',
    attachedTo: 'mr-1',
    attachedToClass: gitlab.class.GitlabMergeRequest,
    collection: 'activity',
    state,
    createdBy: HULY_USER,
    modifiedBy: HULY_USER,
    createdOn: 1000,
    modifiedOn: 1000
  })
  memory.docs.push({
    _id: 'rv-1',
    _class: gitlab.class.DocSyncInfo,
    space: 'prj-1',
    key,
    objectClass: gitlab.class.GitlabReview,
    repository: null,
    gitlabIid: 0,
    attachedTo: 'mr-1',
    needSync: ''
  })
}

async function syncReview (env: Env): Promise<any> {
  const info = docOf(env.memory, 'rv-1', gitlab.class.DocSyncInfo)
  const review = docOf(env.memory, 'rv-1', gitlab.class.GitlabReview)
  const parent = docOf(env.memory, 'mr-1', gitlab.class.DocSyncInfo)
  const update = await env.reviews.sync(
    ctx,
    review === undefined ? undefined : { ...review },
    { ...info },
    { ...parent }
  )
  await env.memory.update(info, update)
  return update
}

describe('ReviewSyncManager', () => {
  it("approves with the reviewer's own token and records the approval on the merge request", async () => {
    const env = setup()
    hulyReview(env.memory, 'approved')
    const update = await syncReview(env)
    expect(env.api.approveMergeRequest).toHaveBeenCalledWith(PROJECT_ID, 3)
    expect(update).toMatchObject({
      key: `${KEY_3}/reviews/5/1000`,
      parent: KEY_3,
      repository: 'repo-1',
      needSync: GITLAB_SYNC_VERSION,
      error: null
    })
    expect(docOf(env.memory, 'mr-1', gitlab.class.DocSyncInfo)).toMatchObject({
      reviews: { 5: { user: gitlabUser(5), state: 'approved' } },
      needSync: ''
    })
    expect(env.provider.triggerSync).toHaveBeenCalled()
  })

  it('does not approve twice', async () => {
    const env = setup()
    env.api.getMergeRequestApprovals.mockResolvedValue({ approved_by: [{ user: gitlabUser(5) }] })
    hulyReview(env.memory, 'approved')
    await syncReview(env)
    expect(env.api.approveMergeRequest).not.toHaveBeenCalled()
  })

  it('drops a second approval message when GitLab already shows the approval (double click)', async () => {
    const env = setup()
    env.api.getMergeRequestApprovals.mockResolvedValue({ approved_by: [{ user: gitlabUser(5) }] })
    hulyReview(env.memory, 'approved')
    const update = await syncReview(env)
    expect(env.api.approveMergeRequest).not.toHaveBeenCalled()
    expect(docOf(env.memory, 'rv-1', gitlab.class.GitlabReview)).toBeUndefined()
    expect(update).toMatchObject({ deleted: true, needSync: GITLAB_SYNC_VERSION })
  })

  it('revokes an approval', async () => {
    const env = setup()
    env.api.getMergeRequestApprovals.mockResolvedValue({ approved_by: [{ user: gitlabUser(5) }] })
    hulyReview(env.memory, 'unapproved')
    await syncReview(env)
    expect(env.api.unapproveMergeRequest).toHaveBeenCalledWith(PROJECT_ID, 3)
  })

  it("never approves with someone else's token, and keeps the message marked not sent", async () => {
    const env = setup(null)
    hulyReview(env.memory, 'approved')
    const update = await syncReview(env)
    expect(env.api.getMergeRequestApprovals).not.toHaveBeenCalled()
    expect(env.api.approveMergeRequest).not.toHaveBeenCalled()
    expect(docOf(env.memory, 'rv-1', gitlab.class.GitlabReview)).toBeDefined()
    expect(update).toMatchObject({ retryable: false, needSync: GITLAB_SYNC_VERSION })
    expect(update.deleted).toBeUndefined()
    expect(update.error).toContain('own GitLab connection')
  })

  it('keeps the message, marked not sent, when GitLab refuses the approval', async () => {
    const env = setup()
    env.api.approveMergeRequest.mockRejectedValue(new GitlabApiError(401, 'GitLab POST failed: 401'))
    hulyReview(env.memory, 'approved')
    const update = await syncReview(env)
    expect(docOf(env.memory, 'rv-1', gitlab.class.GitlabReview)).toBeDefined()
    expect(update).toMatchObject({ retryable: false })
    expect(update.error).toContain('401')
  })

  it('keeps the message for a retry when GitLab fails', async () => {
    const env = setup()
    env.api.approveMergeRequest.mockRejectedValue(new GitlabApiError(500, 'boom'))
    hulyReview(env.memory, 'approved')
    await expect(syncReview(env)).rejects.toThrow('boom')
    expect(docOf(env.memory, 'rv-1', gitlab.class.GitlabReview)).toBeDefined()
  })

  it('only approves and revokes from Huly; other states stay marked not sent', async () => {
    const env = setup()
    hulyReview(env.memory, 'requested_changes')
    const update = await syncReview(env)
    expect(env.api.getMergeRequestApprovals).not.toHaveBeenCalled()
    expect(docOf(env.memory, 'rv-1', gitlab.class.GitlabReview)).toBeDefined()
    expect(update.error).toBe('Only approvals can be given from Huly')
  })

  it('leaves GitLab-born reviews alone', async () => {
    const env = setup()
    hulyReview(env.memory, 'approved', `${KEY_3}/reviews/8/1`)
    expect(await syncReview(env)).toEqual({ needSync: GITLAB_SYNC_VERSION })
    expect(env.api.getMergeRequestApprovals).not.toHaveBeenCalled()
  })
})
