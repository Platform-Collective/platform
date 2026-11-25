// SPDX-License-Identifier: EPL-2.0

import {
  type DeleteContentRequest,
  type DeleteContentResponse,
  decodeDocumentId
} from '@hcengineering/collaborator-client'
import { type Blob, type MeasureContext, type Ref } from '@hcengineering/core'
import { Context } from '../../context'
import { RpcMethodParams } from '../rpc'

export async function deleteContent (
  ctx: MeasureContext,
  context: Context,
  documentName: string,
  payload: DeleteContentRequest,
  params: RpcMethodParams
): Promise<DeleteContentResponse> {
  const { documentId } = decodeDocumentId(documentName)
  const { objectId, objectAttr } = documentId
  const { storageAdapter } = params
  const toRemove: Array<Ref<Blob>> = []

  for (const [field, blob] of Object.entries(payload.content)) {
    const prefix = `${objectId}-${field}-`
    const timestamp = blob.startsWith(prefix) ? blob.slice(prefix.length) : ''
    if (field !== objectAttr || !/^\d+$/.test(timestamp)) {
      throw new Error('Content blob does not belong to this document')
    }
    toRemove.push(blob)
  }

  if (toRemove.length > 0) {
    await storageAdapter.remove(ctx, context.wsIds, toRemove)
  }

  return {}
}
