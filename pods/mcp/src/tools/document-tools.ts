/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { SortingOrder } from '@hcengineering/core'
import doc from '@hcengineering/document'

import { truncate } from '../platform/markup-reader'
import { textResult } from '../mcp/protocol'
import { numberProp, objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool } from '../mcp/tool'
import { clampLimit, toIso } from './shared'

/** Bodies can be very large; keep responses inside a model's context window. */
const BODY_CHAR_LIMIT = 20_000

interface DocumentRow {
  _id: string
  title: string
  space: string
  modifiedOn: number
  createdOn: number
  size: number
  content?: string | null
}

export const listDocumentsTool: HulyTool = {
  name: 'huly_list_documents',
  title: 'List documents',
  description:
    'List documents in a teamspace or drive, most recently modified first. ' +
    'Use the id with huly_get_document to read the body. ' +
    'Get space ids from huly_list_spaces.',
  readOnly: true,
  inputSchema: objectSchema({
    spaceId: stringProp('Teamspace, project or drive id to list documents from.'),
    search: stringProp('Case-insensitive substring match on the document title.'),
    limit: { type: 'integer', description: 'Maximum documents to return (1-200, default 50).', default: 50 }
  }),
  handler: async (ctx, args) => {
    const query: Record<string, unknown> = {}
    if (args.spaceId !== undefined) query.space = args.spaceId
    if (args.search !== undefined) query.title = { $regex: escapeRegExp(String(args.search)), $options: 'i' }

    const documents = (await ctx.client.findAll(doc.class.Document, query as never, {
      limit: clampLimit(args.limit),
      sort: { modifiedOn: SortingOrder.Descending }
    })) as unknown as DocumentRow[]

    const rows = documents.map((document) => ({
      id: document._id,
      title: document.title,
      spaceId: document.space,
      size: document.size,
      modifiedOn: toIso(document.modifiedOn)
    }))

    if (rows.length === 0) {
      return textResult('No documents matched.', { documents: [] })
    }

    return textResult(JSON.stringify({ documents: rows }, null, 2), { documents: rows })
  }
}

export const getDocumentTool: HulyTool = {
  name: 'huly_get_document',
  title: 'Read document',
  description:
    'Read one document and return its text content. Long documents are truncated, and the tool ' +
    'result reports whether truncation happened.',
  readOnly: true,
  inputSchema: objectSchema(
    {
      documentId: stringProp('Document id from huly_list_documents.'),
      maxChars: numberProp('Maximum characters of body to return (default 20000).', {
        minimum: 100,
        maximum: 100_000,
        default: BODY_CHAR_LIMIT
      })
    },
    ['documentId']
  ),
  handler: async (ctx, args) => {
    const documentId = args.documentId as string

    const documentIdQuery: Record<string, unknown> = { _id: documentId }
    const document = (await ctx.client.findOne(doc.class.Document, documentIdQuery as never)) as unknown as
      | DocumentRow
      | undefined

    if (document === undefined) {
      return textResult(
        `No document with id ${documentId} is visible to you. It may have been deleted or live in a ` +
          'space you are not a member of.',
        { found: false }
      )
    }

    const maxChars = typeof args.maxChars === 'number' ? args.maxChars : BODY_CHAR_LIMIT
    const body = await ctx.markup.read(document.content as string)
    const truncatedBody = truncate(body.trim(), maxChars)

    return textResult(
      JSON.stringify(
        {
          id: document._id,
          title: document.title,
          spaceId: document.space,
          modifiedOn: toIso(document.modifiedOn),
          content: truncatedBody
        },
        null,
        2
      ),
      {
        found: true,
        documentId: document._id,
        title: document.title,
        truncated: body.length > maxChars
      }
    )
  }
}

function escapeRegExp (value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const documentTools: HulyTool[] = [listDocumentsTool, getDocumentTool]
