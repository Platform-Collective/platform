// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import core from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import time from '@hcengineering/time'
import { GitlabApiError } from '../gitlab/api'
import { MergeRequestSyncManager } from '../sync/merge-requests'
import { employee, gitlabMergeRequest, gitlabUser, seedRepository } from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { runSync, syncDocOf } from './helpers/sync'
import { asApi, createTestProvider, ctx, fakeApi, type FakeApi } from './helpers/provider'

interface Env {
  memory: MemoryClient
  mergeRequests: MergeRequestSyncManager
  api: FakeApi
  repo: any
}

/** Persons 1 (author), 7 and 8 are employees; 9 is not. */
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

describe('MergeRequestSyncManager: ToDos', () => {
  it('gives each pending reviewer one review ToDo', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)).toEqual([
      expect.objectContaining({
        attachedTo: id,
        attachedToClass: gitlab.class.GitlabMergeRequest,
        collection: 'todos',
        user: 'person-8',
        title: 'Review MR 3',
        doneOn: null,
        [gitlab.mixin.GitlabTodo]: { purpose: 'review' }
      })
    ])
    expect(syncDocOf(env.memory, id).todos).toEqual(['review:person-8'])
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)], title: 'Renamed' })
    expect(todos(env.memory)).toHaveLength(1)
  })

  it('completes the review ToDo when the reviewer approves', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'approved')])
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)[0].doneOn).toEqual(expect.any(Number))
    expect(syncDocOf(env.memory, id).todos).toEqual([])
  })

  it('does not bring back a deleted review ToDo, but asks again after a new review request', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    env.memory.docs.splice(env.memory.docs.indexOf(todos(env.memory)[0]), 1)
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)).toEqual([])
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'reviewed')])
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)).toHaveLength(1)
  })

  it('asks the author and the assignee to resolve requested changes', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'requested_changes')])
    await imported(env, { reviewers: [gitlabUser(8)], assignees: [gitlabUser(7)] })
    expect(
      todos(env.memory)
        .map((it) => [it.user, it.title, it[gitlab.mixin.GitlabTodo].purpose])
        .sort((a, b) => a.join('|').localeCompare(b.join('|')))
    ).toEqual([
      ['person-1', 'Resolve MR 3', 'fix'],
      ['person-7', 'Resolve MR 3', 'fix']
    ])
  })

  it('asks for a fix while blocking discussions are unresolved', async () => {
    const env = setup()
    await imported(env, { blocking_discussions_resolved: false })
    expect(todos(env.memory).map((it) => it.user)).toEqual(['person-1'])
  })

  it('completes every open ToDo when the merge request is merged', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)], state: 'merged' })
    expect(todos(env.memory)[0].doneOn).toEqual(expect.any(Number))
  })

  it('creates no ToDo for a person who is not an employee', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(9, 'unreviewed')])
    await imported(env, { reviewers: [gitlabUser(9)] })
    expect(todos(env.memory)).toEqual([])
  })

  // Huly's issue automation completes every ToDo of a merge request on an assignee change, as a server trigger: the
  // server does not store derived transactions, so the ToDo is done without a stored update
  const completedByAutomation = (todo: any, at: number): void => {
    todo.doneOn = at
  }

  // A person's completion, and this service's, are stored transactions
  const completedBy = (env: Env, todo: any, account: string, at: number): void => {
    todo.doneOn = at
    env.memory.docs.push({
      _id: `tx-${at}`,
      _class: core.class.TxUpdateDoc,
      space: core.space.Tx,
      objectId: todo._id,
      objectClass: time.class.ProjectToDo,
      modifiedOn: at,
      modifiedBy: account,
      operations: { doneOn: at }
    })
  }

  it('reopens a review ToDo that an automation completed', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    completedByAutomation(todos(env.memory)[0], 1000)
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)).toHaveLength(1)
    expect(todos(env.memory)[0].doneOn).toBeNull()
  })

  it('reopens a review ToDo that an automation completed after its reviewer completed it once', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    completedBy(env, todos(env.memory)[0], 'person-8-account', 1000)
    todos(env.memory)[0].doneOn = null
    completedByAutomation(todos(env.memory)[0], 2000)
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)[0].doneOn).toBeNull()
  })

  it('keeps a review ToDo done that its reviewer completed', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    completedBy(env, todos(env.memory)[0], 'person-8-account', 1000)
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)).toHaveLength(1)
    expect(todos(env.memory)[0].doneOn).toBe(1000)
  })

  it('keeps a ToDo done that this service completed', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    completedBy(env, todos(env.memory)[0], core.account.System, 1000)
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)[0].doneOn).toBe(1000)
  })

  it('does not reopen ToDos of a merged merge request', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockResolvedValue([reviewer(8, 'unreviewed')])
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    completedByAutomation(todos(env.memory)[0], 1000)
    await gitlabChange(env, id, { reviewers: [gitlabUser(8)], state: 'merged' })
    expect(todos(env.memory)[0].doneOn).toBe(1000)
  })

  it('leaves ToDos alone when GitLab does not report review states', async () => {
    const env = setup()
    env.api.listMergeRequestReviewers.mockRejectedValue(new GitlabApiError(404, 'not found'))
    const id = await imported(env, { reviewers: [gitlabUser(8)] })
    expect(todos(env.memory)).toEqual([])
    expect(syncDocOf(env.memory, id).todos).toBeUndefined()
  })
})
