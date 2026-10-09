// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import chunter from '@hcengineering/chunter'
import core, { type PersonId, type Tx, type WorkspaceUuid } from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import task from '@hcengineering/task'
import tracker from '@hcengineering/tracker'
import { GitlabApiError, GitlabReadonlyError } from '../gitlab/api'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import { hookSecret, hookUrl } from '../hooks'
import { EXPIRED_ERROR, FULL_SYNC_INTERVAL_MS, GitlabWorker, HEALTH_INTERVAL_MS, THREAD_REFRESH_MS, isRelevantTx, ORPHAN_HOOK_GRACE_MS, SINCE_MARGIN_MS, type SyncManagers, type WorkerDeps } from '../worker/worker'
import { CONNECTED_BY, HOST, HULY_USER, PROJECT_ID, PROJECT_TYPE, gitlabIssue, gitlabMergeRequest, gitlabProject, hulyIssue, seedRepository } from './helpers/fixtures'
import { asTxOperations, createMemoryClient, type MemoryClient } from './helpers/memory'
import { asApi, ctx, fakeApi, fakeCollaborator, fakePersons, type FakeApi } from './helpers/provider'
import { createMarkdownConverter } from '../markdown'

async function flush (): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}

interface Env {
  memory: MemoryClient
  api: FakeApi
  worker: GitlabWorker
  managers: any
  calls: string[]
  clock: { now: number }
  users: { getValidRecord: jest.Mock }
}

