// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import attachment from '@hcengineering/attachment'
import chunter from '@hcengineering/chunter'
import gitlab from '@hcengineering/gitlab'
import tracker from '@hcengineering/tracker'
import { GitlabApiError } from '../gitlab/api'
import { ATTACHMENT_MARKER } from '../sync/attachments'
import { issueKey, mergeRequestKey, noteKey } from '../sync/keys'
import { isSyncedNote, NoteSyncManager } from '../sync/notes'
import type { ImageStore } from '../sync/types'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import {
  HOST,
  PROJECT_ID,
  gitlabIssue,
  gitlabMergeRequest,
  gitlabNote,
  hulyIssue,
  hulyMergeRequest,
  seedRepository,
  setImageMode
} from './helpers/fixtures'
import { createMemoryClient, type MemoryClient } from './helpers/memory'
import {
  asApi,
  createTestProvider,
  ctx,
  fakeApi,
  fakeImages,
  type FakeApi,
  type TestProvider
} from './helpers/provider'

const ISSUE_KEY = issueKey(HOST, PROJECT_ID, 1)

interface Env {
  memory: MemoryClient
  provider: TestProvider
  notes: NoteSyncManager
  api: FakeApi
  repo: any
}

/** A linked Huly issue 'issue-1' with its sync doc, as after an import. */
function setup (api: FakeApi = fakeApi(), options: { images?: ImageStore } = {}): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  hulyIssue(memory, 'issue-1')
  memory.docs.push({
    _id: 'issue-1',
    _class: gitlab.class.DocSyncInfo,
    space: 'prj-1',
    key: ISSUE_KEY,
    objectClass: tracker.class.Issue,
    repository: 'repo-1',
    gitlabIid: 1,
    external: gitlabIssue(1),
    needSync: GITLAB_SYNC_VERSION
  })
  const provider = createTestProvider(memory, [repo], api, options)
  return { memory, provider, notes: new NoteSyncManager(provider), api, repo }
}

const syncInfo = (memory: MemoryClient, id: string): any =>
  memory.docs.find((d) => d._id === id && d._class === gitlab.class.DocSyncInfo)
const noteInfos = (memory: MemoryClient): any[] =>
  memory.docs.filter((d) => d._class === gitlab.class.DocSyncInfo && d.objectClass === chunter.class.ChatMessage)
const messages = (memory: MemoryClient): any[] => memory.docs.filter((d) => d._class === chunter.class.ChatMessage)

