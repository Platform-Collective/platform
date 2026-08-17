//
// Copyright © 2026 Hardcore Engineering Inc.
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

import { Node, mergeAttributes } from '@tiptap/core'
import type { Blob, Ref } from '@hcengineering/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    gif: {
      insertGif: (attrs: {
        'file-id'?: Ref<Blob>
        src?: string
        width?: number
        height?: number
        alt?: string
      }) => ReturnType
    }
  }
}

// A GIF is its own node rather than an image node: the image node is switched off in the
// message composers via kitOptions, so an image would be dropped by ProseMirror there. It is
// not an emoji node either, since emoji renders at 1.3em and its serializers drop the blob.
//
// 'file-id' carries a workspace blob for a library GIF. 'src' carries an external URL for a
// third-party source that forbids re-hosting. They are independent and 'file-id' wins, so a
// serializer must never read 'src' alone.
export const GifNode = Node.create({
  name: 'gif',
  group: 'inline',
  inline: true,
  draggable: true,
  selectable: true,

  addAttributes () {
    return {
      'file-id': {
        default: null
      },
      src: {
        default: null
      },
      width: {
        default: null
      },
      height: {
        default: null
      },
      alt: {
        default: null
      }
    }
  },

  addCommands () {
    return {
      insertGif:
        (attrs) =>
          ({ commands }) => {
            return commands.insertContent({ type: this.name, attrs })
          }
    }
  },

  parseHTML () {
    return [
      {
        tag: `img[data-type="${this.name}"]`
      }
    ]
  },

  renderHTML ({ HTMLAttributes }) {
    const imgAttributes = mergeAttributes({ 'data-type': this.name }, HTMLAttributes)
    const fileId = imgAttributes['file-id']
    if (fileId != null) {
      imgAttributes.src = `platform://platform/files/workspace/?file=${fileId}`
    }

    return ['img', imgAttributes]
  }
})
