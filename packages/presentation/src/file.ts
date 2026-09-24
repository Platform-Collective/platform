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

import { type Blob as PlatformBlob, type Ref, type WorkspaceUuid } from '@hcengineering/core'
import { getMetadata } from '@hcengineering/platform'
import { type FileStorage, createFileStorage as createStorageClient } from '@hcengineering/storage-client'
import { v4 as uuid } from 'uuid'

import plugin from './plugin'
import { getFileMetadata } from './filetypes'

export function getCurrentWorkspaceUuid (): WorkspaceUuid {
  const workspaceUuid = getMetadata(plugin.metadata.WorkspaceUuid) ?? ''
  return workspaceUuid as WorkspaceUuid
}

function getToken (): string {
  return getMetadata(plugin.metadata.Token) ?? ''
}

/** @public */
export function generateFileId (): string {
  return uuid()
}

/** @public */
export function createFileStorage (uploadUrl: string, datalakeUrl?: string, hulylakeUrl?: string): FileStorage {
  return createStorageClient({ uploadUrl, datalakeUrl, hulylakeUrl })
}

/** @public */
export function getFileStorage (): FileStorage {
  const storage = getMetadata(plugin.metadata.FileStorage)
  if (storage === undefined) {
    throw new Error('Missing file storage metadata')
  }

  return storage
}

/** @public */
export function getFileUrl (file: string, filename?: string): string {
  if (file.includes('://')) {
    return file
  }

  const workspace = getCurrentWorkspaceUuid()

  const storage = getFileStorage()
  return storage.getFileUrl(workspace, file, filename)
}

/**
 * Error thrown by registered upload guards (see {@link setUploadGuard}) when the
 * current workspace is not allowed to upload new files (e.g. plan limit reached
 * and grace period expired). Caller code should handle this distinct from generic
 * upload failures and surface a user-friendly message + upgrade CTA.
 *
 * @public
 */
export class UploadRestrictedError extends Error {
  constructor (
    public readonly reason: string,
    message?: string
  ) {
    super(message ?? reason)
    this.name = 'UploadRestrictedError'
  }
}

/** @public */
export type UploadGuard = (file: File) => Promise<void> | void

let uploadGuard: UploadGuard | undefined

/**
 * Register a synchronous/async guard called before every {@link uploadFile}.
 * Throw an {@link UploadRestrictedError} from the guard to block the upload.
 * Pass `undefined` to clear the guard.
 *
 * The guard lives in `presentation` to keep upload restriction concerns out of
 * every individual call site, and to avoid a dependency from `presentation` to
 * higher-level plugins (billing-resources) — DI inversion via a setter.
 *
 * @public
 */
export function setUploadGuard (guard: UploadGuard | undefined): void {
  uploadGuard = guard
}

/** @public */
// Content types the browser commonly fails to detect, resolved by file extension instead.
const extensionContentTypes: Record<string, string> = {
  log: 'text/plain',
  txt: 'text/plain',
  text: 'text/plain',
  ini: 'text/plain',
  conf: 'text/plain',
  cfg: 'text/plain',
  env: 'text/plain',
  properties: 'text/plain',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  json: 'application/json',
  md: 'text/markdown',
  csv: 'text/csv',
  xml: 'text/xml'
}

/**
 * Resolves a usable content type for a file, falling back to its extension when the
 * browser-provided type is missing or the generic application/octet-stream.
 * @public
 */
export function getContentType (name: string, type: string): string {
  if (type !== '' && type !== 'application/octet-stream') {
    return type
  }
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext !== undefined && extensionContentTypes[ext] !== undefined) {
    return extensionContentTypes[ext]
  }
  return type
}

export async function uploadFile (
  file: File,
  uuid?: Ref<PlatformBlob>
): Promise<{ uuid: Ref<PlatformBlob>, metadata: Record<string, any> }> {
  if (uploadGuard !== undefined) {
    await uploadGuard(file)
  }

  uuid ??= generateFileId() as Ref<PlatformBlob>

  const token = getToken()
  const workspace = getCurrentWorkspaceUuid()

  const contentType = getContentType(file.name, file.type)
  if (contentType !== file.type) {
    file = new File([file], file.name, { type: contentType, lastModified: file.lastModified })
  }

  const storage = getFileStorage()
  await storage.uploadFile(token, workspace, uuid, file)

  const metadata = (await getFileMetadata(file, uuid)) ?? {}

  return { uuid, metadata }
}

/** @public */
export async function deleteFile (file: string): Promise<void> {
  const token = getToken()
  const workspace = getCurrentWorkspaceUuid()

  const storage = getFileStorage()
  await storage.deleteFile(token, workspace, file)
}

export async function getJsonOrEmpty<T = any> (file: string, name: string): Promise<T | undefined> {
  try {
    const fileUrl = getFileUrl(file, name)
    const resp = await fetch(fileUrl)
    return (await resp.json()) as T
  } catch {
    return undefined
  }
}
