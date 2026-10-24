// SPDX-License-Identifier: EPL-2.0

import { type Editor, type NodeViewRendererProps } from '@tiptap/core'
import { type NodeType } from '@tiptap/pm/model'

import { ImageExtension } from './imageExt'

const platformSrc = 'platform://platform/files/workspace/?file=copied-image'

jest.mock('@hcengineering/presentation', () => ({
  FilePreviewPopup: {},
  getFileUrl: jest.fn(),
  getBlobRef: jest.fn(async (file: string) => ({ src: `https://storage.example/${file}`, srcset: '' })),
  getPlatformFileId: jest.fn((src: string) => (src === platformSrc ? 'copied-image' : undefined))
}))
jest.mock('@hcengineering/text-editor', () => ({}))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('./toolbar/toolbar', () => ({
  registerToolbarProvider: jest.fn(),
  setLoadingState: jest.fn()
}))

describe('image node view', () => {
  const getBlobRef = jest.fn(async (file: string) => ({ src: `https://storage.example/${file}`, srcset: '' }))
  const originalDocument = globalThis.document
  const image = { src: '', srcset: '', setAttribute: jest.fn(), decode: async () => {} }
  const container = { append: jest.fn(), setAttribute: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    image.src = ''
    image.srcset = ''
    globalThis.document = {
      createElement: (tag: string) => (tag === 'img' ? image : container)
    } as unknown as Document
  })

  afterEach(() => {
    globalThis.document = originalDocument
  })

  async function renderImage (attributes: Record<string, string>): Promise<void> {
    const extension = ImageExtension.configure({ getBlobRef })
    const addNodeView = extension.config.addNodeView
    if (addNodeView == null) throw new Error('Image extension must provide a node view')

    const render = addNodeView.call({
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
      editor: {} as unknown as Editor,
      type: {} as unknown as NodeType,
      parent: undefined
    })
    if (render === null) throw new Error('Image node view renderer must be defined')

    render({
      node: { attrs: attributes },
      HTMLAttributes: attributes,
      view: {},
      getPos: () => 0
    } as unknown as NodeViewRendererProps)
    await Promise.resolve()
  }

  it('resolves a copied src-only platform image through the workspace storage', async () => {
    await renderImage({ src: platformSrc })

    expect(getBlobRef).toHaveBeenCalledWith('copied-image')
    expect(image.src).toBe('https://storage.example/copied-image')
  })

  it('prefers the file-id over src', async () => {
    await renderImage({ 'file-id': 'attached-image', src: platformSrc })

    expect(getBlobRef).toHaveBeenCalledWith('attached-image')
    expect(image.src).toBe('https://storage.example/attached-image')
  })

  it.each(['https://images.example/image.png', 'data:image/png;base64,AAAA', '/images/image.png'])(
    'keeps a src-only image URL %s',
    async (src) => {
      await renderImage({ src })

      expect(getBlobRef).not.toHaveBeenCalled()
      expect(image.src).toBe(src)
    }
  )
})
