// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import type { WorkspaceIds, WorkspaceUuid } from '@hcengineering/core'
import { createPatchStore } from '../worker/patches'
import { ctx } from './helpers/provider'

const workspace: WorkspaceIds = { uuid: 'ws1' as WorkspaceUuid, url: 'ws1', dataId: undefined }

describe('createPatchStore', () => {
  it('writes every diff to a new blob as text/x-patch with its byte size', async () => {
    const storage = { put: jest.fn(async () => ({ etag: 'e', versionId: null })), remove: jest.fn(async () => {}) }
    const store = createPatchStore(storage as any, workspace)
    const first = await store.put(ctx, 'diff ä')
    const second = await store.put(ctx, 'x')
    expect(first.size).toBe(Buffer.byteLength('diff ä'))
    expect(second.file).not.toBe(first.file)
    expect(storage.put).toHaveBeenCalledWith(ctx, workspace, first.file, 'diff ä', 'text/x-patch', first.size)
  })

  it('removes a blob', async () => {
    const storage = { put: jest.fn(), remove: jest.fn(async () => {}) }
    await createPatchStore(storage as any, workspace).remove(ctx, 'blob-1')
    expect(storage.remove).toHaveBeenCalledWith(ctx, workspace, ['blob-1'])
  })
})
