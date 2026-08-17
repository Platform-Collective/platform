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

import { type Blob, type Ref } from '@hcengineering/core'
import { getBlobRef } from '@hcengineering/presentation'
import { GifNode } from '@hcengineering/text'

export interface GifExtensionOptions {
  getBlobRef: (fileId: Ref<Blob>, filename?: string, size?: number) => Promise<{ src: string, srcset: string }>
}

// A GIF is served unresized: the front deliberately skips preview generation for image/gif so
// the animation survives, so there is no point requesting a sized variant here.
export const GifExtension = GifNode.extend<GifExtensionOptions>({
  addOptions () {
    return {
      getBlobRef: async (file, name, size) => await getBlobRef(file, name, size)
    }
  },

  addNodeView () {
    return ({ node, HTMLAttributes }) => {
      const img = document.createElement('img')
      img.setAttribute('data-type', this.name)
      img.className = 'text-editor-gif'

      const alt = node.attrs.alt
      if (alt != null) img.alt = alt
      const width = node.attrs.width
      if (width != null) img.width = width
      const height = node.attrs.height
      if (height != null) img.height = height

      const fileId = node.attrs['file-id']
      if (fileId != null) {
        void this.options.getBlobRef(fileId).then(({ src, srcset }) => {
          img.src = src
          if (srcset !== '') img.srcset = srcset
        })
      } else if (node.attrs.src != null) {
        // An external source. The URL is used exactly as provided: some providers forbid
        // modifying their media URLs, including stripping query parameters.
        img.src = node.attrs.src
      }

      return { dom: img }
    }
  }
})
