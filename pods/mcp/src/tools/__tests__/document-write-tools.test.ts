// SPDX-License-Identifier: EPL-2.0

import { type TxOperations } from '@hcengineering/core'
import document from '@hcengineering/document'
import { makeRank } from '@hcengineering/rank'

import { fakeIdentity, fakeMeasureContext } from '../../__tests__/test-doubles'
import { toolContext, type ToolContext } from '../../mcp/tool'
import { type AccountApi } from '../../platform/account-api'
import { type MarkupWriter } from '../../platform/markup-reader'
import { type WorkspaceSession } from '../../platform/workspace-client-provider'
import { createDocumentTool, updateDocumentTool } from '../document-write-tools'

type Row = Record<string, unknown>

interface Recorded {
  createDoc: Array<{ cls: string, space: string, values: Row, id: string }>
  updateDoc: Array<{ id: string, ops: Row }>
  findOne: Array<{ cls: string, query: Row, options?: Row }>
}

interface Script {
  teamspace?: Row
  parent?: Row
  lastSibling?: Row
  page?: Row
}

function setup (script: Script, writer?: MarkupWriter): { ctx: ToolContext, recorded: Recorded } {
  const recorded: Recorded = { createDoc: [], updateDoc: [], findOne: [] }
  const client = {
    findOne: async (cls: string, query: Row, options?: Row) => {
      recorded.findOne.push({ cls, query, options })
      if (cls === document.class.Teamspace) return script.teamspace
      // The parent lookup filters by _id, the sibling lookup sorts by rank, the page lookup is by _id alone.
      if (options?.sort !== undefined) return script.lastSibling
      if (query.space !== undefined) return script.parent
      return script.page
    },
    createDoc: async (cls: string, space: string, values: Row, id: string) => {
      recorded.createDoc.push({ cls, space, values, id })
    },
    updateDoc: async (_cls: string, _space: string, id: string, ops: Row) => {
      recorded.updateDoc.push({ id, ops })
    }
  }
  const session: WorkspaceSession = {
    client: client as unknown as TxOperations,
    accounts: Object.create(null) as AccountApi,
    identity: fakeIdentity(),
    markup: { read: async () => '' },
    markupWriter: writer
  }
  return { ctx: toolContext(session, fakeMeasureContext()), recorded }
}

function fakeWriter (): { writer: MarkupWriter, writes: string[][], updates: string[][] } {
  const writes: string[][] = []
  const updates: string[][] = []
  const writer: MarkupWriter = {
    write: async (cls, id, attribute, markdown) => {
      writes.push([cls, id, attribute, markdown])
      return `blob-${id}`
    },
    update: async (cls, id, attribute, markdown) => {
      updates.push([cls, id, attribute, markdown])
    }
  }
  return { writer, writes, updates }
}

const textOf = (result: { content: unknown[] }): string => (result.content[0] as { text: string }).text
const TEAMSPACE = { _id: 'ts-1' }

