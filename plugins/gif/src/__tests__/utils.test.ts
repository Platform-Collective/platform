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

import {
  GIF_PAGE_SIZE,
  MAX_GIF_BYTES,
  MAX_GIF_DIMENSION,
  filenameToKeywords,
  filenameToTitle,
  gridPage,
  isEmojiResult,
  isGifResult,
  libraryViewState,
  matchesQuery,
  selectFirst,
  validateUpload
} from '../utils'
import type { WorkspaceGif } from '../types'

const gif = (title: string, keywords: string[] = []): WorkspaceGif =>
  ({ title, keywords }) as unknown as WorkspaceGif

const many = (n: number): WorkspaceGif[] => Array.from({ length: n }, (_, i) => gif(`g${i}`))

describe('filenameToKeywords', () => {
  // T-01
  it('splits a filename into lowercase terms and drops the extension', () => {
    expect(filenameToKeywords('party-parrot-dance.gif')).toEqual(['party', 'parrot', 'dance'])
    expect(filenameToKeywords('Shrug_Cat.GIF')).toEqual(['shrug', 'cat'])
  })

  // T-02: an unguarded split yields empty-string keywords, which then match every query.
  it('handles pathological names without producing empty terms', () => {
    for (const name of ['.gif', '', '---.gif', 'a...b.gif', '  spaced  name .gif', 'noext']) {
      expect(filenameToKeywords(name).every((k) => k.length > 0)).toBe(true)
    }
    expect(filenameToKeywords('---.gif')).toEqual([])
    expect(filenameToKeywords('noext')).toEqual(['noext'])
    expect(filenameToKeywords('ünïcode-café.gif')).toEqual(['ünïcode', 'café'])
    expect(filenameToKeywords('x'.repeat(200) + '.gif')).toEqual(['x'.repeat(200)])
  })

  it('falls back to the raw filename for a title it cannot derive', () => {
    expect(filenameToTitle('---.gif')).toBe('---.gif')
    expect(filenameToTitle('party-parrot.gif')).toBe('Party Parrot')
  })
})

describe('matchesQuery', () => {
  // T-03
  it('matches on the title, case-insensitively', () => {
    expect(matchesQuery(gif('Party Parrot'), 'parrot')).toBe(true)
    expect(matchesQuery(gif('Party Parrot'), 'PARTY')).toBe(true)
  })

  // T-04: a predicate ignoring keywords passes a title-only test.
  it('matches on a keyword that is absent from the title', () => {
    expect(matchesQuery(gif('IMG 4821', ['celebrate', 'confetti']), 'confetti')).toBe(true)
  })

  // T-05
  it('returns everything for an empty or whitespace query', () => {
    expect(matchesQuery(gif('anything'), '')).toBe(true)
    expect(matchesQuery(gif('anything'), '   ')).toBe(true)
  })

  // T-06: without this the whole describe passes against `() => true`.
  it('excludes an item that matches neither title nor keywords', () => {
    expect(matchesQuery(gif('Party Parrot', ['celebrate']), 'dinosaur')).toBe(false)
  })
})

describe('validateUpload', () => {
  const ok = { type: 'image/gif', size: 1024 }

  // T-13 first: if the validator rejected everything the rejection tests would still pass.
  it('accepts a valid gif', () => {
    expect(validateUpload(ok)).toEqual({ ok: true })
    expect(validateUpload({ type: 'image/gif', size: MAX_GIF_BYTES })).toEqual({ ok: true })
  })

  // T-10: asserts the reason, never the message. A copy edit must not turn this red.
  it('rejects a file over the size cap, at the boundary', () => {
    expect(validateUpload({ type: 'image/gif', size: MAX_GIF_BYTES + 1 })).toEqual({
      ok: false,
      reason: 'too-large'
    })
  })

  // T-11
  it('rejects every non-gif mime', () => {
    for (const type of ['image/png', 'image/jpeg', 'text/html', '', 'image/gif; charset=binary']) {
      expect(validateUpload({ type, size: 1024 })).toEqual({ ok: false, reason: 'bad-mime' })
    }
  })

  // T-12
  it('rejects oversized dimensions', () => {
    expect(validateUpload(ok, { width: MAX_GIF_DIMENSION + 1, height: 10 })).toEqual({
      ok: false,
      reason: 'bad-dimensions'
    })
    expect(validateUpload(ok, { width: MAX_GIF_DIMENSION, height: MAX_GIF_DIMENSION })).toEqual({ ok: true })
  })
})

