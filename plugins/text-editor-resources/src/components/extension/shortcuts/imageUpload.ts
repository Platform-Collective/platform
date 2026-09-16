//
// Copyright © 2023, 2024 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
import { generateId, type Blob, type Ref } from '@hcengineering/core'
import { setPlatformStatus, unknownError } from '@hcengineering/platform'
import { imageSizeToRatio, getImageSize } from '@hcengineering/presentation'
import { Extension } from '@tiptap/core'
import { type Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { type EditorView } from '@tiptap/pm/view'

import { type FileAttachFunction } from '../types'

/**
 * @public
 */
export interface ImageUploadExtensionOptions {
  attachFile?: FileAttachFunction
  getFileUrl: (fileId: Ref<Blob>) => string
}

/**
 * @public
 */
export const ImageUploadExtension = Extension.create<ImageUploadExtensionOptions>({
  name: 'image-upload',

  addOptions () {
    return {
      getFileUrl: () => ''
    }
  },

  addProseMirrorPlugins () {
    const attachFile = this.options.attachFile
    const getFileUrl = this.options.getFileUrl

    const replacePendingInlineImage = (view: EditorView, placeholder: string, node: Node): void => {
      let imagePosition: number | undefined

      view.state.doc.descendants((currentNode, position) => {
        if (!currentNode.isText || currentNode.text === undefined) return

        const offset = currentNode.text.indexOf(placeholder)
        if (offset !== -1) {
          imagePosition = position + offset
          return false
        }
      })

      if (imagePosition !== undefined) {
        view.dispatch(view.state.tr.replaceWith(imagePosition, imagePosition + placeholder.length, node))
      }
    }

    const uploadInlineImage = async (
      view: EditorView,
      source: string,
      placeholder: string,
      alt: string
    ): Promise<void> => {
      if (attachFile === undefined) return

      try {
        const response = await fetch(source)
        const blob = await response.blob()
        if (!blob.type.startsWith('image/')) return

        const file = new File([blob], getInlineImageName(blob.type, alt), { type: blob.type })
        const attached = await attachFile(file)
        if (attached === undefined) return

        const size = await getImageSize(file)
        const node = view.state.schema.nodes.image.create({
          'file-id': attached.file,
          'data-file-type': file.type,
          src: getFileUrl(attached.file),
          alt: alt || file.name,
          title: alt || file.name,
          width: imageSizeToRatio(size.width, size.pixelRatio)
        })

        replacePendingInlineImage(view, placeholder, node)
      } catch (err) {
        void setPlatformStatus(unknownError(err))
      }
    }

    const transformPastedHTML = (html: string, view: EditorView): string => {
      if (attachFile === undefined || !html.includes('data:image/')) return html

      const document = new DOMParser().parseFromString(html, 'text/html')
      document.querySelectorAll('img[src^="data:image/"]').forEach(image => {
        const source = image.getAttribute('src')
        if (source !== null) {
          const placeholder = `[Uploading image ${generateId()}]`
          image.replaceWith(document.createTextNode(placeholder))
          void uploadInlineImage(view, source, placeholder, image.getAttribute('alt') ?? '')
        }
      })

      return document.body.innerHTML
    }

    function handleDrop (
      view: EditorView,
      pos: { pos: number, inside: number } | null,
      dataTransfer: DataTransfer
    ): any {
      const uris = (dataTransfer.getData('text/uri-list') ?? '').split('\r\n').filter((it) => !it.startsWith('#'))
      let result = false
      for (const uri of uris) {
        if (uri !== '') {
          const url = new URL(uri)
          // TODO datalake support
          const _file = (url.searchParams.get('file') ?? '').split('/').join('')

          if (_file.trim().length === 0) {
            continue
          }

          const ctype = dataTransfer.getData('application/contentType')
          if (ctype.startsWith('image/')) {
            const node = view.state.schema.nodes.image.create({
              'file-id': _file,
              src: getFileUrl(_file as Ref<Blob>)
            })
            const transaction = view.state.tr.insert(pos?.pos ?? 0, node)
            view.dispatch(transaction)
            result = true
          }
        }
      }
      if (result) {
        return result
      }

      const files = dataTransfer?.files
      if (files !== undefined && attachFile !== undefined) {
        for (let i = 0; i < files.length; i++) {
          const file = files.item(i)
          if (file != null && file.type.startsWith('image/')) {
            result = true
            void handleImageUpload(file, view, pos, attachFile, getFileUrl)
          }
        }
      }
      return result
    }

    return [
      new Plugin({
        key: new PluginKey('handle-image-paste'),
        props: {
          transformPastedHTML,
          handlePaste (view, event) {
            const dataTransfer = event.clipboardData
            if (dataTransfer !== null) {
              const res = handleDrop(view, { pos: view.state.selection.$from.pos, inside: 0 }, dataTransfer)
              if (res === true) {
                event.preventDefault()
                event.stopPropagation()
              }
              return res
            }
          },
          handleDrop (view, event) {
            const dataTransfer = event.dataTransfer
            if (dataTransfer !== null) {
              const res = handleDrop(view, view.posAtCoords({ left: event.x, top: event.y }), dataTransfer)
              if (res === true) {
                event.preventDefault()
                event.stopPropagation()
              }
              return res
            }
          }
        }
      })
    ]
  }
})

function getInlineImageName (contentType: string, alt: string): string {
  if (alt.trim() !== '') return alt

  const extension =
    {
      'image/gif': 'gif',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/svg+xml': 'svg',
      'image/webp': 'webp'
    }[contentType] ?? 'bin'

  return `image.${extension}`
}

async function handleImageUpload (
  file: File,
  view: EditorView,
  pos: { pos: number, inside: number } | null,
  attachFile: FileAttachFunction,
  getFileUrl: (fileId: Ref<Blob>) => string
): Promise<void> {
  const attached = await attachFile(file)

  if (attached === undefined) {
    return
  }

  if (!attached.type.includes('image')) {
    return
  }

  try {
    const url = getFileUrl(attached.file)
    const size = await getImageSize(file)
    const node = view.state.schema.nodes.image.create({
      'file-id': attached.file,
      'data-file-type': file.type,
      src: url,
      alt: file.name,
      title: file.name,
      width: imageSizeToRatio(size.width, size.pixelRatio)
    })

    const transaction = view.state.tr.insert(pos?.pos ?? 0, node)

    view.dispatch(transaction)
  } catch (e) {
    void setPlatformStatus(unknownError(e))
  }
}
