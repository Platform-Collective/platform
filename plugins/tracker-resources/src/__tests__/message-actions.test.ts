// SPDX-License-Identifier: EPL-2.0

import chunter, { type ChatMessage } from '@hcengineering/chunter'
import { getMessageLink } from '@hcengineering/chunter-resources'
import { MessageType, type AttachmentID, type BlobAttachment, type Message } from '@hcengineering/communication-types'
import type { Attachment } from '@hcengineering/attachment'
import type { MessageActionFunction } from '@hcengineering/communication'
import {
  AccountRole,
  Hierarchy,
  setCurrentAccount,
  type Account,
  type AccountUuid,
  type AttachedData,
  type Blob,
  type PersonId,
  type Ref,
  type WorkspaceUuid
} from '@hcengineering/core'
import {
  addEventListener,
  addLocation,
  getResource,
  PlatformEvent,
  removeEventListener,
  setMetadata,
  Severity,
  Status
} from '@hcengineering/platform'
import presentation, { createFileStorage, getClient } from '@hcengineering/presentation'
import { markupToJSON } from '@hcengineering/text'
import { trackerId } from '@hcengineering/tracker'
import type { ViewActionFunction } from '@hcengineering/view'
import { getCurrentResolvedLocation, locationToUrl, showPopup } from '@hcengineering/ui'

import { messageIssueResources } from '../message-actions'
import { copyMessageAttachments, getCopyableMessageAttachments, type MessageIssueData } from '../message-issue'
import tracker from '../plugin'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: async (key: string) => key
}))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: jest.requireActual('@hcengineering/presentation/src/plugin').default,
  ...jest.requireActual('@hcengineering/presentation/src/file'),
  ...jest.requireActual('@hcengineering/presentation/src/file-blob'),
  getClient: jest.fn()
}))
jest.mock('@hcengineering/presentation/src/filetypes', () => ({ getFileMetadata: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({
  getCurrentResolvedLocation: jest.fn(),
  locationToUrl: jest.fn(),
  showPopup: jest.fn()
}))
jest.mock('@hcengineering/chunter-resources', () => ({ getMessageLink: jest.fn() }))

const markup = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fix this\nDetails' }] }]
})
const legacyMessage = {
  _id: 'message-id',
  _class: chunter.class.ChatMessage,
  message: markup
} as unknown as ChatMessage
type MessageCard = Parameters<MessageActionFunction>[1]
const card: MessageCard = {
  _id: 'card-id' as MessageCard['_id'],
  _class: 'card:class:Card' as MessageCard['_class'],
  space: 'space' as MessageCard['space'],
  modifiedOn: 0,
  modifiedBy: 'person-id' as PersonId,
  title: 'Card',
  content: 'content' as MessageCard['content'],
  blobs: {},
  parentInfo: [],
  rank: ''
}
const account: Account = {
  uuid: 'account-id' as AccountUuid,
  role: AccountRole.User,
  primarySocialId: 'person-id' as PersonId,
  socialIds: [],
  fullSocialIds: []
}
const message = {
  id: 'message-id',
  cardId: 'card-id',
  type: MessageType.Text,
  content: '**Fix this**\n\nDetails',
  created: new Date('2026-10-21T10:00:00Z'),
  attachments: []
} as unknown as Message

