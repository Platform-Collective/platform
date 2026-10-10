// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import chunter from '@hcengineering/chunter'
import gitlab from '@hcengineering/gitlab'
import tracker from '@hcengineering/tracker'
import { GitlabApiError } from '../gitlab/api'
import { IssueSyncManager } from '../sync/issues'
import { issueKey, noteKey } from '../sync/keys'
import { pairMovedNotes } from '../sync/issue-move'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import { HOST, PROJECT_ID, gitlabIssue, gitlabNote, gitlabUser, hulyIssue, seedRepository } from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { docOf, flushPending, syncDocOf, waitUntil } from './helpers/sync'
import { createTestProvider, ctx, fakeApi, type FakeApi } from './helpers/provider'

const KEY_1 = issueKey(HOST, PROJECT_ID, 1)
const TARGET_PROJECT_ID = 43
const NEW_KEY = issueKey(HOST, TARGET_PROJECT_ID, 8)

interface Env {
  memory: MemoryClient
  issues: IssueSyncManager
  api: FakeApi
  source: any
}

/** prj-1 is linked to repo-1 (GitLab project 42), prj-2 to repo-2 (GitLab project 43) on the same host. */
function setup (api: FakeApi): Env {
  const memory = createMemoryClient()
  const source = seedRepository(memory)
  const target = seedRepository(memory, { repositoryId: 'repo-2', projectRef: 'prj-2' })
  target.repository.projectId = TARGET_PROJECT_ID
  const provider = createTestProvider(memory, [source, target], api)
  return { memory, issues: new IssueSyncManager(provider), api, source }
}

/** Synced issue 1 of project 42, moved in Huly to `space`, with one synced comment and one not sent yet. */
function movedIssue (memory: MemoryClient, space: string): void {
  hulyIssue(memory, 'issue-1', {
    space,
    [gitlab.mixin.GitlabIssue]: { url: `${HOST}/group/proj/-/issues/1`, gitlabIid: 1, repository: 'repo-1' }
  })
  memory.docs.push(
    {
      _id: 'issue-1',
      _class: gitlab.class.DocSyncInfo,
      space: 'prj-1',
      key: KEY_1,
      objectClass: tracker.class.Issue,
      repository: 'repo-1',
      gitlabIid: 1,
      external: gitlabIssue(1),
      needSync: ''
    },
    {
      _id: 'msg-1',
      _class: gitlab.class.DocSyncInfo,
      space: 'prj-1',
      key: noteKey(KEY_1, 11),
      parent: KEY_1,
      objectClass: chunter.class.ChatMessage,
      repository: 'repo-1',
      gitlabIid: 0,
      external: gitlabNote(11),
      needSync: GITLAB_SYNC_VERSION,
      attachedTo: 'issue-1'
    },
    {
      _id: 'msg-2',
      _class: gitlab.class.DocSyncInfo,
      space: 'prj-1',
      key: '',
      objectClass: chunter.class.ChatMessage,
      repository: null,
      gitlabIid: 0,
      needSync: '',
      attachedTo: 'issue-1'
    }
  )
}

async function move (env: Env): Promise<void> {
  await env.issues.handleMove(
    ctx,
    { ...docOf(env.memory, 'issue-1', tracker.class.Issue) },
    { ...syncDocOf(env.memory, 'issue-1') }
  )
}

describe('pairMovedNotes', () => {
  it('pairs by author and creation time first, then in order per author', () => {
    const known = [
      { id: 'a', note: gitlabNote(11, { created_at: '2026-01-01T11:00:00.000Z' }) },
      { id: 'b', note: gitlabNote(12, { created_at: '2026-01-01T12:00:00.000Z' }) },
      { id: 'c', note: gitlabNote(13, { author: gitlabUser(3), created_at: '2026-01-01T13:00:00.000Z' }) }
    ]
    const copies = [
      gitlabNote(91, { created_at: '2026-05-01T00:00:00.000Z' }),
      gitlabNote(92, { created_at: '2026-01-01T12:00:00.000Z' }),
      gitlabNote(93, { author: gitlabUser(4), created_at: '2026-01-01T13:00:00.000Z' })
    ]
    const pairs = pairMovedNotes(known, copies)
    expect(pairs.get('b')?.id).toBe(92)
    expect(pairs.get('a')?.id).toBe(91)
    // No copy by the same author
    expect(pairs.has('c')).toBe(false)
  })
})

