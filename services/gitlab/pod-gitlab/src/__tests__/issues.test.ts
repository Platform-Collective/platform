// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import activity from '@hcengineering/activity'
import gitlab, { type DocSyncInfo } from '@hcengineering/gitlab'
import tracker from '@hcengineering/tracker'
import { GitlabApiError } from '../gitlab/api'
import { IssueSyncManager, type IssueSnapshot } from '../sync/issues'
import { issueKey } from '../sync/keys'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import { HOST, PROJECT_ID, gitlabIssue, gitlabUser, hulyIssue, seedRepository } from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { asApi, createTestProvider, ctx, fakeApi, type FakeApi, type TestProvider } from './helpers/provider'

const KEY_1 = issueKey(HOST, PROJECT_ID, 1)

interface Env {
  memory: MemoryClient
  provider: TestProvider
  issues: IssueSyncManager
  api: FakeApi
  repo: any
}

function setup (api: FakeApi = fakeApi(), options: { apiAvailable?: boolean, secondRepo?: boolean } = {}): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  const repos = [repo]
  if (options.secondRepo === true) repos.push(seedRepository(memory, { repositoryId: 'repo-2' }))
  const provider = createTestProvider(memory, repos, api, options)
  return { memory, provider, issues: new IssueSyncManager(provider), api, repo }
}

// A Huly issue and its DocSyncInfo share the same _id; these helpers pick one by class.
const issueOf = (memory: MemoryClient, id: string): any => memory.docs.find((d) => d._id === id && d._class === tracker.class.Issue)
const syncOf = (memory: MemoryClient, id: string): any => memory.docs.find((d) => d._id === id && d._class === gitlab.class.DocSyncInfo)
const syncInfos = (memory: MemoryClient): any[] => memory.docs.filter((d) => d._class === gitlab.class.DocSyncInfo)

/** What the worker does for one pending doc (Task 10): sync with the Huly doc and store the result. */
async function syncDoc (env: Env, id: string): Promise<any> {
  const info = syncOf(env.memory, id)
  const existing = issueOf(env.memory, id)
  const update = await env.issues.sync(ctx, existing === undefined ? undefined : { ...existing }, { ...info } as DocSyncInfo, undefined)
  await env.memory.update(info, update)
  return update
}

/** Imports GitLab issue 1 into Huly and returns its sync doc id. */
async function imported (env: Env, overrides: any = {}): Promise<string> {
  await env.issues.receive(ctx, env.repo, gitlabIssue(1, overrides))
  const info = syncInfos(env.memory)[0]
  await syncDoc(env, info._id)
  return info._id
}

function hulyDescription (env: Env, id: string): string | undefined {
  return env.provider.collab.store.get(`${id}:description`)
}

