// SPDX-License-Identifier: EPL-2.0

import { type Editor, type NodeViewRendererProps } from '@tiptap/core'
import { type NodeType } from '@tiptap/pm/model'

import { setLoadingState } from '../toolbar/toolbar'
import { EmbedNode, type EmbedNodeView } from './embed'

jest.mock('@hcengineering/platform', () => ({ getMetadata: jest.fn(), translate: jest.fn(async () => '') }))
jest.mock('@hcengineering/presentation', () => ({ copyTextToClipboard: jest.fn() }))
jest.mock('@hcengineering/text', () => {
  const { Node } = jest.requireActual('@tiptap/core')
  return { EmbedNode: Node.create({ name: 'embed', group: 'block', atom: true }) }
})
jest.mock('@hcengineering/text-editor', () => ({ __esModule: true, default: { string: {}, icon: {} } }))
jest.mock('../reference', () => ({ buildReferenceUrl: jest.fn(), parseReferenceUrl: jest.fn() }))
jest.mock('../toolbar/toolbar', () => ({
  CursorSource: {},
  getToolbarControlPluginState: jest.fn(),
  getToolbarCursor: jest.fn(),
  registerToolbarProvider: jest.fn(),
  setLoadingState: jest.fn(),
  updateCursor: jest.fn()
}))
jest.mock('./EmbedToolbarHead.svelte', () => ({}))

describe('embed node view', () => {
  const originalDocument = globalThis.document
  const root = { setAttribute: jest.fn(), classList: { add: jest.fn() } }
  const handleDestroy = jest.fn()
  const embedView = jest.fn((): ReturnType<EmbedNodeView> => ({ name: 'test', destroy: handleDestroy }))
  const buildView = jest.fn(async (): Promise<EmbedNodeView | undefined> => embedView)

  beforeEach(() => {
    jest.clearAllMocks()
    globalThis.document = { createElement: () => root } as unknown as Document
  })

  afterEach(() => {
    globalThis.document = originalDocument
  })

  const embedType = {} as unknown as NodeType
  const otherType = {} as unknown as NodeType

  /** Let queued microtasks and promise callbacks (provider lookup) run. */
  async function flushPromises (): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  function renderEmbed (options: { nodeAtType?: NodeType } = {}): { view: unknown, destroy: () => void } {
    const extension = EmbedNode.configure({ providers: [{ buildView }] })
    const addNodeView = extension.config.addNodeView
    if (addNodeView == null) throw new Error('Embed extension must provide a node view')

    const render = addNodeView.call({
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
      editor: {} as unknown as Editor,
      type: embedType,
      parent: undefined
    })
    if (render === null) throw new Error('Embed node view renderer must be defined')

    const view = {
      isDestroyed: false,
      state: {
        doc: {
          content: { size: 1 },
          nodeAt: () => ({ type: options.nodeAtType ?? embedType })
        }
      }
    }
    const nodeView = render({
      node: { attrs: { src: 'https://example.com/embed' }, type: embedType },
      HTMLAttributes: {},
      editor: { view } as unknown as Editor,
      getPos: () => 0
    } as unknown as NodeViewRendererProps) as { destroy?: () => void }

    return { view, destroy: () => nodeView.destroy?.() }
  }

  it('defers the loading state until the node view is created', async () => {
    const { view } = renderEmbed()
    expect(setLoadingState).not.toHaveBeenCalled()

    await flushPromises()

    expect(embedView).toHaveBeenCalledTimes(1)
    expect(setLoadingState).toHaveBeenNthCalledWith(1, view, 0, true)
    expect(setLoadingState).toHaveBeenLastCalledWith(view, 0, false)
  })

  it('does not touch the loading state when another node is at the position', async () => {
    renderEmbed({ nodeAtType: otherType })
    await flushPromises()

    expect(embedView).toHaveBeenCalledTimes(1)
    expect(setLoadingState).not.toHaveBeenCalled()
  })

  it('ignores the provider result after the node view is destroyed', async () => {
    const rendered = renderEmbed()
    rendered.destroy()
    await flushPromises()

    expect(embedView).not.toHaveBeenCalled()
    expect(setLoadingState).not.toHaveBeenCalled()
  })

  it('clears the loading state when the provider fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      buildView.mockRejectedValueOnce(new Error('provider failed'))
      const { view } = renderEmbed()
      await flushPromises()

      expect(setLoadingState).toHaveBeenNthCalledWith(1, view, 0, true)
      expect(setLoadingState).toHaveBeenLastCalledWith(view, 0, false)
      expect(consoleError).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})
