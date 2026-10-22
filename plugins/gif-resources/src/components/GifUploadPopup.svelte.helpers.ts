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

import { type IntlString } from '@hcengineering/platform'
import type { Blob as CoreBlob, Ref } from '@hcengineering/core'
import gifPlugin, {
  type UploadRejection,
  type WorkspaceGif,
  filenameToKeywords,
  filenameToTitle,
  gifIdFor,
  validateUpload
} from '@hcengineering/gif'

/** Every rejection reason maps to a message. Exhaustive by construction, so a reason added
 * later cannot ship with a blank error.
 * @public */
export function rejectionLabel (reason: UploadRejection): IntlString {
  switch (reason) {
    case 'too-large':
      return gifPlugin.string.TooLarge
    case 'bad-mime':
      return gifPlugin.string.BadMime
    case 'bad-dimensions':
      return gifPlugin.string.BadDimensions
  }
}

/** @public */
export type GifRead =
  | { ok: false, reason: UploadRejection }
  | {
      ok: true
      title: string
      keywords: string[]
      width: number
      height: number
      sha256: string
    }

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/**
 * SHA-256 in plain code, for origins where crypto.subtle does not exist. The browser exposes
 * it only in a secure context, so a workspace served over plain HTTP would otherwise fail every
 * upload. The value is the library's dedup id, so it must equal what crypto.subtle returns.
 * @public
 */
export function sha256HexSoftware (bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes)
  const paddedLength = (((data.length + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(paddedLength)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(data.length / 0x20000000))
  view.setUint32(paddedLength - 4, (data.length << 3) >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ])
  const w = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += hh
  }
  return Array.from(h)
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('')
}

/** @public */
export async function sha256Hex (bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || crypto.subtle === undefined) return sha256HexSoftware(bytes)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** @public */
export async function imageDimensions (file: Blob): Promise<{ width: number, height: number }> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.onerror = reject
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The single gate. The component calls this and nothing else, so there is no second place
 * where a size or mime limit could drift out of step with the tested one.
 * @public
 */
export async function readGif (file: File): Promise<GifRead> {
  const mime = validateUpload({ type: file.type, size: file.size })
  if (!mime.ok) return { ok: false, reason: mime.reason }

  const dimensions = await imageDimensions(file)
  const full = validateUpload({ type: file.type, size: file.size }, dimensions)
  if (!full.ok) return { ok: false, reason: full.reason }

  return {
    ok: true,
    title: filenameToTitle(file.name),
    keywords: filenameToKeywords(file.name),
    width: dimensions.width,
    height: dimensions.height,
    sha256: await sha256Hex(await file.arrayBuffer())
  }
}

/** @public */
export type UploadOutcome =
  | { kind: 'added' }
  | { kind: 'rejected', reason: UploadRejection }
  | { kind: 'duplicate' }
  | { kind: 'failed' }

/** The platform calls the upload needs, so the flow below can be tested without a client.
 * @public */
export interface UploadDeps {
  read: (file: File) => Promise<GifRead>
  exists: (id: Ref<WorkspaceGif>, sha256: string) => Promise<boolean>
  upload: (file: File) => Promise<Ref<CoreBlob>>
  create: (
    attrs: {
      title: string
      keywords: string[]
      blob: Ref<CoreBlob>
      width: number
      height: number
      size: number
      sha256: string
    },
    id: Ref<WorkspaceGif>
  ) => Promise<void>
}

/**
 * The whole upload, with every step inside one handler so a decode, hash, lookup or network
 * failure ends as 'failed' instead of escaping with no message. The row is created under an id
 * derived from the checksum, so two uploads that both pass the lookup collide on the primary
 * key; the loser is told it is a duplicate. Its blob is left behind, the same accepted orphan
 * as a removed entry. The lookup checks the checksum as well as the id, because rows created
 * before ids were derived carry a random id.
 * @public
 */
export async function addToLibrary (file: File, deps: UploadDeps): Promise<UploadOutcome> {
  try {
    const read = await deps.read(file)
    if (!read.ok) return { kind: 'rejected', reason: read.reason }

    const id = gifIdFor(read.sha256)
    if (await deps.exists(id, read.sha256)) return { kind: 'duplicate' }

    const blob = await deps.upload(file)
    try {
      await deps.create(
        {
          title: read.title,
          keywords: read.keywords,
          blob,
          width: read.width,
          height: read.height,
          size: file.size,
          sha256: read.sha256
        },
        id
      )
    } catch (err) {
      if (await deps.exists(id, read.sha256)) return { kind: 'duplicate' }
      throw err
    }
    return { kind: 'added' }
  } catch {
    return { kind: 'failed' }
  }
}