describe('IssueSyncManager: GitLab to Huly', () => {
  it('creates a Huly issue for a new GitLab issue', async () => {
    const env = setup()
    const id = await imported(env, { assignees: [gitlabUser(7)] })
    const issue = issueOf(env.memory, id)
    expect(issue).toMatchObject({ _id: id, title: 'Issue 1', status: 'st-backlog', assignee: 'person-7', identifier: 'PRJ-1', modifiedBy: 'sid-1' })
    expect(issue[gitlab.mixin.GitlabIssue]).toEqual({ url: `${HOST}/group/proj/-/issues/1`, gitlabIid: 1, repository: 'repo-1' })
    expect(hulyDescription(env, id)).toBe(env.provider.markdown.toMarkup('Body 1'))
    expect(env.memory.docs.find((d) => d._class === activity.class.ActivityInfoMessage)).toMatchObject({
      attachedTo: id,
      message: gitlab.string.IssueConnectedActivityInfo,
      props: { number: 1, repoName: 'group/proj' }
    })
    expect(syncOf(env.memory, id)).toMatchObject({ key: KEY_1, needSync: GITLAB_SYNC_VERSION, current: { title: 'Issue 1', state: 'opened', assignee: 'person-7' } })
  })

  it('imports a closed GitLab issue as done', async () => {
    const env = setup()
    await imported(env, { state: 'closed' })
    expect((env.memory.docs.find((d) => d._class === tracker.class.Issue) as any).status).toBe('st-done')
  })

  it('applies a GitLab title change to Huly as the GitLab user who made it', async () => {
    const env = setup(fakeApi({ getIssue: async () => gitlabIssue(1, { title: 'Renamed in GitLab', updated_at: '2026-01-02T00:00:00.000Z' }) }))
    const id = await imported(env)
    await env.issues.handleIssueEvent(ctx, env.repo, asApi(env.api), 1, 'sid-5' as any)
    await syncDoc(env, id)
    expect(issueOf(env.memory, id)).toMatchObject({ title: 'Renamed in GitLab', modifiedBy: 'sid-5' })
  })

  it('ignores a webhook echo with the same updated_at', async () => {
    const env = setup(fakeApi({ getIssue: async () => gitlabIssue(1) }))
    const id = await imported(env)
    env.provider.triggerSync.mockClear()
    await env.issues.handleIssueEvent(ctx, env.repo, asApi(env.api), 1)
    expect(syncOf(env.memory, id).needSync).toBe(GITLAB_SYNC_VERSION)
    expect(env.provider.triggerSync).not.toHaveBeenCalled()
  })

  it('ignores an out-of-order (older) GitLab version', async () => {
    const env = setup()
    const id = await imported(env, { updated_at: '2026-01-05T00:00:00.000Z' })
    await env.issues.receive(ctx, env.repo, gitlabIssue(1, { title: 'Old', updated_at: '2026-01-04T00:00:00.000Z' }))
    expect(syncOf(env.memory, id).external.title).toBe('Issue 1')
  })

  it('reopening in GitLab moves a done issue to in progress', async () => {
    const env = setup(fakeApi({ getIssue: async () => gitlabIssue(1, { state: 'opened', updated_at: '2026-01-02T00:00:00.000Z' }) }))
    const id = await imported(env, { state: 'closed' })
    await env.issues.handleIssueEvent(ctx, env.repo, asApi(env.api), 1)
    await syncDoc(env, id)
    expect(issueOf(env.memory, id).status).toBe('st-progress')
  })

  it('never imports a confidential issue', async () => {
    const env = setup()
    await env.issues.receive(ctx, env.repo, gitlabIssue(1, { confidential: true }))
    expect(syncInfos(env.memory)).toEqual([])
    expect(env.provider.triggerSync).not.toHaveBeenCalled()
  })

  it('ignores a webhook for an issue GitLab no longer returns', async () => {
    const env = setup(fakeApi({ getIssue: async () => { throw new GitlabApiError(404, 'gone') } }))
    await expect(env.issues.handleIssueEvent(ctx, env.repo, asApi(env.api), 1)).resolves.toBeUndefined()
    expect(syncInfos(env.memory)).toEqual([])
  })
})

