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

import { diffLinkPreviewUrls, getLinkPreviewUrls } from '../linkPreviewUrls'

const a = 'https://example.com/a'
const b = 'https://example.com/b'
const c = 'https://example.com/c'

describe('diffLinkPreviewUrls', () => {
  it('reports new urls in text order without duplicates', () => {
    expect(diffLinkPreviewUrls([], [b, a, b])).toEqual({ added: [b, a], removed: [] })
  })

  it('reports nothing when the text still has the tracked urls', () => {
    expect(diffLinkPreviewUrls([a, b], [b, a])).toEqual({ added: [], removed: [] })
  })

  it('reports tracked urls that were removed from the text', () => {
    expect(diffLinkPreviewUrls([a, b], [b])).toEqual({ added: [], removed: [a] })
  })

  it('treats a url pasted again after removal as new', () => {
    const tracked = new Set([a])
    const { removed } = diffLinkPreviewUrls(tracked, [])
    removed.forEach((url) => tracked.delete(url))
    expect(diffLinkPreviewUrls(tracked, [a])).toEqual({ added: [a], removed: [] })
  })

  it('handles added and removed urls at the same time', () => {
    expect(diffLinkPreviewUrls([a, b], [b, c])).toEqual({ added: [c], removed: [a] })
  })
})

describe('getLinkPreviewUrls', () => {
  it('maps the stored source url of link previews to their ids', () => {
    const result = getLinkPreviewUrls([
      { _id: '1', type: 'application/link-preview', metadata: { url: a, title: 'A' } },
      { _id: '2', type: 'image/png', metadata: { url: b } },
      { _id: '3', type: 'application/link-preview', metadata: { title: 'no url' } },
      { _id: '4', type: 'application/link-preview' },
      { _id: '5', type: 'application/link-preview', metadata: { url: c } }
    ])
    expect(Array.from(result.entries())).toEqual([
      [a, '1'],
      [c, '5']
    ])
  })

  it('keeps the first preview when the same url has several', () => {
    const result = getLinkPreviewUrls([
      { _id: '1', type: 'application/link-preview', metadata: { url: a } },
      { _id: '2', type: 'application/link-preview', metadata: { url: a } }
    ])
    expect(result.get(a)).toBe('1')
  })

  it('lets a restored url be tracked so removing it from the text is detected', () => {
    const tracked = getLinkPreviewUrls([{ _id: '1', type: 'application/link-preview', metadata: { url: a } }])
    expect(diffLinkPreviewUrls(tracked.keys(), [a])).toEqual({ added: [], removed: [] })
    expect(diffLinkPreviewUrls(tracked.keys(), [])).toEqual({ added: [], removed: [a] })
  })
})
