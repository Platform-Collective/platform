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

import { type GiphyGif, mergeGifs, parsePage } from '../giphy'

const item = (id: string): unknown => ({
  id,
  title: id,
  images: { fixed_width: { url: `https://x/${id}.gif`, width: '200', height: '100' } }
})

const gif = (id: string): GiphyGif => ({ id, title: id, previewUrl: '', url: '', width: 1, height: 1 })

describe('parsePage', () => {
  // The next offset and the end-of-results test are GIPHY's own counts. Both used to be taken
  // from the number of items that survived toGif, so one item without a rendition made the next
  // page overlap and a short page look like the last one.
  it('counts what GIPHY returned, not what survived filtering', () => {
    const page = parsePage({ data: [item('a'), { id: 'no-images' }, item('c')] })
    expect(page.gifs.map((g) => g.id)).toEqual(['a', 'c'])
    expect(page.count).toBe(3)
  })

  it('returns an empty page for a body without data', () => {
    expect(parsePage({})).toEqual({ gifs: [], count: 0 })
    expect(parsePage(undefined)).toEqual({ gifs: [], count: 0 })
  })
})

describe('mergeGifs', () => {
  // Trending shifts between calls, so page 2 can repeat page 1. Duplicate ids in a keyed each
  // block render wrongly in a production build.
  it('appends only ids not already present', () => {
    expect(mergeGifs([gif('a'), gif('b')], [gif('b'), gif('c')]).map((g) => g.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops a repeat inside the incoming page itself', () => {
    expect(mergeGifs([], [gif('a'), gif('a')]).map((g) => g.id)).toEqual(['a'])
  })
})
