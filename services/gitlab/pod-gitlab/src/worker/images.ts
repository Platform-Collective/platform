// SPDX-License-Identifier: EPL-2.0

import { generateId, type WorkspaceIds } from '@hcengineering/core'
import type { StorageAdapter } from '@hcengineering/server-core'
import type { ImageStore } from '../sync/types'

/** Copied images in the workspace's blob storage. */
export function createImageStore (
  storage: Pick<StorageAdapter, 'stat' | 'read' | 'put'>,
  workspace: WorkspaceIds
): ImageStore {
  return {
    stat: async (ctx, file) => {
      const blob = await storage.stat(ctx, workspace, file)
      return blob === undefined ? undefined : { size: blob.size, contentType: blob.contentType }
    },
    read: async (ctx, file) => {
      const blob = await storage.stat(ctx, workspace, file)
      if (blob === undefined) return undefined
      return { data: Buffer.concat(await storage.read(ctx, workspace, file)), contentType: blob.contentType }
    },
    put: async (ctx, data, contentType) => {
      const name = generateId()
      await storage.put(ctx, workspace, name, data, contentType, data.length)
      return name
    }
  }
}