describe('create issue message actions', () => {
  const findAll = jest.fn()
  const hierarchy = new Hierarchy()
  const client: Pick<ReturnType<typeof getClient>, 'findAll' | 'getHierarchy'> = {
    findAll,
    getHierarchy: () => hierarchy
  }

  const statusListener = jest.fn(async () => {})
  const filesUrl = 'https://files.example'
  let createIssueFromMessage: ViewActionFunction
  let createIssueFromCommunicationMessage: MessageActionFunction
  let canCreateIssueFromMessage: typeof messageIssueResources.function.CanCreateIssueFromMessage
  let canCreateIssueFromCommunicationMessage: typeof messageIssueResources.function.CanCreateIssueFromCommunicationMessage

  beforeAll(async () => {
    addLocation(trackerId, async () => ({ default: async () => messageIssueResources }))
    createIssueFromMessage = await getResource(tracker.actionImpl.CreateIssueFromMessage)
    createIssueFromCommunicationMessage = await getResource(tracker.messageActionImpl.CreateIssue)
    canCreateIssueFromMessage = await getResource(tracker.function.CanCreateIssueFromMessage)
    canCreateIssueFromCommunicationMessage = await getResource(tracker.function.CanCreateIssueFromCommunicationMessage)
  })

  beforeEach(() => {
    jest.clearAllMocks()
    addEventListener(PlatformEvent, statusListener)
    setCurrentAccount(account)
    setMetadata(presentation.metadata.FrontUrl, 'https://huly.example/')
    setMetadata(presentation.metadata.UploadURL, filesUrl)
    setMetadata(presentation.metadata.WorkspaceUuid, 'workspace' as WorkspaceUuid)
    setMetadata(presentation.metadata.FileStorage, createFileStorage(filesUrl))
    jest.mocked(getMessageLink).mockResolvedValue('https://huly.example/source-message')
    jest.mocked(getCurrentResolvedLocation).mockReturnValue({ path: ['workbench', 'workspace', 'tracker'] })
    jest.mocked(locationToUrl).mockReturnValue('/workbench/workspace/inbox/card-id?message=source')
    jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
    findAll.mockResolvedValue([])
    jest.spyOn(hierarchy, 'isDerived').mockReturnValue(true)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    removeEventListener(PlatformEvent, statusListener)
    setMetadata(presentation.metadata.FrontUrl, undefined)
    setMetadata(presentation.metadata.UploadURL, undefined)
    setMetadata(presentation.metadata.WorkspaceUuid, undefined)
    setMetadata(presentation.metadata.FileStorage, undefined)
  })

  it('opens the standard dialog for chat and activity comments without writing to the source', async () => {
    const file = { name: 'file.txt', file: 'blob-id', type: 'text/plain', size: 10, lastModified: 0 }
    findAll.mockResolvedValue([{ ...file, _id: 'attachment-id', attachedTo: legacyMessage._id }])

    await createIssueFromMessage(legacyMessage)

    expect(showPopup).toHaveBeenCalledWith(
      tracker.component.CreateIssue,
      {
        shouldSaveDraft: false,
        initialData: {
          title: 'Fix this',
          description: expect.stringContaining('https://huly.example/source-message'),
          sourceAttachments: [{ attachment: file }]
        }
      },
      'top'
    )
    expect(findAll).toHaveBeenCalledWith(expect.anything(), { attachedTo: legacyMessage._id })
  })

  it('prefills communication text and blob attachments, excluding link previews and applets', async () => {
    const file = {
      id: 'attachment-id',
      mimeType: 'image/png',
      created: message.created,
      params: { blobId: 'existing-blob', fileName: 'image.png', size: 123, metadata: { width: 800 } }
    }
    const attachments = [
      file,
      { id: 'link', mimeType: 'application/vnd.huly.link-preview', params: { url: 'https://example.com' } },
      { id: 'poll', mimeType: 'application/vnd.huly.applet.poll', params: {} }
    ] as Message['attachments']

    await createIssueFromCommunicationMessage({ ...message, attachments }, card)

    expect(showPopup).toHaveBeenCalledWith(
      tracker.component.CreateIssue,
      {
        shouldSaveDraft: false,
        initialData: {
          title: 'Fix this',
          description: expect.stringContaining('/inbox/'),
          sourceAttachments: [
            {
              attachment: {
                file: 'existing-blob',
                name: 'image.png',
                type: 'image/png',
                size: 123,
                metadata: { width: 800 },
                lastModified: message.created.getTime()
              }
            }
          ]
        }
      },
      'top'
    )
    expect(locationToUrl).toHaveBeenCalledWith({
      path: ['workbench', 'workspace', 'inbox', expect.stringContaining('card-id')],
      query: { message: encodeURIComponent(`${message.id}:${message.created.toISOString()}`) }
    })
    expect(findAll).not.toHaveBeenCalled()
  })

  describe.each(['chat', 'communication'])('saving from %s', (kind) => {
    const limit = 25 * 1024 * 1024
    const file: AttachedData<Attachment> = {
      file: 'kept' as Ref<Blob>,
      name: 'image.png',
      type: 'image/png',
      size: 0,
      lastModified: 0
    }
    const declared = { ...file, file: 'declared' as Ref<Blob>, size: limit + 1 }
    const invalid = { ...declared, file: 'blob/id' as Ref<Blob> }
    const downloaded = { ...file, file: 'downloaded' as Ref<Blob> }
    const invalidSmall = { ...file, file: 'bad/id' as Ref<Blob> }

    const upload = jest.fn()

    beforeEach(() => {
      Object.defineProperty(globalThis, 'XMLHttpRequest', {
        configurable: true,
        value: class {
          upload = {}
          status = 200
          responseText = ''
          onload?: () => void
          open = jest.fn()
          setRequestHeader = jest.fn()
          send = (body: FormData): void => {
            upload(body)
            this.onload?.()
          }
        }
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'XMLHttpRequest')
    })

    it.each([
      { name: 'declared oversized', source: [declared], oversized: [declared.file] },
      { name: 'invalid and declared oversized', source: [invalid], oversized: [invalid.file] },
      { name: 'downloaded oversized', source: [downloaded], oversized: [downloaded.file] },
      {
        name: 'mixed files',
        source: [declared, file, invalid, downloaded, invalidSmall],
        oversized: [declared.file, invalid.file, downloaded.file]
      },
      {
        name: 'conflicting sizes for the same blob',
        source: [file, { ...file, size: limit + 1 }],
        oversized: [file.file]
      },
      { name: 'invalid ID only', source: [invalidSmall], oversized: [] },
      { name: 'no omissions', source: [file], oversized: [] }
    ])('saves $name with one warning only if size excluded a file', async ({ source, oversized }) => {
      const fetchFile = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        return new Response(
          new URL(String(url)).searchParams.get('file') === downloaded.file ? new Uint8Array(limit + 1) : 'abc'
        )
      })
      if (kind === 'chat') {
        findAll.mockResolvedValue(source)
        const inlineMessage: ChatMessage = {
          ...legacyMessage,
          message: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Before ' },
                  ...source.map(({ file }) => ({
                    type: 'image',
                    attrs: { 'file-id': file, src: `image://old/${file}` }
                  })),
                  { type: 'text', text: ' after' }
                ]
              }
            ]
          })
        }
        await createIssueFromMessage(inlineMessage)
      } else {
        const images = source.map(({ file }) => `![File](image://old/?file=${encodeURIComponent(file)})`).join('')
        await createIssueFromCommunicationMessage(
          {
            ...message,
            content: `Before ${images} after`,
            attachments: source.map(
              ({ file, name, size, type }): BlobAttachment => ({
                id: String(file) as AttachmentID,
                mimeType: type,
                creator: account.primarySocialId,
                created: message.created,
                params: { blobId: file, fileName: name, size }
              })
            )
          },
          card
        )
      }

      expect(statusListener).not.toHaveBeenCalled()
      const { sourceAttachments, description }: MessageIssueData = jest.mocked(showPopup).mock.calls[0][1].initialData
      expect(sourceAttachments.map(({ attachment }) => attachment.file)).toEqual(source.map(({ file }) => file))

      const progress = jest.fn()
      const selected = getCopyableMessageAttachments(sourceAttachments)
      const saved = await copyMessageAttachments(sourceAttachments, selected, description, progress)
      expect(saved.sizeOmissions.map(({ attachment }) => attachment.file)).toEqual(oversized)
      const keepsFile = source.includes(file) && !oversized.includes(file.file)
      expect(saved.attachments).toHaveLength(keepsFile ? 1 : 0)
      const nodes = markupToJSON(saved.description).content?.[0].content ?? []
      const text = nodes.flatMap(({ text }) => text ?? []).join('')
      expect(text.replace(/ +/g, ' ')).toBe('Before after')
      const inline = nodes.filter(({ type }) => type === 'image')
      expect(inline.map(({ attrs }) => attrs?.['file-id'])).toEqual(saved.attachments.map(({ file }) => file))
      expect(fetchFile.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('file'))).toEqual(
        selected.map(({ file }) => file)
      )
      expect(upload).toHaveBeenCalledTimes(keepsFile ? 1 : 0)
      if (keepsFile) {
        expect(saved.attachments[0].size).toBe(3)
        expect(progress.mock.calls).toEqual([
          [0, selected.length],
          [1, selected.length]
        ])
      }
      expect(statusListener.mock.calls).toEqual(
        oversized.length > 0
          ? [[PlatformEvent, new Status(Severity.WARNING, tracker.string.MessageAttachmentsTooLarge, { limit: 25 })]]
          : []
      )
    })
  })

  it('hides the actions for guests and non-text activity events', async () => {
    expect(await canCreateIssueFromMessage(undefined)).toBe(false)
    expect(await canCreateIssueFromMessage([legacyMessage])).toBe(false)
    setCurrentAccount({ ...account, role: AccountRole.Guest })
    expect(await canCreateIssueFromMessage(legacyMessage)).toBe(false)
    expect(canCreateIssueFromCommunicationMessage(message)).toBe(false)
    await createIssueFromMessage(legacyMessage)
    await createIssueFromCommunicationMessage(message, card)
    expect(showPopup).not.toHaveBeenCalled()

    setCurrentAccount(account)
    jest.spyOn(hierarchy, 'isDerived').mockReturnValue(false)
    expect(await canCreateIssueFromMessage(legacyMessage)).toBe(false)
    expect(canCreateIssueFromCommunicationMessage({ ...message, type: MessageType.Activity })).toBe(false)
  })

  it.each(['https://attacker.example/file', '//attacker.example/file', '../file', 'blob/id', 'blob id', 'blob\n'])(
    'classifies invalid blob IDs in both actions: %j',
    async (blobId) => {
      const file = { name: 'file.txt', file: 'valid-blob', type: 'text/plain', size: 10, lastModified: 0 }
      findAll.mockResolvedValue([file, { ...file, file: blobId }])

      await createIssueFromMessage(legacyMessage)
      expect(jest.mocked(showPopup).mock.calls[0][1]).toMatchObject({
        initialData: {
          sourceAttachments: [{ attachment: file }, { attachment: { file: blobId }, omission: 'invalid-id' }]
        }
      })

      const attachment = {
        id: 'attachment-id',
        mimeType: file.type,
        created: message.created,
        params: { blobId, fileName: file.name, size: file.size }
      }
      await createIssueFromCommunicationMessage(
        { ...message, attachments: [attachment] as Message['attachments'] },
        card
      )
      expect(jest.mocked(showPopup).mock.calls[1][1]).toMatchObject({
        initialData: { sourceAttachments: [{ attachment: { file: blobId }, omission: 'invalid-id' }] }
      })
      expect(statusListener).not.toHaveBeenCalled()
    }
  )

  it('reports a failed attachment lookup without opening a partial dialog', async () => {
    findAll.mockRejectedValue(new Error('Attachment lookup failed'))
    await createIssueFromMessage(legacyMessage)
    expect(statusListener).toHaveBeenCalledTimes(1)
    expect(showPopup).not.toHaveBeenCalled()
  })
})
