// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import type { WorkspaceIds, WorkspaceUuid } from '@hcengineering/core'
import { createImageStore } from '../worker/images'
import { ctx } from './helpers/provider'

const workspace: WorkspaceIds = { uuid: 'ws1' as WorkspaceUuid, url: 'ws1', dataId: undefined }

function fakeStorage (): any {
  const blobs = new Map<string, { data: Buffer, contentType: string }>()
  return {
    blobs,
    stat: async (_ctx: unknown, _ws: unknown, name: string) => {
      const blob = blobs.get(name)
      return blob === undefined ? undefined : { _id: name, contentType: blob.contentType, size: blob.data.length }
    },
    // Storage answers in chunks
    read: async (_ctx: unknown, _ws: unknown, name: string) => {
      const data = blobs.get(name)?.data ?? Buffer.alloc(0)
      return [data.subarray(0, 2), data.subarray(2)]
    },
    put: jest.fn(async (_ctx: unknown, _ws: unknown, name: string, data: Buffer, contentType: string) => {
      blobs.set(name, { data, contentType })
      return { etag: 'e', versionId: null }
    })
  }
}

describe('createImageStore', () => {
  it('stores bytes under a new name and reads them back with their type', async () => {
    const storage = fakeStorage()
    const store = createImageStore(storage, workspace)
    const name = await store.put(ctx, Buffer.from('png-bytes'), 'image/png')
    expect(storage.put).toHaveBeenCalledWith(ctx, workspace, name, Buffer.from('png-bytes'), 'image/png', 9)
    expect(await store.read(ctx, name)).toEqual({ data: Buffer.from('png-bytes'), contentType: 'image/png' })
  })

  it('reports the size and type of a file without reading it', async () => {
    const storage = fakeStorage()
    const store = createImageStore(storage, workspace)
    const name = await store.put(ctx, Buffer.from('png-bytes'), 'image/png')
    expect(await store.stat(ctx, name)).toEqual({ size: 9, contentType: 'image/png' })
    expect(await store.stat(ctx, 'nope')).toBeUndefined()
  })

  it('reads nothing for a missing file', async () => {
    expect(await createImageStore(fakeStorage(), workspace).read(ctx, 'nope')).toBeUndefined()
  })
})
