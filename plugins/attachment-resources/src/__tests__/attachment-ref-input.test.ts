/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { type Class, type Doc, type Ref, type Space, type WorkspaceUuid } from '@hcengineering/core'
import { EmptyMarkup } from '@hcengineering/text'
import { setMetadata } from '@hcengineering/platform'
import presentation, { type getFileStorage, setUploadGuard } from '@hcengineering/presentation'
import { tick } from 'svelte'
import AttachmentRefInput from '../components/AttachmentRefInput.svelte'
import { inserted } from './inline-image-fixture'

// Share the real Svelte runtime between the composer, nested editor and test listeners.
jest.mock('svelte', () => jest.requireActual('svelte'))
jest.mock('@hcengineering/text', () => ({
  ...jest.requireActual('@hcengineering/text'),
  ...jest.requireActual('../../../../foundations/core/packages/text/src/kit')
}))
jest.mock('../../../../packages/presentation/src/filetypes', () => ({ getFileMetadata: async () => ({}) }))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: jest.requireActual('../../../../packages/presentation/src/plugin').default,
  ...jest.requireActual('../../../../packages/presentation/src/file'),
  ...jest.requireActual('../../../../packages/presentation/src/image'),
  DraftController: class {
    save (): void {}
    remove (): void {}
  },
  draftsStore: jest.requireActual('svelte/store').writable({}),
  getClient: () => ({ addCollection: jest.fn(async () => {}) }),
  createQuery: () => ({ query: jest.fn(), unsubscribe: jest.fn() }),
  isLinkPreviewEnabled: () => false
}))
jest.mock('@hcengineering/text-editor-resources', () => ({
  ReferenceInput: jest.requireActual('../../../text-editor-resources/src/components/ReferenceInput.svelte').default
}))
jest.mock('../../../text-editor-resources/src/components/TextEditor.svelte', () =>
  jest.requireActual('./ComposerEditorStub.svelte')
)
jest.mock('../../../text-editor-resources/src/components/editor/actions', () => ({
  defaultRefActions: [],
  getModelRefActions: async () => []
}))
jest.mock('@hcengineering/ui', () => ({
  Loading: jest.requireActual('../../../../packages/presentation/src/__tests__/EmptyNode.svelte').default,
  Button: jest.requireActual('./ComposerButtonStub.svelte').default,
  deviceOptionsStore: jest.requireActual('svelte/store').writable({ size: 'large' }),
  checkAdaptiveMatching: () => false,
  registerFocus: () => ({ idx: 0 }),
  handler: (value: unknown, callback: (value: unknown, event: Event) => void) => (event: Event) => {
    callback(value, event)
  }
}))
jest.mock('@hcengineering/uploader', () => ({ getUploadHandlers: () => [] }))
jest.mock('../components/AttachmentPresenter.svelte', () =>
  jest.requireActual('../../../../packages/presentation/src/__tests__/EmptyNode.svelte')
)

async function settle (): Promise<void> {
  for (let i = 0; i < 40; i++) await tick()
}

