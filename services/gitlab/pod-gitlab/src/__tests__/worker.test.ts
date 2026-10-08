// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import chunter from '@hcengineering/chunter'
import core, { type PersonId, type Tx, type WorkspaceUuid } from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import tracker from '@hcengineering/tracker'
import { GitlabApiError } from '../gitlab/api'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import { FULL_SYNC_INTERVAL_MS, GitlabWorker, isRelevantTx, SINCE_MARGIN_MS, type SyncManagers } from '../worker/worker'
import { CONNECTED_BY, HOST, PROJECT_ID, gitlabIssue, hulyIssue, seedRepository } from './helpers/fixtures'
import { asTxOperations, createMemoryClient, type MemoryClient } from './helpers/memory'
import { asApi, ctx, fakeApi, fakeCollaborator, fakePersons, type FakeApi } from './helpers/provider'
import { createMarkdownConverter } from '../markdown'

interface Env {
  memory: MemoryClient
  api: FakeApi
  worker: GitlabWorker
  managers: any
  calls: string[]
  clock: { now: number }
  users: { getValidRecord: jest.Mock }
}

function setup (options: { seed?: (memory: MemoryClient) => void, token?: boolean } = {}): Env {
  const memory = createMemoryClient()
  options.seed !== undefined ? options.seed(memory) : seedRepository(memory)
  const api = fakeApi({ listIssues: async () => [], deleteProjectHook: async () => {} })
  const calls: string[] = []
  const managers = {
    issues: {
      sync: jest.fn(async (_c: unknown, _e: unknown, info: any) => { calls.push(`issue:${info._id}`); return { needSync: GITLAB_SYNC_VERSION } }),
      handleDelete: jest.fn(async () => true),
      receive: jest.fn(async () => {}),
      handleIssueEvent: jest.fn(async () => {})
    },
    notes: {
      sync: jest.fn(async (_c: unknown, _e: unknown, info: any) => { calls.push(`note:${info._id}`); return { needSync: GITLAB_SYNC_VERSION } }),
      handleDelete: jest.fn(async () => true),
      refreshNotes: jest.fn(async () => {}),
      handleNoteEvent: jest.fn(async () => {})
    }
  }
  const clock = { now: Date.parse('2026-02-01T00:00:00.000Z') }
  const users = {
    getValidRecord: jest.fn(async (_ws: WorkspaceUuid, person: PersonId) =>
      options.token !== false && person === CONNECTED_BY ? { token: 'tok', host: HOST } : undefined
    )
  }
  const client = asTxOperations(memory)
  const worker = new GitlabWorker({
    ctx,
    workspace: 'ws1' as WorkspaceUuid,
    client,
    derived: client,
    users: users as any,
    accounts: { ensurePerson: jest.fn() } as any,
    persons: fakePersons,
    collaborator: fakeCollaborator() as any,
    markdown: createMarkdownConverter({ refUrl: 'ref://', imageUrl: 'http://front/files?file=' }),
    createApi: () => asApi(api),
    createManagers: () => managers as unknown as SyncManagers,
    now: () => clock.now
  })
  return { memory, api, worker, managers, calls, clock, users }
}

function pending (memory: MemoryClient, id: string, extra: any = {}): void {
  memory.docs.push({ _id: id, _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: `k-${id}`, objectClass: tracker.class.Issue, repository: 'repo-1', gitlabIid: 1, needSync: '', ...extra })
}

const infoOf = (memory: MemoryClient, id: string): any => memory.docs.find((d) => d._id === id && d._class === gitlab.class.DocSyncInfo)

describe('isRelevantTx', () => {
  it('reacts to sync doc, repository and integration changes, also inside apply', () => {
    const tx = (objectClass: string): Tx => ({ _class: core.class.TxUpdateDoc, objectClass } as unknown as Tx)
    expect(isRelevantTx(tx(gitlab.class.DocSyncInfo))).toBe(true)
    expect(isRelevantTx(tx(gitlab.class.GitlabIntegrationRepository))).toBe(true)
    expect(isRelevantTx(tx(tracker.class.Issue))).toBe(false)
    expect(isRelevantTx({ _class: core.class.TxApplyIf, txes: [tx(gitlab.class.DocSyncInfo)] } as unknown as Tx)).toBe(true)
  })
})

