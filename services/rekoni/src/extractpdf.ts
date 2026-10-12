//
// Copyright © 2022 Hardcore Engineering Inc.
// Copyright © 2026 TraceX SAS.
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

import sharp from 'sharp'
import {
  extractImages,
  extractLinks,
  extractTextItems,
  getDocumentProxy,
  getMeta,
  type StructuredTextItem
} from 'unpdf'
import { type RekoniModel } from './types'
import { isPrivateCharCode } from './utils'

/**
 * @public
 */
export async function extractData (data: string | Uint8Array): Promise<RekoniModel> {
  const doc = await getDocumentProxy(Buffer.isBuffer(data) ? new Uint8Array(data) : data)
  const [meta, textItems, links] = await Promise.all([getMeta(doc), extractTextItems(doc), extractLinks(doc)])

  const text: RekoniModel = {
    lines: [],
    annotations: [],
    images: [],
    author: typeof meta.info.Author === 'string' ? meta.info.Author : undefined
  }

  for (const link of links.links) {
    text.annotations.push({ type: 'link', value: link })
  }

  for (const [pageIndex, items] of textItems.items.entries()) {
    processPage(text, items)
    await processImages(await extractImages(doc, pageIndex + 1), text)
  }

  return text
}

function processPage (text: RekoniModel, items: StructuredTextItem[]): void {
  let lastY: number = 0
  let ctext: string[] = []
  let widths: number[] = []
  let maxH = 0
  for (const item of items) {
    const str = item.str
    if (str.length === 1) {
      const code = str.charCodeAt(0)
      if (isPrivateCharCode(code)) {
        // Private use characrter, skip it
        continue
      }
    }
    if (lastY === item.y || lastY === 0) {
      if (str.length > 0) {
        ctext.push(item.str)
        widths.push(item.width)
      }
      if (item.height > maxH) {
        maxH = item.height
      }
    } else {
      text.lines.push({ items: ctext, height: maxH, widths })
      maxH = item.height
      if (str.length > 0) {
        ctext = [str]
        widths = [item.width]
      } else {
        ctext = []
        widths = []
      }
    }

    lastY = item.y
  }
  text.lines.push({ items: ctext, height: maxH, widths })
}

async function processImages (images: Awaited<ReturnType<typeof extractImages>>, text: RekoniModel): Promise<void> {
  for (const image of images) {
    const imageBuffer = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
    const img = sharp(imageBuffer, {
      raw: {
        width: image.width,
        height: image.height,
        channels: image.channels
      }
    })

    const pngBuffer = await img.toFormat('png').toBuffer()
    const buffer = await img.toFormat('jpeg').toBuffer()

    text.images.push({
      name: image.key + '.jpeg',
      width: image.width,
      height: image.height,
      buffer,
      pngBuffer,
      format: 'image/jpeg',
      potentialAvatar: true
    })
  }
}