describe('comment composer file handling', () => {
  const revokeObjectURL = jest.fn()
  const uploadFile = jest.fn<Promise<void>, Parameters<ReturnType<typeof getFileStorage>['uploadFile']>>(async () => {})
  const storage: ReturnType<typeof getFileStorage> = {
    getFileUrl: jest.fn(),
    getCookiePath: jest.fn(),
    getFileMeta: jest.fn(),
    uploadFile,
    deleteFile: jest.fn(async () => {})
  }
  let target: HTMLDivElement
  let composer: AttachmentRefInput

  beforeEach(() => {
    jest.clearAllMocks()
    uploadFile.mockImplementation(async () => {})
    inserted.length = 0
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'trace').mockImplementation(() => {})
    setMetadata(presentation.metadata.WorkspaceUuid, 'workspace' as WorkspaceUuid)
    setMetadata(presentation.metadata.FileStorage, storage)
    URL.createObjectURL = jest.fn(() => 'blob:clipboard')
    URL.revokeObjectURL = revokeObjectURL
    // Model a browser decode/CSP error, including the non-Error event the browser supplies.
    jest.spyOn(globalThis, 'Image').mockImplementation(() => {
      const image = document.createElement('img')
      jest.spyOn(image, 'src', 'set').mockImplementation((src) => {
        image.setAttribute('src', src)
        queueMicrotask(() => image.dispatchEvent(new Event('error')))
      })
      return image
    })
    target = document.createElement('div')
    document.body.append(target)
    composer = new AttachmentRefInput({
      target,
      props: {
        objectId: 'issue' as Ref<Doc>,
        space: 'space' as Ref<Space>,
        _class: 'issue-class' as Ref<Class<Doc>>,
        inlineImages: true,
        skipAttachmentsPreload: true,
        showActions: false
      }
    })
  })

  afterEach(async () => {
    composer.$destroy()
    await settle()
    target.remove()
    jest.restoreAllMocks()
    setUploadGuard(undefined)
    setMetadata(presentation.metadata.WorkspaceUuid, undefined)
    setMetadata(presentation.metadata.FileStorage, undefined)
  })

  function paste (files: File[]): void {
    const event = new Event('paste', { bubbles: true })
    Object.defineProperty(event, 'clipboardData', { value: { files } })
    target.querySelector('textarea')?.dispatchEvent(event)
  }

  function sendButton (): HTMLButtonElement {
    const button = target.querySelector('button')
    if (button === null) throw new Error('Missing send button')
    return button
  }

  it('disables send and Enter and empties the draft after removing the only inline image', async () => {
    const message = jest.fn()
    composer.$on('message', message)
    paste([new File(['image'], 'image.webp', { type: 'image/webp' })])
    await settle()
    expect(composer.isEmptyDraft()).toBe(false)
    expect(sendButton().disabled).toBe(false)

    const editor = target.querySelector('textarea')
    if (editor === null) throw new Error('Missing editor')
    editor.value = EmptyMarkup
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()

    expect({ disabled: sendButton().disabled, emptyDraft: composer.isEmptyDraft() }).toEqual({
      disabled: true,
      emptyDraft: true
    })
    sendButton().click()
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(message).not.toHaveBeenCalled()
  })

  it('sends remaining text with Enter and cleans up the removed inline record', async () => {
    const message = jest.fn()
    composer.$on('message', message)
    paste([new File(['image'], 'image.webp', { type: 'image/webp' })])
    await settle()
    const editor = target.querySelector('textarea')
    if (editor === null) throw new Error('Missing editor')
    const text = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]
    })
    editor.value = text
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(sendButton().disabled).toBe(false)
    expect(composer.isEmptyDraft()).toBe(false)
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(message.mock.calls[0]?.[0].detail).toEqual({ message: text, attachments: 0 })
    expect(storage.deleteFile).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('uploads ordinary files ten at a time (inlineImages=%s)', async (inlineImages) => {
    composer.$set({ inlineImages })
    await settle()
    const releases: Array<() => void> = []
    uploadFile.mockImplementation(async () => {
      await new Promise<void>((resolve) => releases.push(resolve))
    })
    paste(Array.from({ length: 12 }, (_, i) => new File(['file'], `${i}.txt`, { type: 'text/plain' })))
    await settle()
    expect(uploadFile).toHaveBeenCalledTimes(10)
    expect(sendButton().disabled).toBe(true)
    releases.splice(0).forEach((release) => {
      release()
    })
    await settle()
    expect(uploadFile).toHaveBeenCalledTimes(12)
    releases.splice(0).forEach((release) => {
      release()
    })
    await settle()
    expect(sendButton().disabled).toBe(false)
    expect(composer.isEmptyDraft()).toBe(false)
  })

  it('uploads images concurrently and inserts them in selection order despite reversed completion', async () => {
    const releases: Array<() => void> = []
    uploadFile.mockImplementation(async () => {
      await new Promise<void>((resolve) => releases.push(resolve))
    })
    const files = ['first', 'second', 'third'].map(
      (name) => new File(['image'], `${name}.webp`, { type: 'image/webp' })
    )
    const input = target.querySelector('input')
    if (input === null) throw new Error('Missing file input')
    Object.defineProperty(input, 'files', { value: files })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(uploadFile).toHaveBeenCalledTimes(3)
    releases[2]()
    releases[1]()
    await settle()
    expect(inserted).toEqual([])
    releases[0]()
    await settle()
    expect(inserted.map((markup) => JSON.parse(markup).attrs.alt)).toEqual(files.map((file) => file.name))
    expect(sendButton().disabled).toBe(false)
  })

  it.each([false, true])('lets descendant drop handlers run only without inlineImages (%s)', async (inlineImages) => {
    composer.$set({ inlineImages })
    await settle()
    const editor = target.querySelector('textarea')
    if (editor === null) throw new Error('Missing editor')
    const descendant = jest.fn((event: Event) => {
      event.stopPropagation()
    })
    editor.addEventListener('drop', descendant)
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [new File(['image'], 'image.webp', { type: 'image/webp' })] }
    })
    editor.dispatchEvent(event)
    await settle()
    expect(descendant).toHaveBeenCalledTimes(inlineImages ? 0 : 1)
    expect(uploadFile).toHaveBeenCalledTimes(inlineImages ? 1 : 0)
    expect(inserted).toHaveLength(inlineImages ? 1 : 0)
  })

  it.each([false, true])('uploads header drops exactly once (inlineImages=%s)', async (inlineImages) => {
    composer.$set({ inlineImages })
    await settle()
    paste([new File(['file'], 'document.txt', { type: 'text/plain' })])
    await settle()
    uploadFile.mockClear()
    const header = target.querySelector('.header')
    if (header === null) throw new Error('Missing attachment header')
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [new File(['image'], 'image.webp', { type: 'image/webp' })] }
    })
    header.dispatchEvent(event)
    await settle()
    expect(event.defaultPrevented).toBe(true)
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(inserted).toHaveLength(inlineImages ? 1 : 0)
  })

  it('does not intercept a text drop before the editor', async () => {
    const editor = target.querySelector('textarea')
    if (editor === null) throw new Error('Missing editor')
    const descendant = jest.fn()
    editor.addEventListener('drop', descendant)
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files: [] } })
    editor.dispatchEvent(event)
    await settle()
    expect(descendant).toHaveBeenCalledTimes(1)
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('continues ordered image insertion after an upload fails', async () => {
    uploadFile.mockRejectedValueOnce(new Error('Upload refused'))
    paste(['first', 'second'].map((name) => new File(['image'], `${name}.webp`, { type: 'image/webp' })))
    await settle()
    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(inserted.map((markup) => JSON.parse(markup).attrs.alt)).toEqual(['second.webp'])
    expect(sendButton().disabled).toBe(false)
  })

  it('preserves record counters for inline images and ordinary attachments on update and send', async () => {
    const update = jest.fn()
    const message = jest.fn()
    composer.$on('update', update)
    composer.$on('message', message)
    paste([
      new File(['image'], 'image.webp', { type: 'image/webp' }),
      new File(['file'], 'file.txt', { type: 'text/plain' })
    ])
    await settle()
    expect(update.mock.calls.at(-1)?.[0].detail.attachments).toBe(2)
    expect(sendButton().disabled).toBe(false)
    sendButton().click()
    await settle()
    expect(message.mock.calls[0]?.[0].detail.attachments).toBe(2)
  })

  it.each(['image/webp', 'image/png'])(
    'uploads and inserts %s when clipboard dimensions cannot be decoded',
    async (type) => {
      const bytes = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='),
        (char) => char.charCodeAt(0)
      )
      const file = new File([bytes], 'image.png', { type })
      // jsdom File lacks arrayBuffer; browsers provide it. Keep real PNG chunk parsing.
      Object.defineProperty(file, 'arrayBuffer', {
        value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      })
      const event = new Event('paste', { bubbles: true })
      Object.defineProperty(event, 'clipboardData', { value: { files: [file] } })
      target.querySelector('textarea')?.dispatchEvent(event)
      await settle()

      expect(uploadFile).toHaveBeenCalledTimes(1)
      expect(inserted).toHaveLength(1)
      const node = JSON.parse(inserted[0])
      expect(node.type).toBe('image')
      expect(node.attrs['file-id']).toBe(uploadFile.mock.calls[0][2])
      expect(node.attrs.alt).toBe('image.png')
      expect(node.attrs.width).toBeUndefined()
      expect(target.querySelector('textarea')?.disabled).toBe(false)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:clipboard')
    }
  )
})
