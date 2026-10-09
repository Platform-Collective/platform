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

import { MarkupNodeType, type MarkupNode } from '@hcengineering/text-core'
import { ServerKit } from '../../kits/server-kit'
import { htmlToJSON, jsonToHTML } from '../utils'

// Kept apart from utils.test.ts, which mocks @tiptap/html.
describe('gif node html round trip in the server kit', () => {
  // ServerKit has image enabled, and ImageNode's catch-all img[src] rule must not win over
  // the gif rule, or a gif pasted from a document arrives in chat as an image the composer drops.
  it('parses its own html back to a gif node with image enabled', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.gif, attrs: { 'file-id': 'blob-1' } }] }
      ]
    }
    const back = htmlToJSON(jsonToHTML(doc, [ServerKit]), [ServerKit])
    const node = (back.content?.[0] as MarkupNode)?.content?.[0]
    expect(node?.type).toBe(MarkupNodeType.gif)
    expect(node?.attrs?.['file-id']).toBe('blob-1')
  })

  it('still parses a plain img as an image node', () => {
    const back = htmlToJSON('<p><img src="https://example.com/a.png"></p>', [ServerKit])
    expect((back.content?.[0] as MarkupNode)?.content?.[0]?.type).toBe(MarkupNodeType.image)
  })
})
