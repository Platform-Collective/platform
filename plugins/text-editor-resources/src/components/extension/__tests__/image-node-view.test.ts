/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import presentation, { type getFileStorage } from '@hcengineering/presentation'
import { Editor, Node } from '@tiptap/core'
import { ImageExtension } from '../imageExt'

jest.mock('@hcengineering/text', () => ({
  ImageNode: jest.requireActual('../../../../../../foundations/core/packages/text/src/nodes/image').ImageNode
}))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: jest.requireActual('../../../../../../packages/presentation/src/plugin').default,
  ...jest.requireActual('../../../../../../packages/presentation/src/file'),
  ...jest.requireActual('../../../../../../packages/presentation/src/preview')
}))
jest.mock('../../../../../../packages/presentation/src/filetypes', () => ({ getFileMetadata: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('../toolbar/toolbar', () => ({
  setLoadingState: jest.fn(),
  registerToolbarProvider: jest.fn()
}))

it.each([
  ['regression', { 'file-id': null, src: 'platform://platform/files/workspace/?file=folder%2Fimage.png' }],
  ['regression', { 'file-id': '', src: 'platform://platform/files/workspace/?file=folder%2Fimage.png' }],
  ['control', { 'file-id': 'folder/image.png', src: null }],
  ['control', { 'file-id': 'folder/image.png', src: '' }]
] as const)('%s: resolves a stored image in the real editor: %j', async (_kind, attrs) => {
  const storage: ReturnType<typeof getFileStorage> = {
    getFileUrl: jest.fn((_workspace: string, file: string) => `https://storage.example/${encodeURIComponent(file)}`),
    getCookiePath: jest.fn(),
    getFileMeta: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn()
  }
  setMetadata(presentation.metadata.WorkspaceUuid, 'workspace' as WorkspaceUuid)
  setMetadata(presentation.metadata.FileStorage, storage)
  HTMLImageElement.prototype.decode = jest.fn(async () => {})
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      Node.create({ name: 'doc', topNode: true, content: 'paragraph+' }),
      Node.create({ name: 'paragraph', content: 'inline*', renderHTML: () => ['p', 0] }),
      Node.create({ name: 'text', group: 'inline' }),
      ImageExtension
    ],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs
            }
          ]
        }
      ]
    }
  })
  try {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/folder%2Fimage.png')
    expect(storage.getFileUrl).toHaveBeenCalledWith('workspace', 'folder/image.png', undefined)
  } finally {
    editor.destroy()
    setMetadata(presentation.metadata.WorkspaceUuid, undefined)
    setMetadata(presentation.metadata.FileStorage, undefined)
  }
})
