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

import type { GifGridPage, GifPickerResult, UploadValidation, WorkspaceGif } from './types'

/** Uploads above this are rejected client-side. The repo enforces no upload limit at any
 * layer, and a GIF is served unresized, so every workspace member downloads whatever is
 * accepted here at full size.
 * @public */
export const MAX_GIF_BYTES = 8 * 1024 * 1024

/** @public */
export const MAX_GIF_DIMENSION = 2000

/** Bounded so the grid never pulls an unbounded number of full-size animated originals.
 * @public */
export const GIF_PAGE_SIZE = 24

/**
 * Derive searchable terms from the uploaded filename. Without this, keywords depend on a
 * human filling in a form at upload time, nobody does, and the search box is decoration.
 * @public
 */
export function filenameToKeywords (filename: string): string[] {
  const stem = filename.replace(/\.[^./\\]*$/, '')
  return stem
    .split(/[\s._\-+()[\]{}]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
}

/** @public */
export function filenameToTitle (filename: string): string {
  const words = filenameToKeywords(filename)
  if (words.length === 0) return filename
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * An empty query is not a filter: it returns everything, so the grid shows the library rather
 * than a blank box until you type.
 * @public
 */
export function matchesQuery (gif: Pick<WorkspaceGif, 'title' | 'keywords'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  if (gif.title.toLowerCase().includes(q)) return true
  return gif.keywords.some((k) => k.toLowerCase().includes(q))
}

/** @public */
export function validateUpload (
  file: { type: string, size: number },
  dimensions?: { width: number, height: number }
): UploadValidation {
  if (file.type !== 'image/gif') return { ok: false, reason: 'bad-mime' }
  if (file.size > MAX_GIF_BYTES) return { ok: false, reason: 'too-large' }
  if (dimensions !== undefined && (dimensions.width > MAX_GIF_DIMENSION || dimensions.height > MAX_GIF_DIMENSION)) {
    return { ok: false, reason: 'bad-dimensions' }
  }
  return { ok: true }
}

/** @public */
export function isGifResult (result: unknown): result is Extract<GifPickerResult, { kind: 'gif' }> {
  return typeof result === 'object' && result !== null && (result as { kind?: unknown }).kind === 'gif'
}

/** @public */
export function isEmojiResult (result: unknown): result is Extract<GifPickerResult, { kind: 'emoji' }> {
  return typeof result === 'object' && result !== null && (result as { kind?: unknown }).kind === 'emoji'
}

/**
 * Page N of the filtered library. Takes the page index, so "load more" advances rather than
 * returning the first page forever.
 * @public
 */
export function gridPage (items: WorkspaceGif[], page: number, pageSize: number = GIF_PAGE_SIZE): GifGridPage {
  const start = Math.max(0, page) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    hasMore: items.length > start + pageSize
  }
}

/** The first item of the FILTERED result, so Enter picks what the user is looking at rather
 * than the first item of the whole library.
 * @public */
export function selectFirst (items: WorkspaceGif[]): WorkspaceGif | undefined {
  return items.length > 0 ? items[0] : undefined
}

/** @public */
export type LibraryViewState = 'loading' | 'empty' | 'no-results' | 'populated'

/**
 * 'empty' and 'no-results' are deliberately different. Showing "your library is empty, upload
 * one" after a search that simply found nothing tells the user their library was wiped.
 * @public
 */
export function libraryViewState (opts: {
  loaded: boolean
  query: string
  total: number
  matched: number
}): LibraryViewState {
  if (!opts.loaded) return 'loading'
  if (opts.total === 0) return 'empty'
  if (opts.matched === 0) return 'no-results'
  return 'populated'
}
