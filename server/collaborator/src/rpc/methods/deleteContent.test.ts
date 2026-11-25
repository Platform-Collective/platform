// SPDX-License-Identifier: EPL-2.0

import type { Blob, MeasureContext, Ref } from '@hcengineering/core'
import type { Context } from '../../context'
import type { RpcMethodParams } from '../rpc'
import { deleteContent } from './deleteContent'

const documentName = 'workspace|Document|doc|content'
const blob = 'doc-content-1764100000000' as Ref<Blob>

function makeParams (remove: jest.Mock): RpcMethodParams {
  return { storageAdapter: { remove } } as unknown as RpcMethodParams
}

describe('deleteContent', () => {
  it('removes a markup blob belonging to the document attribute', async () => {
    const remove = jest.fn(async () => {})
    const context = { wsIds: { uuid: 'workspace' } } as unknown as Context

    await deleteContent({} as unknown as MeasureContext, context, documentName, { content: { content: blob } }, makeParams(remove))

    expect(remove).toHaveBeenCalledWith({}, context.wsIds, [blob])
  })

  it.each(['other-content-1764100000000', 'doc-other-1764100000000', 'doc-content-invalid'])(
    'rejects a blob outside the document attribute: %s',
    async (value) => {
      const remove = jest.fn(async () => {})
      const context = { wsIds: { uuid: 'workspace' } } as unknown as Context

      await expect(
        deleteContent(
          {} as unknown as MeasureContext,
          context,
          documentName,
          { content: { content: value as Ref<Blob> } },
          makeParams(remove)
        )
      ).rejects.toThrow('Content blob does not belong to this document')
      expect(remove).not.toHaveBeenCalled()
    }
  )
})
