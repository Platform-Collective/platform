//
// Copyright © 2024 Hardcore Engineering Inc.
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

import { Analytics } from '@hcengineering/analytics'
import { type BlobMetadata, type Blob, type Ref } from '@hcengineering/core'
import { getMetadata, getResource } from '@hcengineering/platform'
import { type PopupAlignment } from '@hcengineering/ui'
import { writable } from 'svelte/store'

import plugin from './plugin'
import { getPreviewMetadata } from './preview'
import type { FileOrBlob, FilePreviewExtension } from './types'
import { createQuery } from './utils'

/**
 * @public
 */
export async function getFileMetadata (file: FileOrBlob, uuid: Ref<Blob>): Promise<BlobMetadata | undefined> {
  const workspace = getMetadata(plugin.metadata.WorkspaceUuid) ?? ''

  const metadata = await getPreviewMetadata(workspace, uuid)

  const previewType = await getPreviewType(file.type, $previewTypes)
  if (previewType?.metadataProvider === undefined) {
    return metadata
  }

  const metadataProvider = await getResource(previewType.metadataProvider)
  if (metadataProvider === undefined) {
    return metadata
  }

  try {
    const customMetadata = await metadataProvider(file, uuid)
    return { ...metadata, ...customMetadata }
  } catch (err) {
    console.error(err)
    Analytics.handleError(err as Error)
  }

  return metadata
}

/**
 * @public
 */
export const previewTypes = writable<FilePreviewExtension[]>([])
const previewTypesQuery = createQuery(true)
previewTypesQuery.query(plugin.class.FilePreviewExtension, {}, (result) => {
  previewTypes.set(result)
})

let $previewTypes: FilePreviewExtension[] = []
previewTypes.subscribe((it) => {
  $previewTypes = it
})

/**
 * @public
 */
export async function canPreviewFile (contentType: string, _previewTypes: FilePreviewExtension[]): Promise<boolean> {
  return (await getPreviewType(contentType, _previewTypes)) !== undefined
}

/**
 * @public
 */
export async function getPreviewType (
  contentType: string,
  _previewTypes: FilePreviewExtension[]
): Promise<FilePreviewExtension | undefined> {
  const candidates = _previewTypes
    .map((previewType) => ({ previewType, specificity: getMimeSpecificity(previewType.contentType, contentType) }))
    .filter(({ specificity }) => specificity >= 0)
    .sort((a, b) => b.specificity - a.specificity || comparePreviewTypes(a.previewType, b.previewType))

  for (const { previewType } of candidates) {
    if (previewType.availabilityChecker === undefined) return previewType

    try {
      const checkAvailability = await getResource(previewType.availabilityChecker)
      if (checkAvailability !== undefined && (await checkAvailability())) return previewType
    } catch {
      // Resource errors may include document data; report only the failed operation.
      console.error('File preview availability check failed')
    }
  }

  return undefined
}

/**
 * @public
 */
export function getPreviewAlignment (contentType: string): PopupAlignment {
  if (contentType.startsWith('image/')) {
    return 'centered'
  } else if (contentType.startsWith('video/')) {
    return 'centered'
  } else {
    return 'float'
  }
}

function getMimeSpecificity (patterns: string | string[], contentType: string): number {
  const slash = contentType.indexOf('/')
  if (slash <= 0 || slash === contentType.length - 1 || contentType.includes('/', slash + 1)) return -1

  let specificity = -1
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    if (pattern === contentType && !pattern.includes('*')) return 2
    if (pattern === `${contentType.slice(0, slash)}/*`) specificity = 1
    else if (pattern === '*/*' && specificity < 0) specificity = 0
  }
  return specificity
}

function comparePreviewTypes (a: FilePreviewExtension, b: FilePreviewExtension): number {
  if (a.order === undefined && b.order !== undefined) return 1
  if (a.order !== undefined && b.order === undefined) return -1
  const order = (a.order ?? 0) - (b.order ?? 0)
  return order || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0)
}
