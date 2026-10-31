// SPDX-License-Identifier: EPL-2.0

import { generateId, type WorkspaceIds } from '@hcengineering/core'
import type { StorageAdapter } from '@hcengineering/server-core'
import type { PatchStore } from '../sync/types'

const PATCH_CONTENT_TYPE = 'text/x-patch'

/** Merge request diffs in the workspace's blob storage. */
export function createPatchStore (storage: Pick<StorageAdapter, 'put' | 'remove'>, workspace: WorkspaceIds): PatchStore {
  return {
    put: async (ctx, patch) => {
      const name = generateId()
      const size = Buffer.byteLength(patch)
      await storage.put(ctx, workspace, name, patch, PATCH_CONTENT_TYPE, size)
      return { file: name, size }
    },
    remove: async (ctx, file) => {
      await storage.remove(ctx, workspace, [file])
    }
  }
}