describe('result discrimination', () => {
  const gifResult = { kind: 'gif' as const, 'file-id': 'blob-1' as never }
  const emojiResult = { kind: 'emoji' as const, text: '🎉' }

  // T-07
  it('isGifResult accepts a gif and rejects an emoji', () => {
    expect(isGifResult(gifResult)).toBe(true)
    expect(isGifResult(emojiResult)).toBe(false)
  })

  // T-08: the mirror direction. `(x) => x != null` passes T-07 and the positive case here.
  it('isEmojiResult accepts an emoji and rejects a gif', () => {
    expect(isEmojiResult(emojiResult)).toBe(true)
    expect(isEmojiResult(gifResult)).toBe(false)
  })

  // T-09: popup dismissal shapes. Both guards must reject, or the shell inserts on Escape.
  it('both guards reject dismissal shapes', () => {
    for (const v of [undefined, null, '', 0, {}, { kind: 'other' }, new Event('close')]) {
      expect(isGifResult(v)).toBe(false)
      expect(isEmojiResult(v)).toBe(false)
    }
  })
})

describe('gridPage', () => {
  // T-16: page index must be honoured, or "load more" is inert and page 0 shows forever.
  it('returns the correct disjoint window for each page', () => {
    const items = many(GIF_PAGE_SIZE * 2 + 5)
    const p0 = gridPage(items, 0)
    const p1 = gridPage(items, 1)
    expect(p0.items).toHaveLength(GIF_PAGE_SIZE)
    expect(p1.items).toHaveLength(GIF_PAGE_SIZE)
    expect(p0.items[0].title).not.toEqual(p1.items[0].title)
    expect(p0.items.map((i) => i.title)).not.toEqual(expect.arrayContaining(p1.items.map((i) => i.title)))
  })

  it('reports hasMore correctly at the boundaries', () => {
    expect(gridPage(many(GIF_PAGE_SIZE - 1), 0).hasMore).toBe(false)
    expect(gridPage(many(GIF_PAGE_SIZE), 0).hasMore).toBe(false)
    expect(gridPage(many(GIF_PAGE_SIZE + 1), 0).hasMore).toBe(true)
    expect(gridPage(many(GIF_PAGE_SIZE + 1), 1).hasMore).toBe(false)
  })

  it('handles an empty library and an out-of-range page', () => {
    expect(gridPage([], 0)).toEqual({ items: [], hasMore: false })
    expect(gridPage(many(5), 99).items).toEqual([])
  })
})

describe('selectFirst', () => {
  // T-19: the caller passes the FILTERED list; picking from the unfiltered library looks
  // correct until you actually search.
  it('returns the first item of what it is given', () => {
    expect(selectFirst([gif('a'), gif('b')])?.title).toBe('a')
  })

  // T-20: Enter on a no-results search must be a no-op, not an insert of undefined.
  it('returns undefined for an empty result set', () => {
    expect(selectFirst([])).toBeUndefined()
  })
})

describe('libraryViewState', () => {
  // T-18: loading must not read as empty, or every open flashes the upload CTA.
  it('distinguishes loading from empty', () => {
    expect(libraryViewState({ loaded: false, query: '', total: 0, matched: 0 })).toBe('loading')
    expect(libraryViewState({ loaded: true, query: '', total: 0, matched: 0 })).toBe('empty')
  })

  // A search that found nothing is NOT an empty library. Conflating them tells the user
  // their library was wiped.
  it('distinguishes a fruitless search from an empty library', () => {
    expect(libraryViewState({ loaded: true, query: 'parrot', total: 12, matched: 0 })).toBe('no-results')
  })

  it('reports populated when there are matches', () => {
    expect(libraryViewState({ loaded: true, query: '', total: 12, matched: 12 })).toBe('populated')
  })
})
