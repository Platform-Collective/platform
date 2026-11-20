/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import type { Attachment } from '@hcengineering/attachment'
import type { Doc, Ref, WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import { EmptyMarkup } from '@hcengineering/text'
import { type SvelteComponent, tick } from 'svelte'
import { get, type writable } from 'svelte/store'

interface PresentedMessage {
  _id: Ref<Doc>
  message: string
  attachments: number
  $lookup?: { attachments: Attachment[] }
}

// The template and attachment tiles are leaves; keep the presenter, recursive markup viewer,
// translation stores and AttachmentDocList filtering/query logic in production code.
// Virtual mocks cover leaf packages owned by chunter, outside this test package's dependencies.
const { default: ChatMessagePresenter } = jest.requireActual<{
  default: typeof SvelteComponent<{ value: PresentedMessage, withShowMore: boolean }>
}>('../../../chunter-resources/src/components/chat-message/ChatMessagePresenter.svelte')
const { shownTranslatedMessagesStore, translatedMessagesStore } = jest.requireActual<{
  shownTranslatedMessagesStore: ReturnType<typeof writable<Set<Ref<Doc>>>>
  translatedMessagesStore: ReturnType<typeof writable<Map<Ref<Doc>, string>>>
}>('../../../chunter-resources/src/stores')

jest.mock(
  '@hcengineering/activity-resources',
  () => ({
    ActivityMessageTemplate: jest.requireActual('./MessageTemplateStub.svelte').default,
    editingMessageStore: jest.requireActual('svelte/store').writable(undefined)
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/attachment-resources',
  () => ({
    AttachmentDocList: jest.requireActual('../components/AttachmentDocList.svelte').default
  }),
  { virtual: true }
)
jest.mock('@hcengineering/contact-resources', () => ({}), { virtual: true })
jest.mock('@hcengineering/view-resources', () => ({}))
jest.mock('@hcengineering/ui', () => ({
  ShowMore: jest.requireActual('./MessageTemplateStub.svelte').default,
  languageStore: jest.requireActual('svelte/store').writable('en')
}))
jest.mock('../../../chunter-resources/src/components/chat-message/ChatMessageHeader.svelte', () =>
  jest.requireActual('./MessageTemplateStub.svelte')
)
jest.mock('../../../chunter-resources/src/components/chat-message/ChatMessageInput.svelte', () =>
  jest.requireActual('./MessageTemplateStub.svelte')
)
jest.mock('../components/AttachmentGroup.svelte', () => jest.requireActual('./AttachmentGroupStub.svelte'))
jest.mock('../stores', () => ({
  savedAttachmentsStore: jest.requireActual('svelte/store').writable([]),
  loadSavedAttachments: () => {}
}))
jest.mock(
  '@hcengineering/emoji',
  () => ({
    getParseEmojisFunction: () => undefined,
    loadParseEmojisFunction: async () => undefined
  }),
  { virtual: true }
)
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: jest.requireActual('../../../../packages/presentation/src/plugin').default,
  MessageViewer: jest.requireActual('../../../../packages/presentation/src/components/MessageViewer.svelte').default,
  pendingCreatedDocs: jest.requireActual('svelte/store').writable({}),
  getClient: () => ({
    getHierarchy: () => ({ isDerived: () => false }),
    getModel: () => ({ findAllSync: () => [] }),
    findOne: async () => undefined
  }),
  createQuery: () => ({
    query: (_class: unknown, _query: unknown, callback: (attachments: Attachment[]) => void) => {
      callback(jest.requireActual('./inline-image-fixture').queriedAttachments)
    }
  })
}))

const { queriedAttachments } = jest.requireActual<{ queriedAttachments: Attachment[] }>('./inline-image-fixture')
const inline: Attachment = {
  _id: 'attachment',
  file: 'image',
  name: 'image.webp',
  metadata: { inlineImage: true }
} as unknown as Attachment
const ordinary: Attachment = { _id: 'document', file: 'document', name: 'document.txt' } as unknown as Attachment
const original = JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { 'file-id': inline.file } }] })

describe.each([false, true])('rendered chat attachment visibility (withShowMore=%s)', (withShowMore) => {
  let target: HTMLDivElement
  let presenter: InstanceType<typeof ChatMessagePresenter>
  const id = 'message' as Ref<Doc>

  beforeEach(() => {
    target = document.createElement('div')
    document.body.append(target)
    queriedAttachments.splice(0, queriedAttachments.length, inline)
    setMetadata(presentation.metadata.WorkspaceUuid, 'workspace' as WorkspaceUuid)
    setMetadata(presentation.metadata.FileStorage, {
      getFileUrl: () => 'https://storage.example/image.webp',
      getCookiePath: jest.fn(),
      getFileMeta: jest.fn(),
      uploadFile: jest.fn(),
      deleteFile: jest.fn()
    })
  })

  afterEach(() => {
    presenter?.$destroy()
    target.remove()
    shownTranslatedMessagesStore.set(new Set())
    translatedMessagesStore.set(new Map())
    setMetadata(presentation.metadata.FileStorage, undefined)
    setMetadata(presentation.metadata.WorkspaceUuid, undefined)
  })

  async function mount (lookup?: Attachment[]): Promise<void> {
    const value: PresentedMessage = {
      _id: id,
      message: original,
      attachments: queriedAttachments.length,
      $lookup: lookup === undefined ? undefined : { attachments: lookup }
    }
    presenter = new ChatMessagePresenter({ target, props: { withShowMore, value } })
    await tick()
  }

  it.each([false, true])('has no spacer when every attachment is inline (lookup=%s)', async (lookup) => {
    await mount(lookup ? [inline] : undefined)
    expect(target.querySelector('img')).not.toBeNull()
    expect(target.querySelector('[data-attachment]')).toBeNull()
    expect(target.querySelector('.mt-2')).toBeNull()
  })

  it('shows the tile and spacer when translation removes the inline image, and hides them on Show Original', async () => {
    await mount([inline])
    translatedMessagesStore.set(new Map([[id, EmptyMarkup]]))
    shownTranslatedMessagesStore.set(new Set([id]))
    await tick()
    expect(target.querySelector('img')).toBeNull()
    expect(target.querySelector('[data-attachment="image"]')).not.toBeNull()
    expect(target.querySelectorAll('.mt-2')).toHaveLength(1)

    shownTranslatedMessagesStore.set(new Set())
    await tick()
    expect(target.querySelector('img')).not.toBeNull()
    expect(target.querySelector('[data-attachment]')).toBeNull()
    expect(target.querySelector('.mt-2')).toBeNull()
    expect(get(translatedMessagesStore).has(id)).toBe(true)
  })

  it('keeps one spacer and the ordinary tile in a mixed message', async () => {
    queriedAttachments.push(ordinary)
    await mount([inline, ordinary])
    expect(target.querySelectorAll('[data-attachment]')).toHaveLength(1)
    expect(target.querySelector('[data-attachment="document"]')).not.toBeNull()
    expect(target.querySelectorAll('.mt-2')).toHaveLength(1)
  })
})