describe('GitlabWorker', () => {
  it('syncs issues before notes in a batch', async () => {
    const env = setup()
    pending(env.memory, 'msg-1', { objectClass: chunter.class.ChatMessage })
    pending(env.memory, 'issue-1')
    await env.worker.init()
    expect(await env.worker.runOnce()).toBe(true)
    expect(env.calls).toEqual(['issue:issue-1', 'note:msg-1'])
    expect(infoOf(env.memory, 'issue-1').needSync).toBe(GITLAB_SYNC_VERSION)
  })

  it('records a permanent error and keeps the Huly issue when GitLab answers 404', async () => {
    const env = setup()
    hulyIssue(env.memory, 'issue-1')
    pending(env.memory, 'issue-1')
    env.managers.issues.sync.mockRejectedValueOnce(new GitlabApiError(404, 'GitLab PUT failed: 404'))
    await env.worker.init()
    await env.worker.runOnce()
    expect(infoOf(env.memory, 'issue-1')).toMatchObject({ needSync: GITLAB_SYNC_VERSION, retryable: false })
    expect(infoOf(env.memory, 'issue-1').error).toContain('404')
    expect(env.memory.docs.find((d) => d._class === tracker.class.Issue)).toBeDefined()
    expect(await env.worker.runOnce()).toBe(false)
  })

  it('re-queues retryable errors on the next full sync', async () => {
    const env = setup()
    pending(env.memory, 'issue-1', { needSync: GITLAB_SYNC_VERSION, error: 'GitLab authorization expired', retryable: true })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.calls).toEqual(['issue:issue-1'])
    expect(infoOf(env.memory, 'issue-1')).toMatchObject({ error: null, retryable: false })
  })

  it('does not sync an issue moved to another project', async () => {
    const env = setup()
    hulyIssue(env.memory, 'issue-1', { space: 'prj-other' })
    pending(env.memory, 'issue-1')
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.calls).toEqual([])
    expect(infoOf(env.memory, 'issue-1').error).toContain('another project')
  })

  it('starts the first full sync from the newest synced GitLab timestamp, then waits for the interval', async () => {
    const env = setup()
    const newest = Date.parse('2026-01-20T00:00:00.000Z')
    pending(env.memory, 'issue-1', { needSync: GITLAB_SYNC_VERSION, lastModified: newest })
    pending(env.memory, 'issue-2', { needSync: GITLAB_SYNC_VERSION, lastModified: newest - 1000 })
    env.api.listIssues.mockResolvedValue([gitlabIssue(3)])
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.api.listIssues).toHaveBeenCalledWith(PROJECT_ID, new Date(newest - SINCE_MARGIN_MS).toISOString())
    expect(env.managers.issues.receive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ repository: expect.objectContaining({ _id: 'repo-1' }) }), gitlabIssue(3))
    expect(env.managers.notes.refreshNotes).toHaveBeenCalledTimes(1)
    const firstRun = env.clock.now
    await env.worker.runOnce()
    expect(env.api.listIssues).toHaveBeenCalledTimes(1)
    env.clock.now += FULL_SYNC_INTERVAL_MS
    await env.worker.runOnce()
    expect(env.api.listIssues).toHaveBeenLastCalledWith(PROJECT_ID, new Date(firstRun - SINCE_MARGIN_MS).toISOString())
  })

  it('imports everything when a repository has no synced issue yet', async () => {
    const env = setup()
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.api.listIssues).toHaveBeenCalledWith(PROJECT_ID, undefined)
  })

  it('marks the integration not alive and skips the full sync when its token is gone', async () => {
    const env = setup({ token: false })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.memory.docs.find((d) => d._class === gitlab.class.GitlabIntegration)).toMatchObject({ alive: false })
    expect(env.api.listIssues).not.toHaveBeenCalled()
  })

  it('deletes the hook of a repository unlinked while the worker watched it', async () => {
    const env = setup()
    await env.worker.init()
    const repo = env.memory.docs.find((d) => d._class === gitlab.class.GitlabIntegrationRepository) as any
    Object.assign(repo, { enabled: false, gitlabProject: null })
    await env.worker.runOnce()
    expect(env.api.deleteProjectHook).toHaveBeenCalledWith(PROJECT_ID, 7)
    expect(repo.hookId).toBeNull()
  })

  it('leaves the hook of a repository that was never enabled (linking in progress)', async () => {
    const env = setup({ seed: (memory) => { seedRepository(memory, { enabled: false }) } })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.api.deleteProjectHook).not.toHaveBeenCalled()
  })

  it('owns only projects of its repositories on the same host', async () => {
    const env = setup()
    await env.worker.init()
    expect(env.worker.ownsProject(`${HOST}/group/proj`, PROJECT_ID)).toBe(true)
    expect(env.worker.ownsProject(`${HOST}/group/proj`, 99)).toBe(false)
    expect(env.worker.ownsProject('https://other.example.com/group/proj', PROJECT_ID)).toBe(false)
  })

  it('routes issue and note webhooks to the managers with the sender as actor', async () => {
    const env = setup()
    await env.worker.init()
    const user = { id: 5, username: 'u5', name: 'U5', avatar_url: null }
    await env.worker.handleWebhook('Issue Hook', { project: { id: PROJECT_ID, web_url: `${HOST}/group/proj` }, user, object_attributes: { iid: 3 } })
    expect(env.managers.issues.handleIssueEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 3, 'sid-5')
    await env.worker.handleWebhook('Note Hook', { project: { id: PROJECT_ID, web_url: `${HOST}/group/proj` }, user, object_attributes: { id: 77, noteable_type: 'Issue' }, issue: { iid: 3 } })
    expect(env.managers.notes.handleNoteEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 3, 77)
    await env.worker.handleWebhook('Note Hook', { project: { id: PROJECT_ID, web_url: `${HOST}/group/proj` }, user, object_attributes: { id: 78, noteable_type: 'MergeRequest' } })
    expect(env.managers.notes.handleNoteEvent).toHaveBeenCalledTimes(1)
  })

  it('keeps a doc queued when a newer GitLab version arrived while it was syncing', async () => {
    const env = setup()
    pending(env.memory, 'issue-1', { lastModified: 100, external: { v: 'old' } })
    env.managers.issues.sync.mockImplementationOnce(async () => {
      // A webhook stores a newer GitLab object during the sync
      Object.assign(infoOf(env.memory, 'issue-1'), { external: { v: 'new' }, lastModified: 200, needSync: '' })
      return { needSync: GITLAB_SYNC_VERSION, external: { v: 'old' }, lastModified: 100, current: { v: 'merged' } }
    })
    await env.worker.init()
    await env.worker.runOnce()
    expect(infoOf(env.memory, 'issue-1')).toMatchObject({ needSync: '', external: { v: 'new' }, lastModified: 200, current: { v: 'merged' } })
  })
})