describe('IssueSyncManager: Huly to GitLab', () => {
  it('pushes a Huly title change to GitLab and records the new agreed state', async () => {
    const api = fakeApi({ updateIssue: async () => gitlabIssue(1, { title: 'Renamed in Huly', updated_at: '2026-01-02T00:00:00.000Z' }) })
    const env = setup(api)
    const id = await imported(env)
    await env.memory.update(issueOf(env.memory, id), { title: 'Renamed in Huly', modifiedBy: 'sid-huly' })
    const update = await syncDoc(env, id)
    expect(api.updateIssue).toHaveBeenCalledWith(PROJECT_ID, 1, { title: 'Renamed in Huly' })
    expect((update.current as IssueSnapshot).title).toBe('Renamed in Huly')
    expect(update.external.updated_at).toBe('2026-01-02T00:00:00.000Z')
  })

  it('keeps the Huly value when both sides changed the title', async () => {
    const api = fakeApi({ updateIssue: async (_p: number, _i: number, input: any) => gitlabIssue(1, { ...input, updated_at: '2026-01-03T00:00:00.000Z' }) })
    const env = setup(api)
    const id = await imported(env)
    await env.memory.update(issueOf(env.memory, id), { title: 'Huly title' })
    await env.memory.update(syncInfos(env.memory)[0], { external: gitlabIssue(1, { title: 'GitLab title', updated_at: '2026-01-02T00:00:00.000Z' }), needSync: '' })
    await syncDoc(env, id)
    expect(api.updateIssue).toHaveBeenCalledWith(PROJECT_ID, 1, { title: 'Huly title' })
    expect(issueOf(env.memory, id).title).toBe('Huly title')
  })

  it('closes the GitLab issue when Huly cancels it, and keeps Canceled after the echo', async () => {
    const closed = gitlabIssue(1, { state: 'closed', updated_at: '2026-01-02T00:00:00.000Z' })
    const api = fakeApi({ updateIssue: async () => closed, getIssue: async () => closed })
    const env = setup(api)
    const id = await imported(env)
    await env.memory.update(issueOf(env.memory, id), { status: 'st-canceled' })
    await syncDoc(env, id)
    expect(api.updateIssue).toHaveBeenCalledWith(PROJECT_ID, 1, { state_event: 'close' })
    await env.issues.handleIssueEvent(ctx, env.repo, asApi(api), 1)
    await syncDoc(env, id)
    expect(issueOf(env.memory, id).status).toBe('st-canceled')
    expect(api.updateIssue).toHaveBeenCalledTimes(1)
  })

  it('keeps a Huly assignee without a GitLab identity and does not push or undo it', async () => {
    const api = fakeApi()
    const env = setup(api)
    const id = await imported(env)
    await env.memory.update(issueOf(env.memory, id), { assignee: 'person-local' })
    await syncDoc(env, id)
    await syncDoc(env, id)
    expect(api.updateIssue).not.toHaveBeenCalled()
    expect(issueOf(env.memory, id).assignee).toBe('person-local')
  })

  it('creates a Huly-born issue in the only linked repository and re-queues its comments', async () => {
    const created = gitlabIssue(5, { title: 'From Huly', description: 'Text' })
    const api = fakeApi({ createIssue: async () => created })
    const env = setup(api)
    hulyIssue(env.memory, 'issue-h', { title: 'From Huly', assignee: 'person-7' })
    env.provider.collab.store.set('issue-h:description', env.provider.markdown.toMarkup('Text'))
    env.memory.docs.push({ _id: 'issue-h', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: '', objectClass: tracker.class.Issue, repository: null, gitlabIid: 0, needSync: '' })
    env.memory.docs.push({ _id: 'msg-1', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: '', objectClass: 'chunter:class:ChatMessage', repository: null, gitlabIid: 0, needSync: 'v1', attachedTo: 'issue-h' })
    await syncDoc(env, 'issue-h')
    const [projectId, input] = api.createIssue.mock.calls[0]
    expect(projectId).toBe(PROJECT_ID)
    expect(input).toMatchObject({ title: 'From Huly', assignee_ids: [7] })
    expect(input.description.trim()).toBe('Text')
    expect(syncOf(env.memory, 'issue-h')).toMatchObject({ key: issueKey(HOST, PROJECT_ID, 5), repository: 'repo-1', gitlabIid: 5 })
    expect(issueOf(env.memory, 'issue-h')[gitlab.mixin.GitlabIssue]).toMatchObject({ gitlabIid: 5 })
    expect(syncOf(env.memory, 'msg-1').needSync).toBe('')
  })

  it('records the new GitLab issue before closing it, so a failed close neither duplicates nor loses it', async () => {
    const created = gitlabIssue(5, { title: 'Done in Huly' })
    const api = fakeApi({ createIssue: async () => created, updateIssue: async () => { throw new GitlabApiError(502, 'bad gateway') } })
    const env = setup(api)
    hulyIssue(env.memory, 'issue-h', { title: 'Done in Huly', status: 'st-done' })
    env.memory.docs.push({ _id: 'issue-h', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: '', objectClass: tracker.class.Issue, repository: null, gitlabIid: 0, needSync: '' })
    await expect(syncDoc(env, 'issue-h')).rejects.toBeInstanceOf(GitlabApiError)
    expect(syncOf(env.memory, 'issue-h')).toMatchObject({ key: issueKey(HOST, PROJECT_ID, 5), gitlabIid: 5, repository: 'repo-1' })
    expect(syncOf(env.memory, 'issue-h').current.state).toBe('opened')
    // The retry pushes the close as an ordinary state change instead of creating another issue
    api.updateIssue.mockResolvedValue(gitlabIssue(5, { state: 'closed', updated_at: '2026-01-02T00:00:00.000Z' }))
    await syncDoc(env, 'issue-h')
    expect(api.createIssue).toHaveBeenCalledTimes(1)
    expect(api.updateIssue).toHaveBeenLastCalledWith(PROJECT_ID, 5, { state_event: 'close' })
  })

  it('an issue webhook during creation does not import a copy', async () => {
    const created = gitlabIssue(5, { title: 'From Huly' })
    let release: (() => void) | undefined
    const api = fakeApi({
      createIssue: async () => {
        await new Promise<void>((resolve) => { release = resolve })
        return created
      },
      getIssue: async () => created
    })
    const env = setup(api)
    hulyIssue(env.memory, 'issue-h', { title: 'From Huly' })
    env.memory.docs.push({ _id: 'issue-h', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: '', objectClass: tracker.class.Issue, repository: null, gitlabIid: 0, needSync: '' })
    const syncing = syncDoc(env, 'issue-h')
    for (let i = 0; i < 50 && release === undefined; i++) await new Promise((r) => setImmediate(r))
    const event = env.issues.handleIssueEvent(ctx, env.repo, asApi(api), 5)
    release?.()
    await Promise.all([syncing, event])
    expect(syncInfos(env.memory)).toHaveLength(1)
    expect(env.memory.docs.filter((d) => d._class === tracker.class.Issue)).toHaveLength(1)
  })

  it('leaves an issue in a project with two linked repositories in Huly only', async () => {
    const api = fakeApi()
    const env = setup(api, { secondRepo: true })
    hulyIssue(env.memory, 'issue-h')
    env.memory.docs.push({ _id: 'issue-h', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: '', objectClass: tracker.class.Issue, repository: null, gitlabIid: 0, needSync: '' })
    const update = await syncDoc(env, 'issue-h')
    expect(update).toEqual({ needSync: GITLAB_SYNC_VERSION })
    expect(api.createIssue).not.toHaveBeenCalled()
  })

  it('records a retryable error when no GitLab token is available', async () => {
    const env = setup(fakeApi(), { apiAvailable: false })
    hulyIssue(env.memory, 'issue-h')
    env.memory.docs.push({ _id: 'issue-h', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: '', objectClass: tracker.class.Issue, repository: null, gitlabIid: 0, needSync: '' })
    expect(await syncDoc(env, 'issue-h')).toMatchObject({ needSync: GITLAB_SYNC_VERSION, retryable: true })
  })

  it('keeps the Huly issue when GitLab answers 404 to a push', async () => {
    const api = fakeApi({ updateIssue: async () => { throw new GitlabApiError(404, 'gone') } })
    const env = setup(api)
    const id = await imported(env)
    await env.memory.update(issueOf(env.memory, id), { title: 'Changed' })
    await expect(syncDoc(env, id)).rejects.toBeInstanceOf(GitlabApiError)
    expect(env.memory.docs.find((d) => d._class === tracker.class.Issue)).toBeDefined()
  })
})

