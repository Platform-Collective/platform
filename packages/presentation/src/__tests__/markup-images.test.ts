// SPDX-License-Identifier: EPL-2.0

import { type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { type FileStorage } from '@hcengineering/storage-client'
import { type Attrs, jsonToMarkup, MarkupNodeType } from '@hcengineering/text'
import { tick } from 'svelte'
import { markdownToMarkup, markupToMarkdown } from '@hcengineering/text-markdown'
import { htmlToMarkup, markupToHtml } from '@hcengineering/text-html'

import MessageViewer from '../components/MessageViewer.svelte'
import NodeContent from '../components/markup/NodeContent.svelte'
import LiteNodeContent from '../components/markup/lite/LiteNodeContent.svelte'
import LiteMessageViewer from '../components/LiteMessageViewer.svelte'
import plugin from '../plugin'

jest.mock('../filetypes', () => ({ getFileMetadata: jest.fn() }))
jest.mock('@hcengineering/emoji', () => ({
  getParseEmojisFunction: () => undefined,
  loadParseEmojisFunction: async () => undefined
}))

const PLATFORM_SRC = 'platform://platform/files/workspace/?file=folder%2Fimage%20%2B.png&size=400'
const DATA_SRC = 'data:image/png;base64,iVBORw0KGgo='

function message (attrs: Attrs): string {
  return jsonToMarkup({
    type: MarkupNodeType.doc,
    content: [
      {
        type: MarkupNodeType.paragraph,
        content: [
          {
            type: MarkupNodeType.image,
            attrs: { alt: 'image.png', width: 320, height: 180, ...attrs }
          }
        ]
      }
    ]
  })
}

describe.each([
  ['activity message', MessageViewer, {}],
  ['markup popup preview', MessageViewer, { preview: true }],
  ['compact preview', LiteMessageViewer, {}]
] as const)('%s images', (_name, Viewer, options) => {
  const storage: FileStorage = {
    getFileUrl: jest.fn(
      (_workspace: string, id: string) => `https://storage.example/current/${encodeURIComponent(id)}`
    ),
    getCookiePath: jest.fn(),
    getFileMeta: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn()
  }
  let target: HTMLDivElement
  let viewer: MessageViewer | LiteMessageViewer | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    setMetadata(plugin.metadata.WorkspaceUuid, 'current-workspace' as WorkspaceUuid)
    setMetadata(plugin.metadata.FileStorage, storage)
    target = document.createElement('div')
    document.body.appendChild(target)
  })

  afterEach(() => {
    viewer?.$destroy()
    viewer = undefined
    target.remove()
    setMetadata(plugin.metadata.WorkspaceUuid, undefined)
    setMetadata(plugin.metadata.FileStorage, undefined)
  })

  it.each([
    { 'file-id': 'stored-blob' },
    { 'file-id': 'stored-blob', src: null },
    { 'file-id': 'stored-blob', src: '' },
    { 'file-id': 'stored-blob', src: 'https://old.example/expired/image.png' },
    { 'file-id': 'stored-blob', src: 'platform://platform/files/workspace/?file=wrong-blob' },
    { 'file-id': 'stored-blob', src: 'image://stored-blob?file=stored-blob' }
  ])(
    `${Viewer === MessageViewer ? 'control' : 'regression'}: resolves the stored blob instead of the saved src: %j`,
    async (attrs) => {
      const stored = message(attrs)
      viewer = new Viewer({ target, props: { ...options, message: stored } })
      await tick()

      const image = target.querySelector('img')
      expect(image?.getAttribute('src')).toBe('https://storage.example/current/stored-blob')
      expect(image?.getAttribute('alt')).toBe('image.png')
      expect(image?.getAttribute('width')).toBe('320')
      expect(image?.getAttribute('height')).toBe('180')
      expect(storage.getFileUrl).toHaveBeenCalledWith('current-workspace', 'stored-blob', undefined)
      if (Viewer === LiteMessageViewer) {
        expect(image?.getAttribute('srcset')).toContain('size=32')
      }
    }
  )

  it('resolves a legacy src-only platform URL after loading a stored comment', async () => {
    viewer = new Viewer({ target, props: { ...options, message: message({ 'file-id': null, src: PLATFORM_SRC }) } })
    await tick()

    expect(target.querySelector('img')?.getAttribute('src')).toBe(
      'https://storage.example/current/folder%2Fimage%20%2B.png'
    )
    expect(storage.getFileUrl).toHaveBeenCalledWith('current-workspace', 'folder/image +.png', undefined)
  })

  it.each([
    'https://images.example/image.png?file=external',
    'http://images.example/image.png',
    'blob:https://images.example/image',
    '/images/relative.png',
    DATA_SRC
  ])(`${Viewer === MessageViewer ? 'control' : 'regression'}: preserves a src-only URL: %s`, async (src) => {
    viewer = new Viewer({ target, props: { ...options, message: message({ src, 'file-id': null }) } })
    await tick()

    expect(target.querySelector('img')?.getAttribute('src')).toBe(src)
    expect(storage.getFileUrl).not.toHaveBeenCalled()
  })

  it(`${Viewer === MessageViewer ? 'control' : 'regression'}: renders a real Markdown round trip used by communication previews`, async () => {
    const json = JSON.parse(message({ 'file-id': 'stored-blob', src: null }))
    const parsed = markdownToMarkup(markupToMarkdown(json))
    viewer = new Viewer({ target, props: { ...options, message: jsonToMarkup(parsed) } })
    await tick()
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/current/stored-blob')
  })

  it('resolves a text/html round trip without losing file-id', async () => {
    const json = JSON.parse(message({ 'file-id': 'stored-blob', src: null }))
    const parsed = htmlToMarkup(markupToHtml(json))
    viewer = new Viewer({ target, props: { ...options, message: jsonToMarkup(parsed) } })
    await tick()
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/current/stored-blob')
  })

  it('ignores an empty file-id and resolves the legacy source', async () => {
    viewer = new Viewer({ target, props: { ...options, message: message({ 'file-id': '', src: PLATFORM_SRC }) } })
    await tick()
    expect(target.querySelector('img')?.getAttribute('src')).toBe(
      'https://storage.example/current/folder%2Fimage%20%2B.png'
    )
  })

  it('falls back to the saved source when storage metadata is unavailable', async () => {
    setMetadata(plugin.metadata.FileStorage, undefined)
    viewer = new Viewer({
      target,
      props: { ...options, message: message({ 'file-id': 'stored-blob', src: DATA_SRC }) }
    })
    await tick()
    expect(target.querySelector('img')?.getAttribute('src')).toBe(DATA_SRC)
  })

  it('updates the image when the displayed message changes', async () => {
    viewer = new Viewer({ target, props: { ...options, message: message({ 'file-id': 'first-blob' }) } })
    await tick()
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/current/first-blob')

    viewer.$set({ message: message({ src: PLATFORM_SRC }) })
    await tick()
    expect(target.querySelector('img')?.getAttribute('src')).toBe(
      'https://storage.example/current/folder%2Fimage%20%2B.png'
    )

    viewer.$set({ message: message({ src: DATA_SRC }) })
    await tick()
    expect(target.querySelector('img')?.getAttribute('src')).toBe(DATA_SRC)
  })

  it('does not invent a storage reference for an image without a source', async () => {
    viewer = new Viewer({ target, props: { ...options, message: message({ src: null, 'file-id': null }) } })
    await tick()

    expect(target.querySelector('img')?.hasAttribute('src')).toBe(false)
    expect(storage.getFileUrl).not.toHaveBeenCalled()
  })
})