/** Lets pending callbacks run until `ready` holds (at most 50 turns). */
async function waitUntil (ready: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !ready(); i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

async function syncDoc (env: Env, id: string): Promise<any> {
  const info = syncInfo(env.memory, id)
  const existing = env.memory.docs.find((d) => d._id === id && d._class === chunter.class.ChatMessage)
  const parent =
    info.parent !== undefined
      ? env.memory.docs.find((d) => d._class === gitlab.class.DocSyncInfo && d.key === info.parent)
      : syncInfo(env.memory, info.attachedTo)
  const update = await env.notes.sync(ctx, existing as any, { ...info }, parent)
  Object.assign(info, update)
  return update
}

describe('isSyncedNote', () => {
  it('excludes system, internal and confidential notes', () => {
    expect(isSyncedNote(gitlabNote(1))).toBe(true)
    expect(isSyncedNote(gitlabNote(1, { type: 'DiffNote' }))).toBe(false)
    expect(isSyncedNote(gitlabNote(1, { type: 'DiscussionNote' }))).toBe(true)
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
    const env = setup(
      fakeApi({
        listIssueNotes: async () => [gitlabNote(1, { system: true }), gitlabNote(2, { internal: true }), gitlabNote(3)]
      })
    )
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
    env.memory.docs.splice(
      env.memory.docs.findIndex((d) => d._id === 'issue-1' && d._class === tracker.class.Issue),
      1
    )
    env.memory.docs.push({
      _id: 'note-x',
      _class: gitlab.class.DocSyncInfo,
      space: 'prj-1',
      key: noteKey(ISSUE_KEY, 9),
      parent: ISSUE_KEY,
      objectClass: chunter.class.ChatMessage,
      repository: 'repo-1',
      gitlabIid: 0,
      external: gitlabNote(9),
      needSync: ''
    })
    expect(await syncDoc(env, 'note-x')).toEqual({ needSync: GITLAB_SYNC_VERSION })
    expect(messages(env.memory)).toEqual([])
  })

  it('copies a GitLab image into the imported comment', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const env = setup(
      fakeApi({
        getIssueNote: async () => gitlabNote(9, { body: `![shot](/uploads/${S}/shot.png)` }),
        downloadUpload: async () => ({ data: Buffer.from('png'), contentType: 'image/png' })
      }),
      { images: fakeImages() }
    )
    setImageMode(env.repo, 'copy')
    await env.notes.handleNoteEvent(ctx, env.repo, asApi(env.api), 1, 9)
    await syncDoc(env, noteInfos(env.memory)[0]._id)
    expect(messages(env.memory)[0].message).toBe(
      env.provider.markdown.toMarkup('![shot](http://front/files?file=blob-1)')
    )
  })

  it('re-links a copied image of a comment after switching to link', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const env = setup(
      fakeApi({
        getIssueNote: async () => gitlabNote(9, { body: `![shot](/uploads/${S}/shot.png)` }),
        downloadUpload: async () => ({ data: Buffer.from('png'), contentType: 'image/png' })
      }),
      { images: fakeImages() }
    )
    setImageMode(env.repo, 'copy')
    await env.notes.handleNoteEvent(ctx, env.repo, asApi(env.api), 1, 9)
    const infoId = noteInfos(env.memory)[0]._id
    await syncDoc(env, infoId)
    expect(messages(env.memory)[0].message).toBe(
      env.provider.markdown.toMarkup('![shot](http://front/files?file=blob-1)')
    )
    setImageMode(env.repo, 'link')
    noteInfos(env.memory)[0].needSync = ''
    await syncDoc(env, infoId)
    expect(messages(env.memory)[0].message).toBe(
      env.provider.markdown.toMarkup(
        `[shot](https://gitlab.example.com/-/project/42/uploads/${S}/shot.png#gitlab-image)`
      )
    )
    expect(env.api.updateIssueNote).not.toHaveBeenCalled()
  })

  it('does not import the attachment block into the comment text', async () => {
    const env = setup(
      fakeApi({
        getIssueNote: async () =>
          gitlabNote(9, {
            body: `Look\n\n${ATTACHMENT_MARKER}\n[spec.pdf](/uploads/0123456789abcdef0123456789abcdef/spec.pdf)`
          })
      })
    )
    await env.notes.handleNoteEvent(ctx, env.repo, asApi(env.api), 1, 9)
    await syncDoc(env, noteInfos(env.memory)[0]._id)
    expect(messages(env.memory)[0].message).toBe(env.provider.markdown.toMarkup('Look'))
  })
})

