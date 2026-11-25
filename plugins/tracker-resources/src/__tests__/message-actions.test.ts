// SPDX-License-Identifier: EPL-2.0

import type { MessageActionFunction } from '@hcengineering/communication'
import chunter, { type ChatMessage } from '@hcengineering/chunter'
import { getMessageLink } from '@hcengineering/chunter-resources'
import { MessageType, type Message } from '@hcengineering/communication-types'
import { AccountRole, setCurrentAccount, type Account, type AccountUuid, type PersonId } from '@hcengineering/core'
import { getMetadata, setPlatformStatus } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { getCurrentResolvedLocation, locationToUrl, showPopup } from '@hcengineering/ui'

import {
  canCreateIssueFromMessage,
  canCreateIssueFromCommunicationMessage,
  createIssueFromMessage,
  createIssueFromCommunicationMessage
} from '../message-actions'
import tracker from '../plugin'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getMetadata: jest.fn(),
  setPlatformStatus: jest.fn(),
  translate: async (key: string) => key
}))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: { metadata: { FrontUrl: 'frontUrl' } },
  getClient: jest.fn()
}))
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
  const isDerived = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    setCurrentAccount(account)
    jest.mocked(getMetadata).mockReturnValue('https://huly.example/')
    jest.mocked(getMessageLink).mockResolvedValue('https://huly.example/source-message')
    jest.mocked(getCurrentResolvedLocation).mockReturnValue({ path: ['workbench', 'workspace', 'tracker'] })
    jest.mocked(locationToUrl).mockReturnValue('/workbench/workspace/inbox/card-id?message=source')
    jest
      .mocked(getClient)
      .mockReturnValue({ findAll, getHierarchy: () => ({ isDerived }) } as unknown as ReturnType<typeof getClient>)
    findAll.mockResolvedValue([])
    isDerived.mockReturnValue(true)
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
          description: expect.stringContaining('https://huly.example/source-message')
        },
        initialAttachments: [file]
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
          description: expect.stringContaining('/inbox/')
        },
        initialAttachments: [
          {
            file: 'existing-blob',
            name: 'image.png',
            type: 'image/png',
            size: 123,
            metadata: { width: 800 },
            lastModified: message.created.getTime()
          }
        ]
      },
      'top'
    )
    expect(locationToUrl).toHaveBeenCalledWith({
      path: ['workbench', 'workspace', 'inbox', expect.stringContaining('card-id')],
      query: { message: encodeURIComponent(`${message.id}:${message.created.toISOString()}`) }
    })
    expect(findAll).not.toHaveBeenCalled()
  })

  it('passes declared sizes on to the dialog and removes oversized inline references from both message actions', async () => {
    const file = { name: 'file.txt', file: 'blob-id', type: 'text/plain', size: 10, lastModified: 0 }
    const oversized = { ...file, file: 'oversized-blob', size: 25 * 1024 * 1024 + 1 }
    findAll.mockResolvedValue([file, oversized])
    const inlineMessage = {
      ...legacyMessage,
      message: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Fix this' },
              { type: 'image', attrs: { 'file-id': oversized.file, src: 'old-url' } }
            ]
          }
        ]
      })
    }

    await createIssueFromMessage(inlineMessage)
    expect(jest.mocked(showPopup).mock.calls[0][1]).toMatchObject({
      initialAttachments: [file, oversized],
      initialData: { description: expect.not.stringContaining(oversized.file) }
    })

    const attachments = [file, oversized].map((source) => ({
      id: source.file,
      mimeType: source.type,
      created: message.created,
      params: { blobId: source.file, fileName: source.name, size: source.size }
    })) as Message['attachments']
    await createIssueFromCommunicationMessage(
      { ...message, content: 'Fix this\n\n![Oversized](image://oversized-blob?file=oversized-blob)', attachments },
      card
    )

    expect(jest.mocked(showPopup).mock.calls[1][1]).toMatchObject({
      initialAttachments: [
        { ...file, lastModified: message.created.getTime() },
        { ...oversized, lastModified: message.created.getTime() }
      ],
      initialData: { description: expect.not.stringContaining(oversized.file) }
    })
    expect(setPlatformStatus).not.toHaveBeenCalled()
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
    isDerived.mockReturnValue(false)
    expect(await canCreateIssueFromMessage(legacyMessage)).toBe(false)
    expect(canCreateIssueFromCommunicationMessage({ ...message, type: MessageType.Activity })).toBe(false)
  })

  it.each(['https://attacker.example/file', '//attacker.example/file', '../file', 'blob/id', 'blob id', 'blob\n'])(
    'drops invalid blob IDs from legacy and communication attachments: %j',
    async (blobId) => {
      const file = { name: 'file.txt', file: 'valid-blob', type: 'text/plain', size: 10, lastModified: 0 }
      findAll.mockResolvedValue([file, { ...file, file: blobId }])

      await createIssueFromMessage(legacyMessage)
      expect(jest.mocked(showPopup).mock.calls[0][1]).toMatchObject({ initialAttachments: [file] })

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
      expect(jest.mocked(showPopup).mock.calls[1][1]).toMatchObject({ initialAttachments: [] })
      expect(setPlatformStatus).not.toHaveBeenCalled()
    }
  )

  it('reports a failed attachment lookup without opening a partial dialog', async () => {
    findAll.mockRejectedValue(new Error('Attachment lookup failed'))
    await createIssueFromMessage(legacyMessage)
    expect(setPlatformStatus).toHaveBeenCalledTimes(1)
    expect(showPopup).not.toHaveBeenCalled()
  })
})