describe('IssueSyncManager: deletion', () => {
  it('closes the GitLab issue when the Huly issue is deleted and drops its notes sync docs', async () => {
    const api = fakeApi({ updateIssue: async () => gitlabIssue(1, { state: 'closed' }) })
    const env = setup(api)
    const id = await imported(env)
    env.memory.docs.push({ _id: 'msg-1', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: `${KEY_1}/notes/9`, parent: KEY_1, objectClass: 'chunter:class:ChatMessage', repository: 'repo-1', gitlabIid: 0, needSync: 'v1' })
    expect(await env.issues.handleDelete(ctx, syncOf(env.memory, id))).toBe(true)
    expect(api.updateIssue).toHaveBeenCalledWith(PROJECT_ID, 1, { state_event: 'close' })
    expect(syncOf(env.memory, 'msg-1')).toBeUndefined()
  })

  it('does not call GitLab for a deleted issue that is already closed', async () => {
    const api = fakeApi()
    const env = setup(api)
    const id = await imported(env, { state: 'closed' })
    expect(await env.issues.handleDelete(ctx, syncOf(env.memory, id))).toBe(true)
    expect(api.updateIssue).not.toHaveBeenCalled()
  })

  it('keeps the sync docs of sub-issues when their parent issue is deleted', async () => {
    const api = fakeApi({ updateIssue: async () => gitlabIssue(1, { state: 'closed' }) })
    const env = setup(api)
    const id = await imported(env)
    env.memory.docs.push({ _id: 'sub-1', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: issueKey(HOST, PROJECT_ID, 2), objectClass: tracker.class.Issue, repository: 'repo-1', gitlabIid: 2, needSync: '', deleted: true, attachedTo: id })
    await env.issues.handleDelete(ctx, syncOf(env.memory, id))
    expect(syncOf(env.memory, 'sub-1')).toBeDefined()
  })
})
