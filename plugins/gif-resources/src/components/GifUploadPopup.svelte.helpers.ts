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
import gifPlugin, {
  type UploadRejection,
  filenameToKeywords,
  filenameToTitle,
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

/** @public */
export async function sha256Hex (bytes: ArrayBuffer): Promise<string> {
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
