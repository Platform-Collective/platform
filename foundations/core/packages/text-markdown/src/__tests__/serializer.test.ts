//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { MarkupNode } from '@hcengineering/text-core'

import { storeNodes } from '../serializer'

const IMAGE_URL = 'https://files.example/'

function escapeHtml (value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function serializeImage (attrs: Record<string, unknown>): string {
  const output: string[] = []
  const state = {
    write: (content: string) => output.push(content),
    esc: (value: string) => value,
    htmlEsc: escapeHtml,
    quote: (value: string) => '"' + value + '"',
    imageUrl: IMAGE_URL
  } as unknown as Parameters<typeof storeNodes.image>[0]
  const node: MarkupNode = { type: 'image', attrs } as unknown as MarkupNode
  const parent: MarkupNode = { type: 'doc', content: [] } as unknown as MarkupNode

  storeNodes.image(state, node, parent, 0)

  return output.join('')
}

describe('storeNodes.image', () => {
  it('serializes a token-backed image with its dimensions and title', () => {
    expect(
      serializeImage({
        'file-id': 'file-123',
        token: 'token-abc',
        width: 320,
        height: 180,
        alt: 'Preview',
        title: 'Screenshot'
      })
    ).toBe('![Preview](https://files.example/file-123?file=file-123&width=320&height=180&token=token-abc "Screenshot")')
  })

  it('serializes a file-backed image with its dimensions', () => {
    expect(
      serializeImage({
        'file-id': 'file-123',
        width: 320,
        height: 180,
        alt: 'Preview'
      })
    ).toBe('![Preview](https://files.example/file-123?file=file-123&width=320&height=180)')
  })

  it('serializes sized external images as HTML', () => {
    expect(
      serializeImage({
        src: 'https://images.example/preview.png',
        width: 320,
        height: 180,
        alt: 'Preview'
      })
    ).toBe('<img width="320" height="180" src="https://images.example/preview.png" alt="Preview">')
  })

  it('serializes external images without dimensions as Markdown', () => {
    expect(
      serializeImage({
        src: 'https://images.example/preview.png',
        alt: 'Preview',
        title: 'Screenshot'
      })
    ).toBe('![Preview](https://images.example/preview.png "Screenshot")')
  })

  it('encodes values added to file image URLs', () => {
    expect(
      serializeImage({
        'file-id': 'file & id',
        token: 'token&admin=true',
        width: '320&height=1',
        alt: 'Preview'
      })
    ).toBe(
      '![Preview](https://files.example/file%20%26%20id?file=file%20%26%20id&width=320%26height%3D1&token=token%26admin%3Dtrue)'
    )
  })

  it('HTML-escapes attributes of sized external images', () => {
    expect(
      serializeImage({
        src: 'https://images.example/preview.png?x="><script>',
        width: '320" onerror="alert(1)',
        alt: 'Preview <image>',
        title: 'Screenshot & details'
      })
    ).toBe(
      '<img width="320&quot; onerror=&quot;alert(1)" src="https://images.example/preview.png?x=&quot;&gt;&lt;script&gt;" alt="Preview &lt;image&gt;" title="Screenshot &amp; details">'
    )
  })
})
