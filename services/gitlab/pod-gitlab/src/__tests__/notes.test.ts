// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import chunter from '@hcengineering/chunter'
import gitlab, { type DocSyncInfo } from '@hcengineering/gitlab'
import tracker from '@hcengineering/tracker'
import { issueKey, noteKey } from '../sync/keys'
import { isSyncedNote, NoteSyncManager } from '../sync/notes'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import { HOST, PROJECT_ID, gitlabIssue, gitlabNote, hulyIssue, seedRepository } from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import { asApi, createTestProvider, ctx, fakeApi, type FakeApi, type TestProvider } from './helpers/provider'

const ISSUE_KEY = issueKey(HOST, PROJECT_ID, 1)

interface Env {
  memory: MemoryClient
  provider: TestProvider
  notes: NoteSyncManager
  api: FakeApi
  repo: any
}

/** A linked Huly issue 'issue-1' with its sync doc, as after an import. */
function setup (api: FakeApi = fakeApi()): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  hulyIssue(memory, 'issue-1')
  memory.docs.push({
    _id: 'issue-1', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: ISSUE_KEY, objectClass: tracker.class.Issue,
    repository: 'repo-1', gitlabIid: 1, external: gitlabIssue(1), needSync: GITLAB_SYNC_VERSION
  })
  const provider = createTestProvider(memory, [repo], api)
  return { memory, provider, notes: new NoteSyncManager(provider), api, repo }
}

const syncInfo = (memory: MemoryClient, id: string): any =>
  memory.docs.find((d) => d._id === id && d._class === gitlab.class.DocSyncInfo)
const noteInfos = (memory: MemoryClient): any[] =>
  memory.docs.filter((d) => d._class === gitlab.class.DocSyncInfo && d.objectClass === chunter.class.ChatMessage)
const messages = (memory: MemoryClient): any[] => memory.docs.filter((d) => d._class === chunter.class.ChatMessage)

async function syncDoc (env: Env, id: string): Promise<any> {
  const info = syncInfo(env.memory, id)
  const existing = env.memory.docs.find((d) => d._id === id && d._class === chunter.class.ChatMessage)
  const parent = info.parent !== undefined
    ? env.memory.docs.find((d) => d._class === gitlab.class.DocSyncInfo && d.key === info.parent)
    : syncInfo(env.memory, info.attachedTo)
  const update = await env.notes.sync(ctx, existing as any, { ...info } as DocSyncInfo, parent)
  Object.assign(info, update)
  return update
}

describe('isSyncedNote', () => {
  it('excludes system, internal and confidential notes', () => {
    expect(isSyncedNote(gitlabNote(1))).toBe(true)
    expect(isSyncedNote(gitlabNote(1, { system: true }))).toBe(false)
    expect(isSyncedNote(gitlabNote(1, { internal: true }))).toBe(false)
    expect(isSyncedNote(gitlabNote(1, { confidential: true }))).toBe(false)
  })
})

describe('NoteSyncManager: GitLab to Huly', () => {
  it('imports a GitLab note as a comment by its author', async () => {
    const env = setup(fakeApi({ getIssueNote: async () => gitlabNote(9) }))
    await env.notes.handleNoteEvent(ctx, env.repo, asApi(env.api), 1, 9)
    const info = noteInfos(env.memory)[0]
    expect(info).toMatchObject({ key: noteKey(ISSUE_KEY, 9), parent: ISSUE_KEY, repository: 'repo-1', needSync: '' })
    await syncDoc(env, info._id)
    expect(messages(env.memory)[0]).toMatchObject({
      _id: info._id,
      attachedTo: 'issue-1',
      collection: 'comments',
      message: env.provider.markdown.toMarkup('Note 9'),
      modifiedBy: 'sid-2'
    })
    expect(info.needSync).toBe(GITLAB_SYNC_VERSION)
  })

  it('skips system and internal notes in a listing', async () => {
    const env = setup(fakeApi({ listIssueNotes: async () => [gitlabNote(1, { system: true }), gitlabNote(2, { internal: true }), gitlabNote(3)] }))
    await env.notes.refreshNotes(ctx, env.repo, asApi(env.api), gitlabIssue(1))
    expect(noteInfos(env.memory).map((it) => it.key)).toEqual([noteKey(ISSUE_KEY, 3)])
  })

  it('updates the Huly comment when the note is edited in GitLab', async () => {
    const env = setup(fakeApi({ getIssueNote: async () => gitlabNote(9) }))
    await env.notes.handleNoteEvent(ctx, env.repo, asApi(env.api), 1, 9)
    const id = noteInfos(env.memory)[0]._id
    await syncDoc(env, id)
    env.api.getIssueNote.mockResolvedValue(gitlabNote(9, { body: 'Edited', updated_at: '2026-01-02T00:00:00.000Z' }))
    await env.notes.handleNoteEvent(ctx, env.repo, asApi(env.api), 1, 9)
    await syncDoc(env, id)
    expect(messages(env.memory)[0].message).toBe(env.provider.markdown.toMarkup('Edited'))
  })

  it('removes the Huly comment when a complete listing no longer has the note', async () => {
    const env = setup(fakeApi({ listIssueNotes: async () => [gitlabNote(9)] }))
    await env.notes.refreshNotes(ctx, env.repo, asApi(env.api), gitlabIssue(1))
    const id = noteInfos(env.memory)[0]._id
    await syncDoc(env, id)
    env.api.listIssueNotes.mockResolvedValue([])
    await env.notes.refreshNotes(ctx, env.repo, asApi(env.api), gitlabIssue(1))
    expect(messages(env.memory)).toEqual([])
    expect(noteInfos(env.memory)).toEqual([])
  })

  it('waits for the issue before creating a comment', async () => {
    const env = setup()
    env.memory.docs.splice(env.memory.docs.findIndex((d) => d._id === 'issue-1' && d._class === tracker.class.Issue), 1)
    env.memory.docs.push({ _id: 'note-x', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: noteKey(ISSUE_KEY, 9), parent: ISSUE_KEY, objectClass: chunter.class.ChatMessage, repository: 'repo-1', gitlabIid: 0, external: gitlabNote(9), needSync: '' })
    expect(await syncDoc(env, 'note-x')).toEqual({ needSync: GITLAB_SYNC_VERSION })
    expect(messages(env.memory)).toEqual([])
  })
})

