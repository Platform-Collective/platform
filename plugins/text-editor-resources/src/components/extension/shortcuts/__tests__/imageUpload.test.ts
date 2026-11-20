// SPDX-License-Identifier: EPL-2.0

import { type Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { type EditorProps, type EditorView } from '@tiptap/pm/view'

import { ImageUploadExtension } from '../imageUpload'

jest.mock('@hcengineering/core', () => ({
  __esModule: true,
  generateId: () => 'generated-id'
}))

jest.mock('@hcengineering/platform', () => ({
  __esModule: true,
  setPlatformStatus: jest.fn(),
  unknownError: jest.fn()
}))

jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  getImageSize: jest.fn(),
  imageSizeToRatio: jest.fn()
}))

function getHandleDrop (): NonNullable<EditorProps['handleDrop']> {
  const extension = ImageUploadExtension.configure({ getFileUrl: () => '' })
  const addProseMirrorPlugins = extension.config.addProseMirrorPlugins

  if (addProseMirrorPlugins === undefined) {
    throw new Error('Image upload extension must provide ProseMirror plugins')
  }

  const plugin = addProseMirrorPlugins.call({
    name: extension.name,
    options: extension.options,
    storage: extension.storage,
    editor: {} as unknown as Editor,
    parent: undefined
  })[0]
  const handleDrop = plugin.props.handleDrop

  if (handleDrop === undefined) {
    throw new Error('Image upload plugin must provide a drop handler')
  }

  return handleDrop
}

describe('ImageUploadExtension handleDrop', () => {
  it('leaves a moved drag to ProseMirror', () => {
    const handleDrop = getHandleDrop()
    const getData = jest.fn(() => '')
    const dataTransfer = {
      files: { length: 0, item: () => null },
      getData
    } as unknown as DataTransfer
    const event = { dataTransfer } as unknown as DragEvent

    const handled = handleDrop({} as unknown as EditorView, event, Slice.empty, true)

    expect(handled).toBe(false)
    expect(getData).not.toHaveBeenCalled()
  })

  it('reads transfer data for an external drag', () => {
    const handleDrop = getHandleDrop()
    const getData = jest.fn(() => '')
    const dataTransfer = {
      files: { length: 0, item: () => null },
      getData
    } as unknown as DataTransfer
    const event = { dataTransfer, x: 0, y: 0 } as unknown as DragEvent
    const view = { posAtCoords: jest.fn(() => null) } as unknown as EditorView

    const handled = handleDrop(view, event, Slice.empty, false)

    expect(handled).toBe(false)
    expect(getData).toHaveBeenCalledWith('text/uri-list')
  })
})