function setup (options: { seed?: (memory: MemoryClient) => void, token?: boolean, deps?: Partial<WorkerDeps> } = {}): Env {
  const memory = createMemoryClient()
  options.seed !== undefined ? options.seed(memory) : seedRepository(memory)
  const api = fakeApi({
    listIssues: async () => [],
    listMergeRequests: async () => [],
    deleteProjectHook: async () => {},
    getCurrentUser: async () => ({ id: 9, username: 'connector', name: 'Connector', avatar_url: null, web_url: `${HOST}/connector` }),
    listMaintainedProjects: async () => [gitlabProject()]
  })
  const calls: string[] = []
  const managers = {
    issues: {
      sync: jest.fn(async (_c: unknown, _e: unknown, info: any) => { calls.push(`issue:${info._id}`); return { needSync: GITLAB_SYNC_VERSION } }),
      handleDelete: jest.fn(async () => true),
      receive: jest.fn(async () => {}),
      handleIssueEvent: jest.fn(async () => {}),
      handleMove: jest.fn(async () => {})
    },
    notes: {
      sync: jest.fn(async (_c: unknown, _e: unknown, info: any) => { calls.push(`note:${info._id}`); return { needSync: GITLAB_SYNC_VERSION } }),
      handleDelete: jest.fn(async () => true),
      refreshNotes: jest.fn(async () => {}),
      handleNoteEvent: jest.fn(async () => {})
    },
    mergeRequests: {
      sync: jest.fn(async (_c: unknown, _e: unknown, info: any) => { calls.push(`mr:${info._id}`); return { needSync: GITLAB_SYNC_VERSION } }),
      handleDelete: jest.fn(async () => false),
      receive: jest.fn(async () => {}),
      handleMergeRequestEvent: jest.fn(async () => true),
      requeueOpen: jest.fn(async () => [] as number[]),
      handleMove: jest.fn(async () => {})
    },
    reviews: {
      sync: jest.fn(async (_c: unknown, _e: unknown, info: any) => { calls.push(`review:${info._id}`); return { needSync: GITLAB_SYNC_VERSION } }),
      handleDelete: jest.fn(async () => true)
    },
    threads: {
      sync: jest.fn(async (_c: unknown, _e: unknown, info: any) => { calls.push(`thread:${info._id}`); return { needSync: GITLAB_SYNC_VERSION } }),
      handleDelete: jest.fn(async () => false),
      refreshDiscussions: jest.fn(async () => {}),
      handleDiscussionEvent: jest.fn(async () => {})
    },
    comments: {
      sync: jest.fn(async (_c: unknown, _e: unknown, info: any) => { calls.push(`comment:${info._id}`); return { needSync: GITLAB_SYNC_VERSION } }),
      handleDelete: jest.fn(async () => true)
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
    now: () => clock.now,
    ...options.deps
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
  it('does not mark the integration expired when the token store is unreachable', async () => {
    const env = setup()
    const integration = env.memory.docs.find((d) => d._class === gitlab.class.GitlabIntegration) as any
    env.users.getValidRecord.mockRejectedValue(new Error('account service down'))
    await env.worker.init()
    await env.worker.runOnce()
    expect(integration.error ?? null).toBeNull()
    expect(integration.alive).not.toBe(false)
  })

  it('lists the discussions of open merge requests with unresolved threads every 10 minutes', async () => {
    const env = setup()
    const mrInfo = (id: string, iid: number, state: string): any => ({
      _id: id, _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: `k-${id}`, objectClass: gitlab.class.GitlabMergeRequest,
      repository: 'repo-1', gitlabIid: iid, external: gitlabMergeRequest(iid, { state: state as any }), needSync: GITLAB_SYNC_VERSION
    })
    const thread = (id: string, parent: string, resolved: boolean): any => ({
      _id: id, _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: `${parent}/discussions/${id}`, parent,
      objectClass: gitlab.class.GitlabReviewThread, repository: 'repo-1', gitlabIid: 0, external: { id, resolved }, needSync: GITLAB_SYNC_VERSION
    })
    env.memory.docs.push(
      mrInfo('mr-open', 3, 'opened'), mrInfo('mr-merged', 4, 'merged'), mrInfo('mr-done', 6, 'opened'),
      thread('t1', 'k-mr-open', false), thread('t2', 'k-mr-merged', false), thread('t3', 'k-mr-done', true)
    )
    await env.worker.init()
    await env.worker.runOnce()
    // The full sync has just listed what it needed
    expect(env.managers.threads.refreshDiscussions).not.toHaveBeenCalled()
    env.clock.now += THREAD_REFRESH_MS
    await env.worker.runOnce()
    expect(env.managers.threads.refreshDiscussions).toHaveBeenCalledTimes(1)
    expect(env.managers.threads.refreshDiscussions).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 3)
  })

  it('does not list discussions after a merge request webhook GitLab answers with 404', async () => {
    const env = setup()
    await env.worker.init()
    env.managers.mergeRequests.handleMergeRequestEvent.mockResolvedValueOnce(false)
    await env.worker.handleWebhook('Merge Request Hook', { project: { id: PROJECT_ID, web_url: `${HOST}/group/proj` }, object_attributes: { iid: 3 } })
    expect(env.managers.threads.refreshDiscussions).not.toHaveBeenCalled()
  })

  it('skips the discussions of old merged merge requests on the first full sync', async () => {
    const env = setup()
    env.api.listMergeRequests.mockResolvedValue([
      gitlabMergeRequest(4, { state: 'merged', updated_at: '2025-10-01T00:00:00.000Z' }),
      gitlabMergeRequest(5)
    ])
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.managers.notes.refreshNotes).toHaveBeenCalledTimes(2)
    expect(env.managers.threads.refreshDiscussions).toHaveBeenCalledTimes(1)
    expect(env.managers.threads.refreshDiscussions).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 5)
  })

  it('reads a project\'s task type once a minute', async () => {
    const env = setup()
    await env.worker.init()
    const findOne = jest.spyOn(env.memory, 'findOne')
    const taskTypeReads = (): number => findOne.mock.calls.filter(([_class]) => _class === task.class.TaskType).length
    const project = { type: PROJECT_TYPE } as any
    await env.worker.issueTaskType(project)
    await env.worker.issueTaskType(project)
    expect(taskTypeReads()).toBe(1)
    env.clock.now += 61 * 1000
    await env.worker.issueTaskType(project)
    expect(taskTypeReads()).toBe(2)
  })

  it('hands a merge request moved to another project to its manager', async () => {
    const env = setup()
    env.memory.docs.push({ _id: 'mr-1', _class: gitlab.class.GitlabMergeRequest, space: 'prj-other' })
    pending(env.memory, 'mr-1', { objectClass: gitlab.class.GitlabMergeRequest })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.managers.mergeRequests.handleMove).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ _id: 'mr-1', space: 'prj-other' }), expect.objectContaining({ _id: 'mr-1', space: 'prj-1' }))
    expect(env.managers.mergeRequests.sync).not.toHaveBeenCalled()
  })

  it('syncs a comment whose sync doc moved along with its issue in the same batch', async () => {
    const env = setup()
    hulyIssue(env.memory, 'issue-1', { space: 'prj-2' })
    pending(env.memory, 'issue-1')
    env.memory.docs.push({ _id: 'msg-1', _class: chunter.class.ChatMessage, space: 'prj-2', attachedTo: 'issue-1' })
    pending(env.memory, 'msg-1', { objectClass: chunter.class.ChatMessage, parent: 'k-issue-1' })
    // The issue's move re-homes its comments' sync docs (Task 10)
    env.managers.issues.handleMove.mockImplementation(async () => {
      infoOf(env.memory, 'msg-1').space = 'prj-2'
    })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.managers.issues.handleMove).toHaveBeenCalledTimes(1)
    expect(env.calls).toEqual(['note:msg-1'])
  })

  it('shows a sync error on the Huly issue and clears it after a successful sync', async () => {
    const env = setup()
    hulyIssue(env.memory, 'issue-1')
    pending(env.memory, 'issue-1')
    env.managers.issues.sync.mockRejectedValueOnce(new GitlabApiError(403, 'GitLab POST /projects/42/issues failed: 403 Forbidden'))
    await env.worker.init()
    await env.worker.runOnce()
    const issue = env.memory.docs.find((d) => d._id === 'issue-1' && d._class === tracker.class.Issue) as any
    expect(issue[gitlab.mixin.GitlabIssue]).toEqual({ syncError: expect.stringContaining('403') })
    infoOf(env.memory, 'issue-1').needSync = ''
    env.managers.issues.sync.mockResolvedValueOnce({ needSync: GITLAB_SYNC_VERSION, error: null })
    await env.worker.runOnce()
    expect(issue[gitlab.mixin.GitlabIssue].syncError).toBeNull()
  })

  it('shows the error of a refused approval on its review message', async () => {
    const env = setup()
    env.memory.docs.push({ _id: 'rv-1', _class: gitlab.class.GitlabReview, space: 'prj-1', state: 'approved' })
    pending(env.memory, 'rv-1', { objectClass: gitlab.class.GitlabReview, key: '' })
    env.managers.reviews.sync.mockResolvedValueOnce({ needSync: GITLAB_SYNC_VERSION, error: 'GitLab POST failed: 401', retryable: false })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.memory.docs.find((d) => d._id === 'rv-1' && d._class === gitlab.class.GitlabReview)).toMatchObject({ syncError: 'GitLab POST failed: 401' })
  })

  it('checks the token at start and then hourly, and leaves alive alone on a network error', async () => {
    const env = setup()
    const integration = env.memory.docs.find((d) => d._class === gitlab.class.GitlabIntegration) as any
    await env.worker.init()
    await env.worker.runOnce()
    await env.worker.runOnce()
    expect(env.api.getCurrentUser).toHaveBeenCalledTimes(1)
    env.clock.now += HEALTH_INTERVAL_MS
    env.api.getCurrentUser.mockRejectedValueOnce(new Error('ECONNRESET'))
    await env.worker.runOnce()
    expect(env.api.getCurrentUser).toHaveBeenCalledTimes(2)
    expect(integration).toMatchObject({ alive: true, error: null })
  })

  it('marks the integration expired when GitLab answers 401, and a full sync does not clear it', async () => {
    const env = setup()
    const integration = env.memory.docs.find((d) => d._class === gitlab.class.GitlabIntegration) as any
    env.api.getCurrentUser.mockRejectedValue(new GitlabApiError(401, 'GitLab GET /user failed: 401'))
    await env.worker.init()
    await env.worker.runOnce()
    expect(integration).toMatchObject({ alive: false, error: EXPIRED_ERROR })
    // The stored token still lists issues; the full sync must not flip the integration back to alive
    expect(env.api.listIssues).toHaveBeenCalled()
    env.clock.now += FULL_SYNC_INTERVAL_MS
    await env.worker.runOnce()
    expect(integration).toMatchObject({ alive: false, error: EXPIRED_ERROR })
  })

  it('keeps a transferred project linked and rewrites its issue links', async () => {
    const env = setup()
    hulyIssue(env.memory, 'issue-1', { [gitlab.mixin.GitlabIssue]: { url: `${HOST}/group/proj/-/issues/1`, gitlabIid: 1, repository: 'repo-1' } })
    env.api.listMaintainedProjects.mockResolvedValue([])
    env.api.getProject.mockResolvedValue(gitlabProject({ path_with_namespace: 'other/proj', web_url: `${HOST}/other/proj` }))
    await env.worker.init()
    await env.worker.runOnce()
    const repo = env.memory.docs.find((d) => d._class === gitlab.class.GitlabIntegrationRepository) as any
    expect(repo).toMatchObject({ deleted: false, webUrl: `${HOST}/other/proj`, pathWithNamespace: 'other/proj', gitlabProject: 'prj-1' })
    const issue = env.memory.docs.find((d) => d._id === 'issue-1' && d._class === tracker.class.Issue) as any
    expect(issue[gitlab.mixin.GitlabIssue].url).toBe(`${HOST}/other/proj/-/issues/1`)
    // Still synchronized: the next pass lists its issues
    expect(env.api.listIssues).toHaveBeenCalled()
  })

  it('installs a linked repository\'s hook at its scoped URL once per pod start', async () => {
    const env = setup({ deps: { hooks: { baseUrl: 'https://hooks.example.com', master: 'm' } } })
    env.api.ensureProjectHook.mockResolvedValue({ id: 9, url: 'scoped' })
    await env.worker.init()
    await env.worker.runOnce()
    const target = { workspace: 'ws1' as WorkspaceUuid, integration: 'int-1' as any }
    expect(env.api.ensureProjectHook).toHaveBeenCalledWith(
      PROJECT_ID,
      hookUrl('https://hooks.example.com', target),
      hookSecret('m', target)
    )
    expect(env.memory.docs.find((d) => d._class === gitlab.class.GitlabIntegrationRepository)).toMatchObject({ hookId: 9 })
    env.clock.now += HEALTH_INTERVAL_MS
    await env.worker.runOnce()
    expect(env.api.ensureProjectHook).toHaveBeenCalledTimes(1)
  })

  it('retries a hook it could not check at the next health run', async () => {
    const env = setup({ deps: { hooks: { baseUrl: 'https://hooks.example.com', master: 'm' } } })
    env.api.ensureProjectHook.mockRejectedValueOnce(new GitlabApiError(403, 'forbidden')).mockResolvedValue({ id: 7, url: 'scoped' })
    await env.worker.init()
    await env.worker.runOnce()
    env.clock.now += HEALTH_INTERVAL_MS
    await env.worker.runOnce()
    expect(env.api.ensureProjectHook).toHaveBeenCalledTimes(2)
  })

  it('handles a scoped event only for the repositories of its integration', async () => {
    const env = setup()
    await env.worker.init()
    const payload = { project: { id: PROJECT_ID, web_url: `${HOST}/group/proj` }, object_attributes: { iid: 3 } }
    await env.worker.handleWebhook('Issue Hook', payload, 'int-other' as any)
    expect(env.managers.issues.handleIssueEvent).not.toHaveBeenCalled()
    await env.worker.handleWebhook('Issue Hook', payload, 'int-1' as any)
    expect(env.managers.issues.handleIssueEvent).toHaveBeenCalledTimes(1)
  })

  it('keeps a Huly change blocked by GITLAB_READONLY for the next full sync', async () => {
    const env = setup()
    hulyIssue(env.memory, 'issue-1')
    pending(env.memory, 'issue-1')
    env.managers.issues.sync.mockRejectedValueOnce(new GitlabReadonlyError('PUT', '/projects/42/issues/1'))
    await env.worker.init()
    await env.worker.runOnce()
    expect(infoOf(env.memory, 'issue-1')).toMatchObject({ needSync: GITLAB_SYNC_VERSION, retryable: true })
    expect(infoOf(env.memory, 'issue-1').error).toContain('read-only')
    env.clock.now += FULL_SYNC_INTERVAL_MS
    await env.worker.runOnce()
    expect(env.managers.issues.sync).toHaveBeenCalledTimes(2)
  })

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

  it('records a move as an error for documents whose manager does not handle moves', async () => {
    const env = setup()
    env.memory.docs.push({ _id: 'th-1', _class: gitlab.class.GitlabReviewThread, space: 'prj-other' })
    pending(env.memory, 'th-1', { objectClass: gitlab.class.GitlabReviewThread })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.calls).toEqual([])
    expect(infoOf(env.memory, 'th-1').error).toContain('another project')
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

  it('adds the merge request task type once, then finds it', async () => {
    let memory: MemoryClient | undefined
    const ensureTaskType = jest.fn(async (_client: unknown, projectType: string, data: any) => {
      memory?.docs.push({ _id: 'tt-mr', _class: task.class.TaskType, parent: projectType, ofClass: data.ofClass, statuses: ['st-done'] })
    })
    const env = setup({ deps: { ensureTaskType } as any })
    memory = env.memory
    const project = { type: PROJECT_TYPE } as any
    const [first, second] = await Promise.all([env.worker.mergeRequestTaskType(project), env.worker.mergeRequestTaskType(project)])
    expect(ensureTaskType).toHaveBeenCalledTimes(1)
    expect(ensureTaskType.mock.calls[0][1]).toBe(PROJECT_TYPE)
    expect(ensureTaskType.mock.calls[0][2]).toMatchObject({
      ofClass: gitlab.class.GitlabMergeRequest,
      descriptor: gitlab.descriptors.MergeRequest,
      statusCategories: [task.statusCategory.Active, task.statusCategory.Won, task.statusCategory.Lost]
    })
    expect(first).toMatchObject({ taskType: 'tt-mr', statuses: [expect.objectContaining({ _id: 'st-done' })] })
    expect(second?.taskType).toBe('tt-mr')
    await env.worker.mergeRequestTaskType(project)
    expect(ensureTaskType).toHaveBeenCalledTimes(1)
  })

  it('reports no merge request task type when adding it failed, and tries again next time', async () => {
    const ensureTaskType = jest.fn(async () => { throw new Error('model write refused') })
    const env = setup({ deps: { ensureTaskType } as any })
    const project = { type: PROJECT_TYPE } as any
    await expect(env.worker.mergeRequestTaskType(project)).rejects.toThrow('model write refused')
    await expect(env.worker.mergeRequestTaskType(project)).rejects.toThrow('model write refused')
    expect(ensureTaskType).toHaveBeenCalledTimes(2)
  })

  it('imports all merge requests of a repository whose issues are already synced', async () => {
    const env = setup()
    const newest = Date.parse('2026-01-20T00:00:00.000Z')
    pending(env.memory, 'issue-1', { needSync: GITLAB_SYNC_VERSION, lastModified: newest })
    env.api.listMergeRequests.mockResolvedValue([gitlabMergeRequest(3)])
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.api.listIssues).toHaveBeenCalledWith(PROJECT_ID, new Date(newest - SINCE_MARGIN_MS).toISOString())
    expect(env.api.listMergeRequests).toHaveBeenCalledWith(PROJECT_ID, undefined)
    expect(env.managers.mergeRequests.receive).toHaveBeenCalledWith(expect.anything(), expect.anything(), gitlabMergeRequest(3))
    expect(env.managers.notes.refreshNotes).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), gitlabMergeRequest(3), 'merge_requests'
    )
  })

  it('moves the merge request window on its own', async () => {
    const env = setup()
    const stored = Date.parse('2026-01-10T00:00:00.000Z')
    pending(env.memory, 'mr-1', { objectClass: gitlab.class.GitlabMergeRequest, needSync: GITLAB_SYNC_VERSION, lastModified: stored })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.api.listMergeRequests).toHaveBeenCalledWith(PROJECT_ID, new Date(stored - SINCE_MARGIN_MS).toISOString())
    expect(env.api.listIssues).toHaveBeenCalledWith(PROJECT_ID, undefined)
    const firstRun = env.clock.now
    env.clock.now += FULL_SYNC_INTERVAL_MS
    await env.worker.runOnce()
    expect(env.api.listMergeRequests).toHaveBeenLastCalledWith(PROJECT_ID, new Date(firstRun - SINCE_MARGIN_MS).toISOString())
  })

  it('syncs merge requests through their manager, before notes', async () => {
    const env = setup()
    pending(env.memory, 'msg-1', { objectClass: chunter.class.ChatMessage })
    pending(env.memory, 'mr-1', { objectClass: gitlab.class.GitlabMergeRequest })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.calls).toEqual(['mr:mr-1', 'note:msg-1'])
  })

  it('keeps a merge request deleted in Huly as a done tombstone', async () => {
    const env = setup()
    pending(env.memory, 'mr-1', { objectClass: gitlab.class.GitlabMergeRequest, deleted: true })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.managers.mergeRequests.handleDelete).toHaveBeenCalled()
    expect(infoOf(env.memory, 'mr-1')).toMatchObject({ deleted: true, needSync: GITLAB_SYNC_VERSION })
  })

  it('re-syncs documents done under an older sync version', async () => {
    const env = setup()
    pending(env.memory, 'issue-1', { needSync: 'v0' })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.calls).toEqual(['issue:issue-1'])
    expect(infoOf(env.memory, 'issue-1')).toMatchObject({ needSync: GITLAB_SYNC_VERSION })
  })

  it('does not replay a deletion handled under an older sync version', async () => {
    const env = setup()
    pending(env.memory, 'issue-1', { deleted: true, needSync: 'v0' })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.managers.issues.handleDelete).not.toHaveBeenCalled()
    expect(infoOf(env.memory, 'issue-1')).toMatchObject({ deleted: true, needSync: GITLAB_SYNC_VERSION })
  })

  it('routes merge request and merge request note webhooks', async () => {
    const env = setup()
    await env.worker.init()
    const user = { id: 5, username: 'u5', name: 'U5', avatar_url: null }
    const project = { id: PROJECT_ID, web_url: `${HOST}/group/proj` }
    await env.worker.handleWebhook('Merge Request Hook', { project, user, object_attributes: { iid: 3 } })
    expect(env.managers.mergeRequests.handleMergeRequestEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 3, 'sid-5', false)
    await env.worker.handleWebhook('Note Hook', { project, user, object_attributes: { id: 78, noteable_type: 'MergeRequest' }, merge_request: { iid: 3 } })
    expect(env.managers.notes.handleNoteEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 3, 78, 'merge_requests')
  })

  it('the health job marks the integration alive again once its token works', async () => {
    const env = setup()
    const integration = env.memory.docs.find((d) => d._class === gitlab.class.GitlabIntegration) as any
    Object.assign(integration, { alive: false, error: EXPIRED_ERROR })
    await env.worker.init()
    await env.worker.runOnce()
    expect(integration).toMatchObject({ alive: true, error: null })
  })

  it('deletes the hook of a repository unlinked while the pod was down, after a grace period', async () => {
    const env = setup({
      seed: (memory) => {
        const { repository } = seedRepository(memory)
        Object.assign(repository, { enabled: false, gitlabProject: null })
      }
    })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.api.deleteProjectHook).not.toHaveBeenCalled()
    env.clock.now += ORPHAN_HOOK_GRACE_MS
    await env.worker.runOnce()
    expect(env.api.deleteProjectHook).toHaveBeenCalledWith(PROJECT_ID, 7)
  })

  it('keeps the hook when the link completes within the grace period', async () => {
    let repo: any
    const env = setup({
      seed: (memory) => {
        repo = seedRepository(memory).repository
        Object.assign(repo, { enabled: false, gitlabProject: null })
      }
    })
    await env.worker.init()
    await env.worker.runOnce()
    Object.assign(repo, { enabled: true, gitlabProject: 'prj-1' })
    await env.worker.runOnce()
    env.clock.now += ORPHAN_HOOK_GRACE_MS
    await env.worker.runOnce()
    expect(env.api.deleteProjectHook).not.toHaveBeenCalled()
  })

  it('closes the connection only after in-flight webhooks finish', async () => {
    const closeConnection = jest.fn(async () => {})
    const env = setup({ deps: { closeConnection } })
    await env.worker.init()
    let finish: () => void = () => {}
    env.managers.issues.handleIssueEvent.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finish = resolve })
    })
    const webhook = env.worker.handleWebhook('Issue Hook', { project: { id: PROJECT_ID, web_url: `${HOST}/group/proj` }, object_attributes: { iid: 3 } })
    await flush()
    const closing = env.worker.close()
    await flush()
    expect(closeConnection).not.toHaveBeenCalled()
    finish()
    await Promise.all([webhook, closing])
    expect(closeConnection).toHaveBeenCalledTimes(1)
  })

  it('closes the connection only after leased sessions end, and leases nothing while closing', async () => {
    const closeConnection = jest.fn(async () => {})
    const session = jest.fn(() => ({}) as any)
    const env = setup({ deps: { closeConnection, session } })
    const lease = env.worker.lease('sid-huly' as PersonId)
    expect(lease).toBeDefined()
    const closing = env.worker.close()
    await flush()
    expect(closeConnection).not.toHaveBeenCalled()
    expect(env.worker.lease('sid-huly' as PersonId)).toBeUndefined()
    lease?.release()
    await closing
    expect(closeConnection).toHaveBeenCalledTimes(1)
  })

  it('drops webhooks that arrive while closing', async () => {
    const env = setup()
    await env.worker.init()
    await env.worker.close()
    await env.worker.handleWebhook('Issue Hook', { project: { id: PROJECT_ID, web_url: `${HOST}/group/proj` }, object_attributes: { iid: 3 } })
    expect(env.managers.issues.handleIssueEvent).not.toHaveBeenCalled()
  })

  it('asks for the same merge request version again on approval events', async () => {
    const env = setup()
    await env.worker.init()
    const project = { id: PROJECT_ID, web_url: `${HOST}/group/proj` }
    const handle = env.managers.mergeRequests.handleMergeRequestEvent
    await env.worker.handleWebhook('Merge Request Hook', { project, object_attributes: { iid: 3, action: 'approved' } })
    expect(handle).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), 3, undefined, true)
    await env.worker.handleWebhook('Merge Request Hook', { project, object_attributes: { iid: 3, action: 'unapproval' } })
    expect(handle).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), 3, undefined, true)
    await env.worker.handleWebhook('Merge Request Hook', { project, object_attributes: { iid: 3, action: 'update' } })
    expect(handle).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), 3, undefined, false)
  })

  it('re-queues open merge requests on every full sync', async () => {
    const env = setup()
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.managers.mergeRequests.requeueOpen).toHaveBeenCalledWith(
      expect.objectContaining({ repository: expect.objectContaining({ _id: 'repo-1' }) })
    )
  })

  it('gives a user API only for the actor\'s own connection on the integration host', async () => {
    const env = setup()
    env.users.getValidRecord.mockImplementation(async (_ws: WorkspaceUuid, person: PersonId) =>
      person === HULY_USER ? { token: 'own', host: HOST, userId: 5, login: 'huly-user' } : undefined
    )
    await env.worker.init()
    const integration = env.memory.docs.find((d) => d._class === gitlab.class.GitlabIntegration) as any
    expect((await env.worker.userApi(integration, HULY_USER))?.user).toEqual({ id: 5, username: 'huly-user', name: 'huly-user', avatar_url: null })
    expect(await env.worker.userApi(integration, CONNECTED_BY)).toBeUndefined()
  })

  it('syncs merge requests, then threads, then comments and reviews', async () => {
    const env = setup()
    pending(env.memory, 'cm-1', { objectClass: gitlab.class.GitlabReviewComment })
    pending(env.memory, 'rv-1', { objectClass: gitlab.class.GitlabReview })
    pending(env.memory, 'th-1', { objectClass: gitlab.class.GitlabReviewThread })
    pending(env.memory, 'mr-1', { objectClass: gitlab.class.GitlabMergeRequest })
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.calls).toEqual(['mr:mr-1', 'thread:th-1', 'comment:cm-1', 'review:rv-1'])
  })

  it('routes diff note webhooks to the thread manager, other merge request notes to the note manager', async () => {
    const env = setup()
    await env.worker.init()
    const project = { id: PROJECT_ID, web_url: `${HOST}/group/proj` }
    await env.worker.handleWebhook('Note Hook', {
      project, object_attributes: { id: 51, noteable_type: 'MergeRequest', type: 'DiffNote', discussion_id: 'd1' }, merge_request: { iid: 3 }
    })
    expect(env.managers.threads.handleDiscussionEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 3, 'd1')
    expect(env.managers.notes.handleNoteEvent).not.toHaveBeenCalled()
    await env.worker.handleWebhook('Note Hook', {
      project, object_attributes: { id: 52, noteable_type: 'MergeRequest', type: 'DiscussionNote', discussion_id: 'd2' }, merge_request: { iid: 3 }
    })
    expect(env.managers.notes.handleNoteEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 3, 52, 'merge_requests')
  })

  it('refreshes the discussions of a merge request after its webhook', async () => {
    const env = setup()
    await env.worker.init()
    await env.worker.handleWebhook('Merge Request Hook', { project: { id: PROJECT_ID, web_url: `${HOST}/group/proj` }, object_attributes: { iid: 3 } })
    expect(env.managers.threads.refreshDiscussions).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 3)
  })

  it('refreshes the discussions of listed and of re-queued open merge requests on a full sync', async () => {
    const env = setup()
    env.api.listMergeRequests.mockResolvedValue([gitlabMergeRequest(3)])
    env.managers.mergeRequests.requeueOpen.mockResolvedValue([3, 4])
    await env.worker.init()
    await env.worker.runOnce()
    expect(env.managers.threads.refreshDiscussions.mock.calls.map((it: any[]) => it[3])).toEqual([3, 4])
  })
})
