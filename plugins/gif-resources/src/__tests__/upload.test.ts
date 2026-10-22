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

import { createHash, randomBytes } from 'crypto'
import { gifIdFor } from '@hcengineering/gif'
import { packColumns } from '../components/GifGrid.svelte.helpers'
import {
  type UploadDeps,
  type GifRead,
  addToLibrary,
  sha256Hex,
  sha256HexSoftware
} from '../components/GifUploadPopup.svelte.helpers'

const nodeHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const buf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

describe('sha256HexSoftware', () => {
  // T-64: crypto.subtle only exists in a secure context, so on a plain-HTTP origin this is the
  // hash. It must agree with the platform implementation for every length class, because the
  // value is the dedup id and a disagreement would let the same file in twice.
  it('matches the known vectors', () => {
    expect(sha256HexSoftware(new ArrayBuffer(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
    expect(sha256HexSoftware(buf(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('matches node for lengths around the 64-byte block and padding edges', () => {
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 100_003]) {
      const bytes = randomBytes(n)
      expect(sha256HexSoftware(buf(bytes))).toBe(nodeHash(bytes))
    }
  })
})

describe('sha256Hex', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  afterEach(() => {
    if (original !== undefined) Object.defineProperty(globalThis, 'crypto', original)
  })

  // T-65: an insecure origin has no crypto.subtle; the upload must still produce the hash.
  it('falls back to the software hash when crypto.subtle is unavailable', async () => {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true })
    const bytes = randomBytes(300)
    expect(await sha256Hex(buf(bytes))).toBe(nodeHash(bytes))
  })

  it('uses crypto.subtle when present', async () => {
    const bytes = randomBytes(300)
    expect(await sha256Hex(buf(bytes))).toBe(nodeHash(bytes))
  })
})

describe('packColumns', () => {
  // T-66: TS7011 regression. The empty-column initialiser must type as T[][].
  it('returns one array per column', () => {
    expect(packColumns([], 3)).toEqual([[], [], []])
  })
})

describe('addToLibrary', () => {
  const file = { name: 'party-parrot.gif', type: 'image/gif', size: 10 } as unknown as File
  const okRead: GifRead = {
    ok: true,
    title: 'Party Parrot',
    keywords: ['party', 'parrot'],
    width: 4,
    height: 4,
    sha256: 'ab12'
  }

  function deps (over: Partial<UploadDeps> = {}): UploadDeps & { created: Array<{ id: string }> } {
    const created: Array<{ id: string }> = []
    return {
      read: async () => okRead,
      exists: async () => false,
      upload: async () => 'blob-1' as any,
      create: async (_attrs, id) => {
        created.push({ id })
      },
      ...over,
      created
    }
  }

  it('creates the row under the id derived from the checksum', async () => {
    const d = deps()
    expect(await addToLibrary(file, d)).toEqual({ kind: 'added' })
    expect(d.created).toEqual([{ id: gifIdFor('ab12') }])
  })

  it('reports a rejection without uploading', async () => {
    const upload = jest.fn()
    const out = await addToLibrary(file, deps({ read: async () => ({ ok: false, reason: 'too-large' }), upload }))
    expect(out).toEqual({ kind: 'rejected', reason: 'too-large' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('reports a duplicate found up front without uploading the blob', async () => {
    const upload = jest.fn()
    expect(await addToLibrary(file, deps({ exists: async () => true, upload }))).toEqual({ kind: 'duplicate' })
    expect(upload).not.toHaveBeenCalled()
  })

  // T-67: decode, hash and lookup failures used to escape the handler, so the user saw nothing.
  it('reports failed when reading the file throws', async () => {
    expect(
      await addToLibrary(
        file,
        deps({
          read: async () => {
            throw new Error('decode')
          }
        })
      )
    ).toEqual({ kind: 'failed' })
  })

  it('reports failed when the lookup throws', async () => {
    expect(
      await addToLibrary(
        file,
        deps({
          exists: async () => {
            throw new Error('query')
          }
        })
      )
    ).toEqual({ kind: 'failed' })
  })

  it('reports failed when the blob upload throws, creating nothing', async () => {
    const d = deps({
      upload: async () => {
        throw new Error('net')
      }
    })
    expect(await addToLibrary(file, d)).toEqual({ kind: 'failed' })
    expect(d.created).toEqual([])
  })

  // T-68: two uploads of the same bytes both pass the lookup. The second create collides on
  // the primary key; that is a duplicate, not a failure.
  it('treats a create that loses the race as a duplicate', async () => {
    let calls = 0
    const d = deps({
      exists: async () => ++calls > 1,
      create: async () => {
        throw new Error('duplicate key')
      }
    })
    expect(await addToLibrary(file, d)).toEqual({ kind: 'duplicate' })
  })

  it('reports failed when create throws and the row is not there', async () => {
    expect(
      await addToLibrary(
        file,
        deps({
          create: async () => {
            throw new Error('boom')
          }
        })
      )
    ).toEqual({ kind: 'failed' })
  })
})