describe('NoteSyncManager: Huly to GitLab', () => {
  it('uploads an image of a Huly comment to GitLab', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const images = fakeImages()
    images.blobs.set('huly-1', { data: Buffer.from('png'), contentType: 'image/png' })
    const env = setup(
      fakeApi({
        createIssueNote: async () => gitlabNote(55, { body: `![a](/uploads/${S}/a.png)` }),
        uploadFile: async () => ({ alt: 'a', url: `/uploads/${S}/a.png`, full_path: '', markdown: '' })
      }),
      { images }
    )
    hulyComment(env, '![a](http://front/files?file=huly-1)')
    // The image is a file of the project
    env.memory.docs.push({
      _id: 'att-issue',
      _class: attachment.class.Attachment,
      space: 'prj-1',
      attachedTo: 'issue-1',
      attachedToClass: tracker.class.Issue,
      collection: 'attachments',
      file: 'huly-1',
      name: 'a.png',
      type: 'image/png',
      size: 3
    })
    await syncDoc(env, 'msg-1')
    expect(env.api.createIssueNote).toHaveBeenCalledWith(
      PROJECT_ID,
      1,
      expect.stringMatching(new RegExp(`^!\\[a\\]\\(/uploads/${S}/a\\.png\\)\\s*$`))
    )
  })

  function hulyComment (env: Env, text: string): void {
    env.memory.docs.push({
      _id: 'msg-1',
      _class: chunter.class.ChatMessage,
      space: 'prj-1',
      attachedTo: 'issue-1',
      attachedToClass: tracker.class.Issue,
      collection: 'comments',
      message: env.provider.markdown.toMarkup(text),
      modifiedBy: 'sid-huly'
    })
    env.memory.docs.push({
      _id: 'msg-1',
      _class: gitlab.class.DocSyncInfo,
      space: 'prj-1',
      key: '',
      objectClass: chunter.class.ChatMessage,
      repository: null,
      gitlabIid: 0,
      needSync: '',
      attachedTo: 'issue-1'
    })
  }

  it('creates a GitLab note for a Huly comment', async () => {
    const env = setup(fakeApi({ createIssueNote: async () => gitlabNote(55, { body: 'Hello' }) }))
    hulyComment(env, 'Hello')
    await syncDoc(env, 'msg-1')
    expect(env.api.createIssueNote).toHaveBeenCalledWith(PROJECT_ID, 1, expect.stringMatching(/^Hello\s*$/))
    expect(syncInfo(env.memory, 'msg-1')).toMatchObject({
      key: noteKey(ISSUE_KEY, 55),
      parent: ISSUE_KEY,
      repository: 'repo-1'
    })
  })

  it('a note webhook during creation does not import a copy', async () => {
    const created = gitlabNote(55, { body: 'Hello' })
    let release: (() => void) | undefined
    const api = fakeApi({
      createIssueNote: async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return created
      },
      getIssueNote: async () => created
    })
    const env = setup(api)
    hulyComment(env, 'Hello')
    const syncing = syncDoc(env, 'msg-1')
    await waitUntil(() => release !== undefined)
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
    const env = setup(
      fakeApi({
        createIssueNote: async () => gitlabNote(55, { body: 'Hello' }),
        updateIssueNote: async () => gitlabNote(55, { body: 'Hello again', updated_at: '2026-01-02T00:00:00.000Z' })
      })
    )
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
    env.memory.docs.splice(
      env.memory.docs.findIndex((d) => d._id === 'issue-1' && d._class === tracker.class.Issue),
      1
    )
    expect(await env.notes.handleDelete(ctx, syncInfo(env.memory, 'msg-1'))).toBe(true)
    expect(env.api.deleteIssueNote).not.toHaveBeenCalled()
  })

  function attach (env: Env, id: string, file: string, name: string, type: string): void {
    env.memory.docs.push({
      _id: id,
      _class: attachment.class.Attachment,
      space: 'prj-1',
      attachedTo: 'msg-1',
      attachedToClass: chunter.class.ChatMessage,
      collection: 'attachments',
      file,
      name,
      type,
      size: 3,
      createdOn: Number(id.slice(-1))
    })
  }

  it('sends the attachments of a Huly comment as a block at the end of the note', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const images = fakeImages()
    images.blobs.set('blob-a', { data: Buffer.from('png'), contentType: 'image/png' })
    images.blobs.set('blob-b', { data: Buffer.from('pdf'), contentType: 'application/pdf' })
    const env = setup(
      fakeApi({
        createIssueNote: async (_p: number, _i: number, body: string) => gitlabNote(55, { body }),
        uploadFile: async (_id: number, name: string) => ({
          alt: name,
          url: `/uploads/${S}/${name}`,
          full_path: '',
          markdown: ''
        })
      }),
      { images }
    )
    hulyComment(env, 'Look')
    attach(env, 'att-1', 'blob-a', 'shot.png', 'image/png')
    attach(env, 'att-2', 'blob-b', 'spec.pdf', 'application/pdf')
    await syncDoc(env, 'msg-1')
    const body: string = env.api.createIssueNote.mock.calls[0][2]
    expect(body).toBe(
      `Look\n\n${ATTACHMENT_MARKER}\n![shot.png](/uploads/${S}/shot.png)\n[spec.pdf](/uploads/${S}/spec.pdf)`
    )
  })

  it('creates a note for a comment with only an attachment', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const images = fakeImages()
    images.blobs.set('blob-a', { data: Buffer.from('png'), contentType: 'image/png' })
    const env = setup(
      fakeApi({
        createIssueNote: async (_p: number, _i: number, body: string) => gitlabNote(55, { body }),
        uploadFile: async (_id: number, name: string) => ({
          alt: name,
          url: `/uploads/${S}/${name}`,
          full_path: '',
          markdown: ''
        })
      }),
      { images }
    )
    hulyComment(env, '')
    attach(env, 'att-1', 'blob-a', 'shot.png', 'image/png')
    await syncDoc(env, 'msg-1')
    expect(env.api.createIssueNote.mock.calls[0][2]).toBe(`${ATTACHMENT_MARKER}\n![shot.png](/uploads/${S}/shot.png)`)
  })

  it('sends a note again when an attachment is added later, keeping its text as GitLab has it', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const images = fakeImages()
    images.blobs.set('blob-a', { data: Buffer.from('png'), contentType: 'image/png' })
    const env = setup(
      fakeApi({
        createIssueNote: async (_p: number, _i: number, body: string) => gitlabNote(55, { body }),
        updateIssueNote: async (_p: number, _i: number, _n: number, body: string) =>
          gitlabNote(55, { body, updated_at: '2026-01-02T00:00:00.000Z' }),
        uploadFile: async (_id: number, name: string) => ({
          alt: name,
          url: `/uploads/${S}/${name}`,
          full_path: '',
          markdown: ''
        })
      }),
      { images }
    )
    hulyComment(env, 'Look')
    await syncDoc(env, 'msg-1')
    attach(env, 'att-1', 'blob-a', 'shot.png', 'image/png')
    syncInfo(env.memory, 'msg-1').needSync = ''
    await syncDoc(env, 'msg-1')
    expect(env.api.updateIssueNote).toHaveBeenCalledWith(
      PROJECT_ID,
      1,
      55,
      `Look\n\n${ATTACHMENT_MARKER}\n![shot.png](/uploads/${S}/shot.png)`
    )
  })

  it('does not send an empty note when the last attachment of a text-less comment is removed', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const images = fakeImages()
    images.blobs.set('blob-a', { data: Buffer.from('png'), contentType: 'image/png' })
    const env = setup(
      fakeApi({
        createIssueNote: async (_p: number, _i: number, body: string) => gitlabNote(55, { body }),
        uploadFile: async (_id: number, name: string) => ({
          alt: name,
          url: `/uploads/${S}/${name}`,
          full_path: '',
          markdown: ''
        })
      }),
      { images }
    )
    hulyComment(env, '')
    attach(env, 'att-1', 'blob-a', 'shot.png', 'image/png')
    await syncDoc(env, 'msg-1')
    env.memory.docs.splice(
      env.memory.docs.findIndex((d) => d._id === 'att-1'),
      1
    )
    syncInfo(env.memory, 'msg-1').needSync = ''
    const result = await syncDoc(env, 'msg-1')
    expect(env.api.updateIssueNote).not.toHaveBeenCalled()
    expect(result.error ?? null).toBeNull()
    expect(result.needSync).toBe(GITLAB_SYNC_VERSION)
  })

  it('imports a GitLab text edit while an attachment upload is refused, and retries the note', async () => {
    const S = '0123456789abcdef0123456789abcdef'
    const images = fakeImages()
    images.blobs.set('blob-a', { data: Buffer.from('png'), contentType: 'image/png' })
    const env = setup(
      fakeApi({
        createIssueNote: async (_p: number, _i: number, body: string) => gitlabNote(55, { body }),
        uploadFile: async (_id: number, name: string) => ({
          alt: name,
          url: `/uploads/${S}/${name}`,
          full_path: '',
          markdown: ''
        })
      }),
      { images }
    )
    hulyComment(env, 'Hello')
    await syncDoc(env, 'msg-1')
    attach(env, 'att-1', 'blob-a', 'shot.png', 'image/png')
    env.api.uploadFile.mockRejectedValue(new GitlabApiError(413, 'too large'))
    Object.assign(syncInfo(env.memory, 'msg-1'), {
      external: gitlabNote(55, { body: 'Edited in GitLab', updated_at: '2026-01-02T00:00:00.000Z' }),
      needSync: ''
    })
    const result = await syncDoc(env, 'msg-1')
    expect(messages(env.memory)[0].message).toBe(env.provider.markdown.toMarkup('Edited in GitLab'))
    expect(env.api.updateIssueNote).not.toHaveBeenCalled()
    expect(result).toMatchObject({ retryable: true })
    expect(result.error).toEqual(expect.stringContaining('too large'))
  })
})

