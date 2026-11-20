/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { type Blob as PlatformBlob, type Ref } from '@hcengineering/core'
import { setPlatformStatus } from '@hcengineering/platform'
import { type Editor } from '@tiptap/core'
import { Schema, Slice } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { ImageUploadExtension } from '../imageUpload'
import { type FileAttachFunction } from '../../types'

jest.mock('@hcengineering/presentation', () =>
  jest.requireActual('../../../../../../../packages/presentation/src/image')
)
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  setPlatformStatus: jest.fn()
}))

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    image: {
      inline: true,
      group: 'inline',
      attrs: Object.fromEntries(
        ['file-id', 'data-file-type', 'src', 'alt', 'title', 'width'].map((key) => [key, { default: null }])
      ),
      toDOM: (node) => ['img', node.attrs]
    }
  }
})

async function settle (): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

function createView (attachFile: FileAttachFunction): EditorView {
  const MockEditor = jest.fn<Editor, []>()
  const extension = ImageUploadExtension.configure({
    attachFile,
    getFileUrl: (file) => `https://storage.example/${file}`
  })
  const addPlugins = extension.config.addProseMirrorPlugins
  if (addPlugins === undefined) throw new Error('Missing image upload plugins')
  const plugins = addPlugins.call({
    name: extension.name,
    options: extension.options,
    storage: extension.storage,
    editor: new MockEditor(),
    parent: undefined
  })
  return new EditorView(document.createElement('div'), { state: EditorState.create({ schema, plugins }) })
}

describe('production image upload paste hooks', () => {
  let view: EditorView
  let attachFile: jest.MockedFunction<FileAttachFunction>

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    URL.createObjectURL = jest.fn(() => 'blob:clipboard')
    URL.revokeObjectURL = jest.fn()
    jest.spyOn(global, 'Image').mockImplementation(() => {
      const image = document.createElement('img')
      jest.spyOn(image, 'src', 'set').mockImplementation((src) => {
        image.setAttribute('src', src)
        queueMicrotask(() => image.dispatchEvent(new Event('error')))
      })
      return image
    })
    attachFile = jest.fn(async (_file: File) => ({ file: 'blob-id' as Ref<PlatformBlob>, type: 'image/webp' }))
    view = createView(attachFile)
  })

  afterEach(() => {
    view.destroy()
    jest.restoreAllMocks()
  })

  it('inserts a pasted file after upload when sizing rejects with a browser event', async () => {
    const file = new File(['clipboard'], 'image.webp', { type: 'image/webp' })
    const event = {
      clipboardData: { getData: () => '', files: { length: 1, item: () => file } },
      preventDefault: jest.fn(),
      stopPropagation: jest.fn()
    } as unknown as ClipboardEvent
    view.someProp('handlePaste', (handle) => handle(view, event, Slice.empty))
    await settle()
    expect(attachFile).toHaveBeenCalledWith(file)
    const image = view.state.doc.firstChild?.firstChild
    expect(image?.type.name).toBe('image')
    expect(image?.attrs['file-id']).toBe('blob-id')
    expect(setPlatformStatus).not.toHaveBeenCalled()
  })

  it('replaces a pasted HTML data-image placeholder even when sizing fails', async () => {
    const blob = new Blob(['clipboard'], { type: 'image/webp' })
    const originalFetch = global.fetch
    global.fetch = jest.fn(async () => ({ blob: async () => blob })) as unknown as typeof fetch
    try {
      let html = ''
      view.someProp('transformPastedHTML', (transform) => {
        html = transform('<p><img src="data:image/webp;base64,YQ==" alt="pasted.webp"></p>', view)
      })
      const wrapper = new DOMParser().parseFromString(html, 'text/html')
      view.dispatch(view.state.tr.insertText(wrapper.body.textContent ?? '', 1))
      await settle()
      expect(attachFile).toHaveBeenCalledTimes(1)
      const image = view.state.doc.firstChild?.firstChild
      expect(image?.type.name).toBe('image')
      expect(image?.attrs['file-id']).toBe('blob-id')
      expect(view.state.doc.textContent).not.toContain('[Uploading image')
      expect(setPlatformStatus).not.toHaveBeenCalled()
    } finally {
      global.fetch = originalFetch
    }
  })

  it('handles an attachment rejection inside the asynchronous paste error boundary', async () => {
    attachFile.mockRejectedValueOnce(new Error('Upload refused'))
    const file = new File(['clipboard'], 'image.webp', { type: 'image/webp' })
    const event = {
      clipboardData: { getData: () => '', files: { length: 1, item: () => file } },
      preventDefault: jest.fn(),
      stopPropagation: jest.fn()
    } as unknown as ClipboardEvent
    view.someProp('handlePaste', (handle) => handle(view, event, Slice.empty))
    await settle()
    expect(setPlatformStatus).toHaveBeenCalledTimes(1)
    expect(view.state.doc.firstChild?.childCount).toBe(0)
  })
})