describe('IssueSyncManager: moved in Huly', () => {
  it('moves the GitLab issue and re-keys its notes', async () => {
    const api = fakeApi({
      moveIssue: async () =>
        gitlabIssue(8, { project_id: TARGET_PROJECT_ID, web_url: `${HOST}/group/other/-/issues/8` }),
      listNotes: async () => [gitlabNote(91, { created_at: gitlabNote(11).created_at })]
    })
    const env = setup(api)
    movedIssue(env.memory, 'prj-2')
    await move(env)
    expect(api.moveIssue).toHaveBeenCalledWith(PROJECT_ID, 1, TARGET_PROJECT_ID)
    expect(api.listNotes).toHaveBeenCalledWith(TARGET_PROJECT_ID, 'issues', 8)
    expect(syncDocOf(env.memory, 'issue-1')).toMatchObject({
      space: 'prj-2',
      key: NEW_KEY,
      repository: 'repo-2',
      gitlabIid: 8,
      needSync: GITLAB_SYNC_VERSION
    })
    expect(docOf(env.memory, 'issue-1', tracker.class.Issue)[gitlab.mixin.GitlabIssue]).toMatchObject({
      url: `${HOST}/group/other/-/issues/8`,
      gitlabIid: 8,
      repository: 'repo-2',
      syncError: null
    })
    expect(syncDocOf(env.memory, 'msg-1')).toMatchObject({
      space: 'prj-2',
      parent: NEW_KEY,
      key: noteKey(NEW_KEY, 91),
      repository: 'repo-2'
    })
    // Not in GitLab yet: it goes to the moved issue
    expect(syncDocOf(env.memory, 'msg-2')).toMatchObject({ space: 'prj-2', needSync: '' })
    expect(api.updateIssue).not.toHaveBeenCalled()
  })

  it('never imports the issue GitLab left behind', async () => {
    const api = fakeApi({
      moveIssue: async () => gitlabIssue(8, { project_id: TARGET_PROJECT_ID }),
      listNotes: async () => []
    })
    const env = setup(api)
    movedIssue(env.memory, 'prj-2')
    await move(env)
    await env.issues.receive(
      ctx,
      env.source,
      gitlabIssue(1, { state: 'closed', moved_to_id: 3008, updated_at: '2026-03-01T00:00:00.000Z' })
    )
    expect(env.memory.docs.filter((d) => d._class === gitlab.class.DocSyncInfo && d.key === KEY_1)).toHaveLength(0)
  })

  it('closes the GitLab issue and keeps the Huly issue unlinked when the new project has no repository on that host', async () => {
    const api = fakeApi({ updateIssue: async () => gitlabIssue(1, { state: 'closed' }) })
    const env = setup(api)
    movedIssue(env.memory, 'prj-3')
    await move(env)
    expect(api.updateIssue).toHaveBeenCalledWith(PROJECT_ID, 1, { state_event: 'close' })
    expect(syncDocOf(env.memory, 'issue-1')).toBeUndefined()
    expect(syncDocOf(env.memory, 'msg-1')).toBeUndefined()
    expect(syncDocOf(env.memory, 'msg-2')).toBeUndefined()
    expect(docOf(env.memory, 'issue-1', tracker.class.Issue)[gitlab.mixin.GitlabIssue]).toEqual({
      url: '',
      gitlabIid: 0,
      repository: null,
      syncError: null
    })
  })

  it('does not import the closed issue back into the old project after a move to an unlinked one', async () => {
    const api = fakeApi({ updateIssue: async () => gitlabIssue(1, { state: 'closed' }) })
    const env = setup(api)
    movedIssue(env.memory, 'prj-3')
    await move(env)
    await env.issues.receive(
      ctx,
      env.source,
      gitlabIssue(1, { state: 'closed', updated_at: '2026-03-01T00:00:00.000Z' })
    )
    const live = env.memory.docs.filter(
      (d) => d._class === gitlab.class.DocSyncInfo && d.key === KEY_1 && (d.deleted !== true || d.needSync === '')
    )
    expect(live).toEqual([])
  })

  it('moves only the sync doc of an issue that is not in GitLab yet', async () => {
    const env = setup(fakeApi())
    hulyIssue(env.memory, 'issue-h', { space: 'prj-2' })
    env.memory.docs.push({
      _id: 'issue-h',
      _class: gitlab.class.DocSyncInfo,
      space: 'prj-1',
      key: '',
      objectClass: tracker.class.Issue,
      repository: null,
      gitlabIid: 0,
      needSync: ''
    })
    await env.issues.handleMove(
      ctx,
      { ...docOf(env.memory, 'issue-h', tracker.class.Issue) },
      { ...syncDocOf(env.memory, 'issue-h') }
    )
    expect(syncDocOf(env.memory, 'issue-h')).toMatchObject({ space: 'prj-2', key: '', needSync: '' })
  })

  it("holds the original issue's webhook until the move is stored", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const api = fakeApi({
      moveIssue: async () => {
        await gate
        return gitlabIssue(8, { project_id: TARGET_PROJECT_ID })
      },
      listNotes: async () => [],
      getIssue: async () =>
        gitlabIssue(1, { state: 'closed', moved_to_id: 3008, updated_at: '2026-03-01T00:00:00.000Z' })
    })
    const env = setup(api)
    movedIssue(env.memory, 'prj-2')
    const moving = move(env)
    await waitUntil(() => api.moveIssue.mock.calls.length > 0)
    const webhook = env.issues.handleIssueEvent(ctx, env.source, api as any, 1)
    await flushPending()
    // The webhook waits for the move: it must not read the sync doc before the move rewrote it
    expect(api.getIssue).not.toHaveBeenCalled()
    release()
    await Promise.all([moving, webhook])
    expect(syncDocOf(env.memory, 'issue-1')).toMatchObject({
      key: NEW_KEY,
      gitlabIid: 8,
      needSync: GITLAB_SYNC_VERSION
    })
    expect(env.memory.docs.filter((d) => d._class === gitlab.class.DocSyncInfo && d.key === KEY_1)).toHaveLength(0)
  })

  it('drops a pick of the old project when an issue not in GitLab yet moves', async () => {
    const env = setup(fakeApi())
    const picked = { url: '', gitlabIid: 0, repository: 'repo-1', syncError: 'GitLab POST failed: 500' }
    hulyIssue(env.memory, 'issue-h', { space: 'prj-2', [gitlab.mixin.GitlabIssue]: { ...picked } })
    hulyIssue(env.memory, 'issue-k', { space: 'prj-3', [gitlab.mixin.GitlabIssue]: { ...picked } })
    for (const id of ['issue-h', 'issue-k']) {
      env.memory.docs.push({
        _id: id,
        _class: gitlab.class.DocSyncInfo,
        space: 'prj-1',
        key: '',
        objectClass: tracker.class.Issue,
        repository: null,
        gitlabIid: 0,
        needSync: ''
      })
      await env.issues.handleMove(
        ctx,
        { ...docOf(env.memory, id, tracker.class.Issue) },
        { ...syncDocOf(env.memory, id) }
      )
    }
    // The new project's only repository takes over; without one, the header offers the picker again
    expect(docOf(env.memory, 'issue-h', tracker.class.Issue)[gitlab.mixin.GitlabIssue]).toMatchObject({
      repository: 'repo-2',
      syncError: null
    })
    expect(docOf(env.memory, 'issue-k', tracker.class.Issue)[gitlab.mixin.GitlabIssue]).toMatchObject({
      repository: null,
      syncError: null
    })
  })

  it('leaves everything in place when GitLab refuses the move', async () => {
    const api = fakeApi({
      moveIssue: async () => {
        throw new GitlabApiError(403, 'GitLab POST failed: 403')
      }
    })
    const env = setup(api)
    movedIssue(env.memory, 'prj-2')
    await expect(move(env)).rejects.toThrow('403')
    expect(syncDocOf(env.memory, 'issue-1')).toMatchObject({ space: 'prj-1', key: KEY_1 })
    expect(syncDocOf(env.memory, 'msg-1')).toMatchObject({ space: 'prj-1' })
  })
})
