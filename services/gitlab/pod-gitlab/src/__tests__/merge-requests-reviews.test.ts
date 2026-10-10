// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import gitlab from '@hcengineering/gitlab'
import time from '@hcengineering/time'
import { GitlabApiError } from '../gitlab/api'
import { mergeRequestKey } from '../sync/keys'
import { MergeRequestSyncManager } from '../sync/merge-requests'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import { HOST, PROJECT_ID, employee, gitlabMergeRequest, gitlabUser, seedRepository } from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { docOf, runSync, syncDocOf } from './helpers/sync'
import { asApi, createTestProvider, ctx, fakeApi, type FakeApi } from './helpers/provider'

const KEY_3 = mergeRequestKey(HOST, PROJECT_ID, 3)

interface Env {
  memory: MemoryClient
  mergeRequests: MergeRequestSyncManager
  api: FakeApi
  repo: any
}

/** Persons 1 (author), 7 and 8 are employees. */
function setup (): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  for (const person of ['person-1', 'person-7', 'person-8']) employee(memory, person)
  const api = fakeApi({
    listMergeRequestReviewers: async () => [],
    getMergeRequestApprovals: async () => ({ approved_by: [] })
  })
  const provider = createTestProvider(memory, [repo], api)
  return { memory, mergeRequests: new MergeRequestSyncManager(provider), api, repo }
}

const reviews = (memory: MemoryClient): any[] => memory.docs.filter((d) => d._class === gitlab.class.GitlabReview)
const todos = (memory: MemoryClient): any[] => memory.docs.filter((d) => d._class === time.class.ProjectToDo)
const reviewer = (id: number, state: string): any => ({ user: gitlabUser(id), state })

let updatedAt = Date.parse('2026-01-02T00:00:00.000Z')

const syncDoc = async (env: Env, id: string): Promise<any> =>
  await runSync(env.mergeRequests, env.memory, id, gitlab.class.GitlabMergeRequest)

async function imported (env: Env, overrides: any = {}): Promise<string> {
  await env.mergeRequests.receive(ctx, env.repo, gitlabMergeRequest(3, overrides))
  const id = env.memory.docs.find((d) => d._class === gitlab.class.DocSyncInfo)?._id
  await syncDoc(env, id)
  return id
}

/** A newer GitLab version of !3 (each call one minute later). */
async function gitlabChange (env: Env, id: string, overrides: any = {}): Promise<void> {
  updatedAt += 60 * 1000
  env.api.getMergeRequest.mockResolvedValueOnce(
    gitlabMergeRequest(3, { updated_at: new Date(updatedAt).toISOString(), ...overrides })
  )
  await env.mergeRequests.handleMergeRequestEvent(ctx, env.repo, asApi(env.api), 3)
  await syncDoc(env, id)
}

