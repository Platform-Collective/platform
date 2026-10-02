// SPDX-License-Identifier: EPL-2.0

import { generateId, SortingOrder } from '@hcengineering/core'
import document, { type Document } from '@hcengineering/document'
import { makeRank } from '@hcengineering/rank'

import { textResult } from '../mcp/protocol'
import { objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool } from '../mcp/tool'

const NO_WRITER =
  'Document text was given but this server has no COLLABORATOR_URL configured, so nothing was changed. ' +
  'Retry without content, or ask the administrator to set COLLABORATOR_URL.'

export const createDocumentTool: HulyTool = {
  name: 'huly_create_document',
  title: 'Create a document',
  description:
    'Create a page in a document teamspace, optionally nested under another page. The content is Markdown. ' +
    'Get teamspace ids from huly_list_spaces and page ids from huly_list_documents. ' +
    'The new page is placed after its siblings.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      teamspaceId: stringProp('Teamspace id from huly_list_spaces.'),
      title: stringProp('Page title.', { minLength: 1, maxLength: 500 }),
      content: stringProp('Page body. Markdown or plain text.', { maxLength: 500_000 }),
      parentDocumentId: stringProp('Nest the page under this page id. Must be in the same teamspace.')
    },
    ['teamspaceId', 'title']
  ),
  handler: async (ctx, args) => {
    const teamspaceId = args.teamspaceId as string

    const teamspaceQuery: Record<string, unknown> = { _id: teamspaceId }
    const teamspace = await ctx.client.findOne(document.class.Teamspace, teamspaceQuery as never)
    if (teamspace === undefined) {
      return textResult(`No teamspace with id ${teamspaceId} is visible to you, so nothing was created.`, {
        created: false
      })
    }

    let parent: string = document.ids.NoParent
    if (args.parentDocumentId !== undefined) {
      const parentQuery: Record<string, unknown> = { _id: args.parentDocumentId, space: teamspaceId }
      const found = await ctx.client.findOne(document.class.Document, parentQuery as never)
      if (found === undefined) {
        return textResult(
          `No page with id ${String(args.parentDocumentId)} exists in teamspace ${teamspaceId}, so nothing was created.`,
          { created: false }
        )
      }
      parent = args.parentDocumentId as string
    }

    // Refuse before creating anything: a page without its text would look like success.
    const content = ((args.content as string | undefined) ?? '').trim()
    if (content !== '' && ctx.markupWriter === undefined) return textResult(NO_WRITER, { created: false })

    const siblingQuery: Record<string, unknown> = { space: teamspaceId, parent }
    const last = await ctx.client.findOne(document.class.Document, siblingQuery as never, {
      sort: { rank: SortingOrder.Descending },
      projection: { rank: 1 }
    })
    const rank = makeRank(last?.rank, undefined)

    const id = generateId<Document>()
    const contentRef =
      content === '' || ctx.markupWriter === undefined
        ? null
        : await ctx.markupWriter.write(document.class.Document, id, 'content', content)

    const attributes: Record<string, unknown> = {
      title: args.title,
      content: contentRef,
      attachments: 0,
      embeddings: 0,
      labels: 0,
      comments: 0,
      references: 0,
      rank,
      parent
    }
    await ctx.client.createDoc(document.class.Document, teamspaceId as never, attributes as never, id)

    return textResult(JSON.stringify({ id, title: args.title, teamspaceId, parentDocumentId: parent }, null, 2), {
      created: true,
      documentId: id
    })
  }
}

export const updateDocumentTool: HulyTool = {
  name: 'huly_update_document',
  title: 'Edit a document',
  description:
    'Change the title and/or replace the whole body of a page. Content is Markdown and REPLACES the existing text, ' +
    'so call huly_get_document first and send the full new body. Only the fields you pass change.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      documentId: stringProp('Page id from huly_list_documents.'),
      title: stringProp('New title.', { minLength: 1, maxLength: 500 }),
      content: stringProp('New full body. Markdown or plain text.', { maxLength: 500_000 })
    },
    ['documentId']
  ),
  handler: async (ctx, args) => {
    const documentId = args.documentId as string

    if (args.title === undefined && args.content === undefined) {
      return textResult('Nothing to change. Pass title and/or content.', { updated: false })
    }

    const query: Record<string, unknown> = { _id: documentId }
    const page = await ctx.client.findOne(document.class.Document, query as never)
    if (page === undefined) {
      return textResult(`No document with id ${documentId} is visible to you, so nothing was changed.`, {
        updated: false
      })
    }

    const changed: string[] = []
    const operations: Record<string, unknown> = {}
    if (args.title !== undefined) operations.title = args.title

    if (args.content !== undefined) {
      if (ctx.markupWriter === undefined) return textResult(NO_WRITER, { updated: false })
      const content = args.content as string
      if (page.content === null || page.content === undefined || page.content === '') {
        operations.content = await ctx.markupWriter.write(document.class.Document, documentId, 'content', content)
      } else {
        await ctx.markupWriter.update(document.class.Document, documentId, 'content', content)
        changed.push('content')
      }
    }

    if (Object.keys(operations).length > 0) {
      await ctx.client.updateDoc(document.class.Document, page.space, page._id, operations as never)
      changed.push(...Object.keys(operations))
    }

    return textResult(`Updated document ${documentId}: ${[...new Set(changed)].sort().join(', ')}.`, {
      updated: true,
      changed
    })
  }
}

export const documentWriteTools: HulyTool[] = [createDocumentTool, updateDocumentTool]
