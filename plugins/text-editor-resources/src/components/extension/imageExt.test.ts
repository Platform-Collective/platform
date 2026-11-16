// SPDX-License-Identifier: EPL-2.0

import { type Editor, type NodeViewRendererProps } from '@tiptap/core'
import { type NodeType } from '@tiptap/pm/model'

import { ImageExtension } from './imageExt'
import { setLoadingState } from './toolbar/toolbar'

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

  const imageType = {} as unknown as NodeType
  const otherType = {} as unknown as NodeType

  interface RenderedImage {
    view: unknown
    destroy: () => void
  }

  /** Let queued microtasks and promise callbacks (blob lookup, decode) run. */
  async function flushPromises (): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  function renderImage (
    attributes: Record<string, string>,
    options: { nodeAtType?: NodeType, docSize?: number } = {}
  ): RenderedImage {
    const extension = ImageExtension.configure({ getBlobRef })
    const addNodeView = extension.config.addNodeView
    if (addNodeView == null) throw new Error('Image extension must provide a node view')

    const render = addNodeView.call({
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
      editor: {} as unknown as Editor,
      type: imageType,
      parent: undefined
    })
    if (render === null) throw new Error('Image node view renderer must be defined')

    const node = { attrs: attributes, type: imageType }
    const view = {
      isDestroyed: false,
      state: {
        doc: {
          content: { size: options.docSize ?? 1 },
          nodeAt: () => ({ type: options.nodeAtType ?? imageType })
        }
      }
    }
    const nodeView = render({
      node,
      HTMLAttributes: attributes,
      view,
      getPos: () => 0
    } as unknown as NodeViewRendererProps) as { destroy?: () => void }

    return { view, destroy: () => nodeView.destroy?.() }
  }

  it('resolves a copied src-only platform image through the workspace storage', async () => {
    renderImage({ src: platformSrc })
    await flushPromises()

    expect(getBlobRef).toHaveBeenCalledWith('copied-image')
    expect(image.src).toBe('https://storage.example/copied-image')
  })

  it('prefers the file-id over src', async () => {
    renderImage({ 'file-id': 'attached-image', src: platformSrc })
    await flushPromises()

    expect(getBlobRef).toHaveBeenCalledWith('attached-image')
    expect(image.src).toBe('https://storage.example/attached-image')
  })

  it.each(['https://images.example/image.png', 'data:image/png;base64,AAAA', '/images/image.png'])(
    'keeps a src-only image URL %s',
    async (src) => {
      renderImage({ src })
      await flushPromises()

      expect(getBlobRef).not.toHaveBeenCalled()
      expect(image.src).toBe(src)
    }
  )

  it('sets and clears the loading state for the current node position', async () => {
    const { view } = renderImage({ 'file-id': 'attached-image' })
    expect(setLoadingState).not.toHaveBeenCalled()

    await flushPromises()

    expect(setLoadingState).toHaveBeenNthCalledWith(1, view, 0, true)
    expect(setLoadingState).toHaveBeenLastCalledWith(view, 0, false)
  })

  it('does not touch the loading state when another node is at the position', async () => {
    renderImage({ 'file-id': 'attached-image' }, { nodeAtType: otherType })
    await flushPromises()

    expect(setLoadingState).not.toHaveBeenCalled()
  })

  it('does not touch the loading state for a position outside the document', async () => {
    renderImage({ 'file-id': 'attached-image' }, { docSize: 0 })
    await flushPromises()

    expect(setLoadingState).not.toHaveBeenCalled()
  })

  it('ignores pending callbacks after the node view is destroyed', async () => {
    const rendered = renderImage({ 'file-id': 'attached-image' })
    rendered.destroy()
    await flushPromises()

    expect(setLoadingState).not.toHaveBeenCalled()
    expect(image.src).toBe('')
  })

  it('clears the loading state when the blob lookup fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    let rendered: RenderedImage | undefined
    try {
      getBlobRef.mockRejectedValueOnce(new Error('not found'))
      rendered = renderImage({ 'file-id': 'missing-image' })
      await flushPromises()

      expect(setLoadingState).toHaveBeenNthCalledWith(1, rendered.view, 0, true)
      expect(setLoadingState).toHaveBeenLastCalledWith(rendered.view, 0, false)
      expect(consoleError).toHaveBeenCalled()
    } finally {
      rendered?.destroy()
      consoleError.mockRestore()
    }
  })

  it('clears the placeholder timer when the node view is destroyed', () => {
    jest.useFakeTimers()
    try {
      getBlobRef.mockReturnValueOnce(new Promise<{ src: string, srcset: string }>(() => {}))
      const rendered = renderImage({ 'file-id': 'slow-image' })
      jest.runAllTicks()
      expect(jest.getTimerCount()).toBe(1)

      rendered.destroy()
      expect(jest.getTimerCount()).toBe(0)
      jest.advanceTimersByTime(500)
      expect(image.src).toBe('')
    } finally {
      jest.useRealTimers()
    }
  })
})