describe('NoteSyncManager: Huly to GitLab', () => {
  function hulyComment (env: Env, text: string): void {
    env.memory.docs.push({ _id: 'msg-1', _class: chunter.class.ChatMessage, space: 'prj-1', attachedTo: 'issue-1', attachedToClass: tracker.class.Issue, collection: 'comments', message: env.provider.markdown.toMarkup(text), modifiedBy: 'sid-huly' })
    env.memory.docs.push({ _id: 'msg-1', _class: gitlab.class.DocSyncInfo, space: 'prj-1', key: '', objectClass: chunter.class.ChatMessage, repository: null, gitlabIid: 0, needSync: '', attachedTo: 'issue-1' })
  }

  it('creates a GitLab note for a Huly comment', async () => {
    const env = setup(fakeApi({ createIssueNote: async () => gitlabNote(55, { body: 'Hello' }) }))
    hulyComment(env, 'Hello')
    await syncDoc(env, 'msg-1')
    expect(env.api.createIssueNote).toHaveBeenCalledWith(PROJECT_ID, 1, expect.stringMatching(/^Hello\s*$/))
    expect(syncInfo(env.memory, 'msg-1')).toMatchObject({ key: noteKey(ISSUE_KEY, 55), parent: ISSUE_KEY, repository: 'repo-1' })
  })

  it('a note webhook during creation does not import a copy', async () => {
    const created = gitlabNote(55, { body: 'Hello' })
    let release: (() => void) | undefined
    const api = fakeApi({
      createIssueNote: async () => {
        await new Promise<void>((resolve) => { release = resolve })
        return created
      },
      getIssueNote: async () => created
    })
    const env = setup(api)
    hulyComment(env, 'Hello')
    const syncing = syncDoc(env, 'msg-1')
    for (let i = 0; i < 50 && release === undefined; i++) await new Promise((r) => setImmediate(r))
    const event = env.notes.handleNoteEvent(ctx, env.repo, asApi(api), 1, 55)
    release?.()
    await Promise.all([syncing, event])
    expect(noteInfos(env.memory)).toHaveLength(1)
    expect(messages(env.memory)).toHaveLength(1)
  })

  it('waits while the issue is not in GitLab yet', async () => {
    const env = setup()
    syncInfo(env.memory, 'issue-1').key = ''
    hulyComment(env, 'Hello')
    expect(await syncDoc(env, 'msg-1')).toEqual({ needSync: GITLAB_SYNC_VERSION })
    expect(env.api.createIssueNote).not.toHaveBeenCalled()
  })

  it('pushes a Huly edit of a synced comment', async () => {
    const env = setup(fakeApi({
      createIssueNote: async () => gitlabNote(55, { body: 'Hello' }),
      updateIssueNote: async () => gitlabNote(55, { body: 'Hello again', updated_at: '2026-01-02T00:00:00.000Z' })
    }))
    hulyComment(env, 'Hello')
    await syncDoc(env, 'msg-1')
    messages(env.memory)[0].message = env.provider.markdown.toMarkup('Hello again')
    await syncDoc(env, 'msg-1')
    expect(env.api.updateIssueNote).toHaveBeenCalledWith(PROJECT_ID, 1, 55, expect.stringMatching(/^Hello again\s*$/))
  })

  it('deletes the GitLab note when the Huly comment is deleted', async () => {
    const env = setup(fakeApi({ createIssueNote: async () => gitlabNote(55), deleteIssueNote: async () => {} }))
    hulyComment(env, 'Hello')
    await syncDoc(env, 'msg-1')
    expect(await env.notes.handleDelete(ctx, syncInfo(env.memory, 'msg-1'))).toBe(true)
    expect(env.api.deleteIssueNote).toHaveBeenCalledWith(PROJECT_ID, 1, 55)
  })

  it('keeps the GitLab notes when comments go away with their deleted issue', async () => {
    const env = setup(fakeApi({ createIssueNote: async () => gitlabNote(55) }))
    hulyComment(env, 'Hello')
    await syncDoc(env, 'msg-1')
    env.memory.docs.splice(env.memory.docs.findIndex((d) => d._id === 'issue-1' && d._class === tracker.class.Issue), 1)
    expect(await env.notes.handleDelete(ctx, syncInfo(env.memory, 'msg-1'))).toBe(true)
    expect(env.api.deleteIssueNote).not.toHaveBeenCalled()
  })
})