describe('huly_create_document', () => {
  it('creates a top-level page after its siblings with zeroed counters', async () => {
    const { ctx, recorded } = setup({ teamspace: TEAMSPACE, lastSibling: { rank: '0|hzzzzz:' } })

    const result = await createDocumentTool.handler(ctx, { teamspaceId: 'ts-1', title: 'Handbook' })

    expect(recorded.createDoc).toHaveLength(1)
    const { cls, space, values, id } = recorded.createDoc[0]
    expect(cls).toBe(document.class.Document)
    expect(space).toBe('ts-1')
    expect(values).toMatchObject({
      title: 'Handbook',
      content: null,
      parent: document.ids.NoParent,
      attachments: 0,
      embeddings: 0,
      labels: 0,
      comments: 0,
      references: 0
    })
    expect(String(values.rank) > '0|hzzzzz:').toBe(true)
    expect(values.rank).toBe(makeRank('0|hzzzzz:', undefined))
    expect(JSON.parse(textOf(result)).id).toBe(id)
  })

  it('ranks the first page of an empty teamspace without a previous rank', async () => {
    const { ctx, recorded } = setup({ teamspace: TEAMSPACE })

    await createDocumentTool.handler(ctx, { teamspaceId: 'ts-1', title: 'First' })

    expect(recorded.createDoc[0].values.rank).toBe(makeRank(undefined, undefined))
  })

  it('stores the body through the writer and keeps the returned reference', async () => {
    const { writer, writes } = fakeWriter()
    const { ctx, recorded } = setup({ teamspace: TEAMSPACE }, writer)

    await createDocumentTool.handler(ctx, { teamspaceId: 'ts-1', title: 'Page', content: '# Hi\n\nBody' })

    const { id, values } = recorded.createDoc[0]
    expect(writes).toEqual([[document.class.Document, id, 'content', '# Hi\n\nBody']])
    expect(values.content).toBe(`blob-${id}`)
  })

  it('refuses a body without a writer before creating anything', async () => {
    const { ctx, recorded } = setup({ teamspace: TEAMSPACE })

    const result = await createDocumentTool.handler(ctx, { teamspaceId: 'ts-1', title: 'Page', content: 'Body' })

    expect(textOf(result)).toContain('COLLABORATOR_URL')
    expect(recorded.createDoc).toHaveLength(0)
  })

  it('nests under a parent in the same teamspace and refuses an unknown parent or teamspace', async () => {
    const nested = setup({ teamspace: TEAMSPACE, parent: { _id: 'p1' } })
    await createDocumentTool.handler(nested.ctx, { teamspaceId: 'ts-1', title: 'Child', parentDocumentId: 'p1' })
    expect(nested.recorded.createDoc[0].values.parent).toBe('p1')
    expect(nested.recorded.findOne.find((call) => call.query._id === 'p1')?.query).toEqual({ _id: 'p1', space: 'ts-1' })

    const orphan = setup({ teamspace: TEAMSPACE })
    const refusedParent = await createDocumentTool.handler(orphan.ctx, { teamspaceId: 'ts-1', title: 'x', parentDocumentId: 'nope' })
    expect(textOf(refusedParent)).toContain('No page with id nope exists in teamspace ts-1')

    const noSpace = setup({})
    const refusedSpace = await createDocumentTool.handler(noSpace.ctx, { teamspaceId: 'zzz', title: 'x' })
    expect(textOf(refusedSpace)).toContain('No teamspace with id zzz')

    expect(orphan.recorded.createDoc).toHaveLength(0)
    expect(noSpace.recorded.createDoc).toHaveLength(0)
  })
})

describe('huly_update_document', () => {
  it('replaces existing text in place and leaves the reference alone', async () => {
    const { writer, writes, updates } = fakeWriter()
    const { ctx, recorded } = setup({ page: { _id: 'd1', space: 'ts-1', content: 'blob-old' } }, writer)

    const result = await updateDocumentTool.handler(ctx, { documentId: 'd1', content: 'New body' })

    expect(updates).toEqual([[document.class.Document, 'd1', 'content', 'New body']])
    expect(writes).toHaveLength(0)
    expect(recorded.updateDoc).toHaveLength(0)
    expect(textOf(result)).toContain('content')
  })

  it('writes a first body into an empty page and stores the new reference with the title', async () => {
    const { writer, writes, updates } = fakeWriter()
    const { ctx, recorded } = setup({ page: { _id: 'd1', space: 'ts-1', content: null } }, writer)

    await updateDocumentTool.handler(ctx, { documentId: 'd1', content: 'First text', title: 'Renamed' })

    expect(writes).toEqual([[document.class.Document, 'd1', 'content', 'First text']])
    expect(updates).toHaveLength(0)
    expect(recorded.updateDoc).toEqual([{ id: 'd1', ops: { title: 'Renamed', content: 'blob-d1' } }])
  })

  it('changes only the title without touching the collaborator', async () => {
    const { writer, writes, updates } = fakeWriter()
    const { ctx, recorded } = setup({ page: { _id: 'd1', space: 'ts-1', content: 'blob-old' } }, writer)

    await updateDocumentTool.handler(ctx, { documentId: 'd1', title: 'Only title' })

    expect(recorded.updateDoc).toEqual([{ id: 'd1', ops: { title: 'Only title' } }])
    expect(writes).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('refuses an empty call, a missing page and content without a writer', async () => {
    const page = { _id: 'd1', space: 'ts-1', content: 'blob-old' }

    expect(textOf(await updateDocumentTool.handler(setup({ page }).ctx, { documentId: 'd1' }))).toContain('Nothing to change')
    expect(textOf(await updateDocumentTool.handler(setup({}).ctx, { documentId: 'zzz', title: 'x' }))).toContain('No document with id zzz')

    const noWriter = setup({ page })
    expect(textOf(await updateDocumentTool.handler(noWriter.ctx, { documentId: 'd1', content: 'x' }))).toContain('COLLABORATOR_URL')
    expect(noWriter.recorded.updateDoc).toHaveLength(0)
  })
})
