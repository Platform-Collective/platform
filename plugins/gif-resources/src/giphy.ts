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
import { getMetadata } from '@hcengineering/platform'
import gifPlugin from '@hcengineering/gif'

// GIPHY's rules shape this whole file, so they are written down rather than assumed:
//
//  - "All requests to GIPHY should be made directly from the client side" and "Do not proxy
//    requests to GIPHY, either API calls or media URL loads". So this runs in the browser and
//    the server never sees a GIPHY url. That is also why the api key is deliberately shipped
//    to the client.
//  - "Do not cache media URLs or copies of GIPHY media assets". So nothing here is persisted
//    and nothing is uploaded to workspace storage. A chosen GIF is hot-linked by url.
//  - A beta key allows 100 calls per hour FOR THE WHOLE WORKSPACE. Every call in here is
//    therefore treated as scarce: searches are debounced by the caller, an empty query never
//    calls search, and paging is by explicit user action.

const GIPHY_API = 'https://api.giphy.com/v1/gifs'

/** @public */
export interface GiphyGif {
  id: string
  title: string
  // The still-size url we render in the grid. Small, so a grid of 24 does not pull tens of MB.
  previewUrl: string
  // What actually gets inserted into the message.
  url: string
  width: number
  height: number
}

/** @public */
export function giphyConfigured (): boolean {
  const key = getMetadata(gifPlugin.metadata.GiphyApiKey)
  return key !== undefined && key !== ''
}

interface GiphyImage {
  url?: string
  width?: string
  height?: string
}

interface GiphyItem {
  id?: string
  title?: string
  images?: Record<string, GiphyImage>
}

function toGif (item: GiphyItem): GiphyGif | undefined {
  const images = item.images ?? {}
  // fixed_width is ~200px wide and is what GIPHY recommend for a picker grid. downsized_medium
  // is the send-size. Falling back through the chain matters because not every GIF carries
  // every rendition, and a missing one would otherwise render a broken tile.
  const preview = images.fixed_width ?? images.preview_gif ?? images.downsized ?? images.original
  const full = images.downsized_medium ?? images.downsized ?? images.original ?? preview
  if (preview?.url === undefined || full?.url === undefined || item.id === undefined) return undefined
  const w = Number(preview.width ?? '0')
  const h = Number(preview.height ?? '0')
  return {
    id: item.id,
    title: item.title ?? '',
    previewUrl: preview.url,
    url: full.url,
    width: Number.isFinite(w) && w > 0 ? w : 200,
    height: Number.isFinite(h) && h > 0 ? h : 200
  }
}

/**
 * One page as GIPHY returned it. count is the raw item count, which can exceed gifs.length when
 * an item lacks a usable rendition. Paging has to follow count, or the offset drifts and a short
 * page reads as the last one.
 * @public
 */
export interface GiphyPage {
  gifs: GiphyGif[]
  count: number
}

/** @public */
export function parsePage (body: any): GiphyPage {
  const data: GiphyItem[] = Array.isArray(body?.data) ? body.data : []
  return { gifs: data.map(toGif).filter((g): g is GiphyGif => g !== undefined), count: data.length }
}

/**
 * Appends a page without repeating an id. Trending shifts between calls, so page 2 can repeat
 * page 1, and a keyed each block with duplicate keys renders wrongly in a production build.
 * @public
 */
export function mergeGifs (existing: GiphyGif[], incoming: GiphyGif[]): GiphyGif[] {
  const seen = new Set(existing.map((g) => g.id))
  const merged = [...existing]
  for (const g of incoming) {
    if (seen.has(g.id)) continue
    seen.add(g.id)
    merged.push(g)
  }
  return merged
}

/** @public */
export class GiphyRateLimited extends Error {}

async function call (path: string, params: Record<string, string>, signal?: AbortSignal): Promise<GiphyPage> {
  const key = getMetadata(gifPlugin.metadata.GiphyApiKey)
  if (key === undefined || key === '') return { gifs: [], count: 0 }
  const qs = new URLSearchParams({
    api_key: key,
    // 'g' keeps the workplace safe for work. Raising this is a policy decision, not a tuning knob.
    rating: 'g',
    // GIPHY's own recommendation for messaging integrations: excludes Clips, which are video
    // with sound and would not render as a GIF in a message.
    bundle: 'messaging_non_clips',
    ...params
  })
  const res = await fetch(`${GIPHY_API}/${path}?${qs.toString()}`, { signal })
  if (res.status === 429) throw new GiphyRateLimited('giphy rate limit reached')
  if (!res.ok) throw new Error(`giphy ${path} failed: ${res.status}`)
  return parsePage(await res.json())
}

/** @public */
export async function giphyTrending (limit: number, offset: number, signal?: AbortSignal): Promise<GiphyPage> {
  return await call('trending', { limit: String(limit), offset: String(offset) }, signal)
}

/** @public */
export async function giphySearch (
  query: string,
  limit: number,
  offset: number,
  signal?: AbortSignal
): Promise<GiphyPage> {
  const q = query.trim()
  // An empty search burns a call and returns GIPHY's own idea of nothing. Callers show
  // trending instead.
  if (q === '') return { gifs: [], count: 0 }
  return await call('search', { q, limit: String(limit), offset: String(offset) }, signal)
}