describe('MergeRequestSyncManager: reviews', () => {
  it('writes a review message once when the merge request sync fails after it', async () => {
    const env = setup()
    const id = await imported(env, { reviewers: [gitlabUser(7)] })
    const add = env.memory.addCollection
    // The author's fix ToDo cannot be stored: the sync fails after the review message
    env.memory.addCollection = jest.fn(async (...args: any[]) => {
      if (args[0] === time.class.ProjectToDo) throw new Error('ToDo store down')
      return (add as any)(...args)
    }) as any
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(7, 'requested_changes')])
    await expect(gitlabChange(env, id, { reviewers: [gitlabUser(7)] })).rejects.toThrow('ToDo store down')
    env.memory.addCollection = add
    await syncDoc(env, id)
    expect(reviews(env.memory).filter((it) => it.state === 'requested_changes')).toHaveLength(1)
  })

  it('re-creates a review message whose sync doc was written but the message was not', async () => {
    const env = setup()
    env.api.getMergeRequestApprovals.mockResolvedValue({
      approved_by: [{ user: gitlabUser(8), approved_at: '2026-01-01T12:00:00.000Z' }]
    })
    const id = await imported(env)
    const [message] = reviews(env.memory)
    env.memory.docs.splice(env.memory.docs.indexOf(message), 1)
    // The record of the failed sync was never stored
    delete syncDocOf(env.memory, id).reviews
    syncDocOf(env.memory, id).needSync = ''
    await syncDoc(env, id)
    expect(reviews(env.memory)).toEqual([
      expect.objectContaining({ _id: message._id, state: 'approved', modifiedBy: 'sid-8' })
    ])
  })

  it('imports current approvals as review messages written as the approver, and mirrors the approvers', async () => {
    const env = setup()
    env.api.getMergeRequestApprovals.mockResolvedValue({
      approved_by: [{ user: gitlabUser(8), approved_at: '2026-01-01T12:00:00.000Z' }]
    })
    const id = await imported(env)
    expect(reviews(env.memory)).toEqual([
      expect.objectContaining({
        attachedTo: id,
        attachedToClass: gitlab.class.GitlabMergeRequest,
        collection: 'activity',
        state: 'approved',
        modifiedBy: 'sid-8',
        modifiedOn: Date.parse('2026-01-01T12:00:00.000Z')
      })
    ])
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest).approvedBy).toEqual(['person-8'])
    expect(syncDocOf(env.memory, id).reviews).toEqual({ 8: { user: gitlabUser(8), state: 'approved' } })
  })

  it('gives each review message a done sync doc under the merge request, created before the message', async () => {
    const env = setup()
    env.api.getMergeRequestApprovals.mockResolvedValue({
      approved_by: [{ user: gitlabUser(8), approved_at: '2026-01-01T12:00:00.000Z' }]
    })
    const id = await imported(env)
    const review = reviews(env.memory)[0]
    const info = syncDocOf(env.memory, review._id)
    expect(info).toMatchObject({
      key: `${KEY_3}/reviews/8/${Date.parse('2026-01-01T12:00:00.000Z')}`,
      parent: KEY_3,
      objectClass: gitlab.class.GitlabReview,
      needSync: GITLAB_SYNC_VERSION,
      attachedTo: id
    })
    expect(env.memory.docs.indexOf(info)).toBeLessThan(env.memory.docs.indexOf(review))
  })

  it('adds one message per change: approval, revoke, requested changes', async () => {
    const env = setup()
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'approved')])
    env.api.getMergeRequestApprovals.mockResolvedValue({ approved_by: [{ user: gitlabUser(8) }] })
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)], title: 'Renamed' })
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unapproved')])
    env.api.getMergeRequestApprovals.mockResolvedValue({ approved_by: [] })
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'requested_changes')])
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    expect(reviews(env.memory).map((it) => it.state)).toEqual(['approved', 'unapproved', 'requested_changes'])
    expect(docOf(env.memory, id, gitlab.class.GitlabMergeRequest).approvedBy).toEqual([])
  })

  it('keeps two changes of one reviewer seen within the same millisecond apart', async () => {
    const env = setup()
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-03T00:00:00.000Z'))
    try {
      env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'reviewed')])
      await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
      env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'requested_changes')])
      await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    } finally {
      now.mockRestore()
    }
    expect(reviews(env.memory).map((it) => it.state)).toEqual(['reviewed', 'requested_changes'])
  })

  it('completes the review ToDo of an approver even while GitLab still reports them unreviewed', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)).toHaveLength(1)
    env.api.getMergeRequestApprovals.mockResolvedValue({ approved_by: [{ user: gitlabUser(8) }] })
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)[0].doneOn).toEqual(expect.any(Number))
  })

  it('reads review states of a closed merge request on its first import only', async () => {
    const env = setup()
    const id = await imported(env, { state: 'merged' })
    expect(env.api.getMergeRequestApprovals).toHaveBeenCalledTimes(1)
    await gitlabChange(env, id, { state: 'merged', title: 'Renamed' })
    expect(env.api.getMergeRequestApprovals).toHaveBeenCalledTimes(1)
  })

  it('leaves messages, approvers and ToDos alone when approvals are unavailable', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    env.api.getMergeRequestApprovals.mockRejectedValue(new GitlabApiError(500, 'boom'))
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    expect(reviews(env.memory)).toEqual([])
    expect(todos(env.memory)).toEqual([])
    expect(syncDocOf(env.memory, id).reviews).toBeUndefined()
  })
})