const MR_KEY = mergeRequestKey(HOST, PROJECT_ID, 3)

/** A linked Huly merge request 'mr-3' with its sync doc. */
function setupMergeRequest (api: FakeApi = fakeApi()): Env {
  const env = setup(api)
  hulyMergeRequest(env.memory, 'mr-3')
  env.memory.docs.push({
    _id: 'mr-3',
    _class: gitlab.class.DocSyncInfo,
    space: 'prj-1',
    key: MR_KEY,
    objectClass: gitlab.class.GitlabMergeRequest,
    repository: 'repo-1',
    gitlabIid: 3,
    external: gitlabMergeRequest(3),
    needSync: GITLAB_SYNC_VERSION
  })
  return env
}

describe('NoteSyncManager: merge requests', () => {
  it('imports a merge request note as a comment on the Huly merge request', async () => {
    const env = setupMergeRequest(
      fakeApi({ getMergeRequestNote: async () => gitlabNote(9, { noteable_type: 'MergeRequest' }) })
    )
    await env.notes.handleNoteEvent(ctx, env.repo, asApi(env.api), 3, 9, 'merge_requests')
    expect(env.api.getMergeRequestNote).toHaveBeenCalledWith(PROJECT_ID, 3, 9)
    const info = noteInfos(env.memory)[0]
    expect(info).toMatchObject({ key: noteKey(MR_KEY, 9), parent: MR_KEY })
    await syncDoc(env, info._id)
    expect(messages(env.memory)[0]).toMatchObject({
      attachedTo: 'mr-3',
      attachedToClass: gitlab.class.GitlabMergeRequest,
      collection: 'comments'
    })
  })

  it('posts a Huly comment on a merge request to the merge request notes', async () => {
    const env = setupMergeRequest(fakeApi({ createMergeRequestNote: async () => gitlabNote(11) }))
    env.memory.docs.push({
      _id: 'msg-1',
      _class: chunter.class.ChatMessage,
      space: 'prj-1',
      attachedTo: 'mr-3',
      message: env.provider.markdown.toMarkup('Looks good'),
      modifiedBy: 'sid-huly-user'
    })
    env.memory.docs.push({
      _id: 'msg-1',
      _class: gitlab.class.DocSyncInfo,
      space: 'prj-1',
      key: '',
      objectClass: chunter.class.ChatMessage,
      repository: null,
      gitlabIid: 0,
      needSync: '',
      attachedTo: 'mr-3'
    })
    await syncDoc(env, 'msg-1')
    expect(env.api.createMergeRequestNote).toHaveBeenCalledWith(PROJECT_ID, 3, expect.stringMatching(/^Looks good\s*$/))
    expect(syncInfo(env.memory, 'msg-1')).toMatchObject({ key: noteKey(MR_KEY, 11), parent: MR_KEY })
  })

  it('lists merge request notes and never imports diff notes', async () => {
    const env = setupMergeRequest(
      fakeApi({
        listMergeRequestNotes: async () => [gitlabNote(9), gitlabNote(10, { type: 'DiffNote' })]
      })
    )
    await env.notes.refreshNotes(ctx, env.repo, asApi(env.api), gitlabMergeRequest(3), 'merge_requests')
    expect(noteInfos(env.memory).map((it) => it.key)).toEqual([noteKey(MR_KEY, 9)])
  })

  it('deletes the GitLab merge request note when the Huly comment is deleted', async () => {
    const env = setupMergeRequest(fakeApi({ deleteMergeRequestNote: async () => {} }))
    env.memory.docs.push({
      _id: 'msg-2',
      _class: gitlab.class.DocSyncInfo,
      space: 'prj-1',
      key: noteKey(MR_KEY, 12),
      parent: MR_KEY,
      objectClass: chunter.class.ChatMessage,
      repository: 'repo-1',
      gitlabIid: 0,
      external: gitlabNote(12),
      needSync: '',
      deleted: true
    })
    expect(await env.notes.handleDelete(ctx, syncInfo(env.memory, 'msg-2'))).toBe(true)
    expect(env.api.deleteMergeRequestNote).toHaveBeenCalledWith(PROJECT_ID, 3, 12)
  })
})