describe.each([
  ['full', NodeContent],
  ['compact', LiteNodeContent]
])('blob-backed markup nodes (%s)', (_name, Viewer) => {
  let target: HTMLDivElement
  let viewer: NodeContent | LiteNodeContent
  const getFileUrl = jest.fn(() => 'https://storage.example/blob')

  beforeEach(() => {
    getFileUrl.mockReset().mockReturnValue('https://storage.example/blob')
    target = document.createElement('div')
    document.body.append(target)
    setMetadata(plugin.metadata.WorkspaceUuid, 'workspace' as WorkspaceUuid)
    setMetadata(plugin.metadata.FileStorage, {
      getFileUrl,
      getCookiePath: jest.fn(),
      getFileMeta: jest.fn(),
      uploadFile: jest.fn(),
      deleteFile: jest.fn()
    })
  })

  afterEach(() => {
    viewer?.$destroy()
    target.remove()
    setMetadata(plugin.metadata.FileStorage, undefined)
    setMetadata(plugin.metadata.WorkspaceUuid, undefined)
  })

  it.each(['', null, undefined, 42, false])('does not resolve an invalid GIF file-id: %s', async (fileId) => {
    viewer = new Viewer({
      target,
      props: { node: { type: MarkupNodeType.gif, attrs: { 'file-id': fileId, src: DATA_SRC, alt: 'gif' } } }
    })
    await tick()
    await tick()
    expect(getFileUrl).not.toHaveBeenCalled()
    expect(target.querySelector('img')?.getAttribute('src')).toBe(DATA_SRC)
  })

  it.each([
    { type: MarkupNodeType.gif, attrs: { 'file-id': 'missing', alt: 'Missing GIF' } },
    { type: MarkupNodeType.emoji, attrs: { kind: 'image', image: 'missing', emoji: ':missing:' } },
    { type: MarkupNodeType.text, text: ':missing:' }
  ])('shows a placeholder on rejected blob lookup: %j', async (node) => {
    getFileUrl.mockImplementation(() => {
      throw new Error('Missing blob')
    })
    viewer = new Viewer({
      target,
      props: {
        node,
        parseEmojisFunction: () => ({ nodes: [{ image: 'missing', emoji: ':missing:' }], emojisOnly: true })
      }
    })
    for (let i = 0; i < 10; i++) await tick()
    expect(target.querySelector('.broken-image')).not.toBeNull()
    expect(target.textContent).toContain(node.attrs?.alt ?? ':missing:')
  })

  it.each([MarkupNodeType.gif, MarkupNodeType.image])(
    'shows a placeholder on an HTTP/decoder image error (%s)',
    async (type) => {
      viewer = new Viewer({
        target,
        props: { node: { type, attrs: { 'file-id': 'missing', alt: 'Unavailable image' } } }
      })
      for (let i = 0; i < 10; i++) await tick()
      target.querySelector('img')?.dispatchEvent(new Event('error'))
      await tick()
      expect(target.querySelector('.broken-image')).not.toBeNull()
      expect(target.textContent).toContain('Unavailable image')
    }
  )
})
