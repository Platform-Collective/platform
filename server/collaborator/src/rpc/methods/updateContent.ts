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

import {
  CONTENT_NOTICE_KEY,
  CONTENT_NOTICE_MAP,
  parseCollaborationNotice,
  type UpdateContentRequest,
  type UpdateContentResponse
} from '@hcengineering/collaborator-client'
import { MeasureContext } from '@hcengineering/core'
import { applyUpdate, encodeStateAsUpdate } from 'yjs'
import { Context } from '../../context'
import { RpcMethodParams } from '../rpc'

export async function updateContent (
  ctx: MeasureContext,
  context: Context,
  documentName: string,
  payload: UpdateContentRequest,
  params: RpcMethodParams
): Promise<UpdateContentResponse> {
  const { content, notice: rawNotice } = payload
  const { hocuspocus, transformer } = params

  const notice = parseCollaborationNotice(rawNotice)
  if (rawNotice !== undefined && notice === undefined) {
    throw new Error('Invalid collaboration notice')
  }

  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    throw new Error('Invalid document content')
  }
  const fields = Object.entries(content)
  if (fields.some(([field, markup]) => field === CONTENT_NOTICE_MAP || typeof markup !== 'string')) {
    throw new Error('Invalid document content')
  }

  const updates = ctx.withSync('transform', {}, () =>
    fields.map(([field, markup]) => ({ field, update: encodeStateAsUpdate(transformer.toYdoc(markup, field)) }))
  )

  const connection = await ctx.with('connect', {}, () => {
    return hocuspocus.openDirectConnection(documentName, context)
  })

  try {
    await ctx.with('update', {}, () =>
      connection.transact((document) => {
        // Resolve shared types before changing content. Yjs does not roll back transactions on exceptions.
        const fragments = updates.map(({ field, update }) => ({ fragment: document.getXmlFragment(field), update }))
        const notices = notice === undefined ? undefined : document.getMap(CONTENT_NOTICE_MAP)

        document.transact(() => {
          for (const { fragment, update } of fragments) {
            fragment.delete(0, fragment.length)
            applyUpdate(document, update)
          }
          if (notice !== undefined) notices?.set(CONTENT_NOTICE_KEY, notice)
        }, connection)
      })
    )
  } finally {
    await connection.disconnect()
  }

  return {}
}
