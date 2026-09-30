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

import core, { type Hierarchy, type TxOperations } from '@hcengineering/core'

import { fakeIdentity, fakeMeasureContext } from '../../__tests__/test-doubles'
import { toolContext, type ToolContext } from '../../mcp/tool'
import { type WorkspaceSession } from '../../platform/workspace-client-provider'
import { describeClassTool, findTool, getDocTool, listClassesTool } from '../model-tools'

type Row = Record<string, unknown>

const ISSUE = 'tracker:class:Issue'
const SPACE = 'core:class:Space'
const ABSTRACT = 'core:class:Abstract'

const CLASSES: Record<string, { extends?: string, domain?: string, mixin?: boolean }> = {
  [core.class.Doc]: {},
  [SPACE]: { extends: core.class.Doc, domain: 'space' },
  [ISSUE]: { extends: core.class.Doc, domain: 'task' },
  'tracker:mixin:Extra': { extends: ISSUE, domain: 'task', mixin: true },
  [ABSTRACT]: { extends: core.class.Doc }
}

const ATTRIBUTES = new Map<string, Row>([
  ['title', { name: 'title', type: { _class: 'core:class:TypeString' }, required: true }],
  ['assignee', { name: 'assignee', type: { _class: 'core:class:RefTo', to: 'contact:class:Person' } }],
  ['labels', { name: 'labels', type: { _class: 'core:class:Collection', of: 'tags:class:TagReference' } }],
  ['tags', { name: 'tags', type: { _class: 'core:class:ArrOf', of: { _class: 'core:class:TypeString' } } }],
  ['description', { name: 'description', type: { _class: core.class.TypeCollaborativeDoc } }],
  ['notes', { name: 'notes', type: { _class: core.class.TypeMarkup } }],
  ['size', { name: 'size', type: { _class: 'core:class:TypeNumber' }, isCustom: true }],
  ['secretField', { name: 'secretField', type: { _class: 'core:class:TypeString' }, hidden: true }]
])

const fakeHierarchy = (): Hierarchy => {
  const hierarchy = {
    hasClass: (id: string) => id in CLASSES,
    findClass: (id: string) => (id in CLASSES ? { _id: id, extends: CLASSES[id].extends } : undefined),
    findDomain: (id: string) => {
      let current: string | undefined = id
      while (current !== undefined && current in CLASSES) {
        if (CLASSES[current].domain !== undefined) return CLASSES[current].domain
        current = CLASSES[current].extends
      }
      return undefined
    },
    isMixin: (id: string) => CLASSES[id]?.mixin === true,
    getDescendants: (id: string) => Object.keys(CLASSES).filter((key) => key !== id && (id === core.class.Doc || CLASSES[key].extends === id)),
    getAllAttributes: () => ATTRIBUTES
  }
  return hierarchy as unknown as Hierarchy
}

interface Recorded {
  findAll: Array<{ cls: string, query: Row, options: Row }>
}

function scripted (docs: Row[] = [], total?: number, one?: Row): { client: TxOperations, recorded: Recorded } {
  const recorded: Recorded = { findAll: [] }
  const client = {
    getHierarchy: fakeHierarchy,
    findAll: async (cls: string, query: Row, options: Row) => {
      recorded.findAll.push({ cls, query, options })
      return Object.assign([...docs], { total: total ?? docs.length })
    },
    findOne: async () => one
  }
  return { client: client as unknown as TxOperations, recorded }
}

function context (client: TxOperations, read: (ref: string) => Promise<string> = async () => ''): ToolContext {
  const session: WorkspaceSession = {
    client,
    accounts: Object.create(null) as WorkspaceSession['accounts'],
    identity: fakeIdentity(),
    markup: { read }
  }
  return toolContext(session, fakeMeasureContext())
}

const payload = (result: { content: unknown[] }): any => JSON.parse((result.content[0] as { text: string }).text)
const textOf = (result: { content: unknown[] }): string => (result.content[0] as { text: string }).text

describe('huly_list_classes', () => {
  it('lists only queryable classes by default and reports the total', async () => {
    const result = await listClassesTool.handler(context(scripted().client), {})

    const ids = payload(result).classes.map((row: Row) => row.id)
    expect(ids).toEqual([SPACE, ISSUE, 'tracker:mixin:Extra'].sort())
    expect(ids).not.toContain(ABSTRACT)
    expect(ids).not.toContain(core.class.Doc)
  })

  it('filters by search, kind and ancestor, and can include abstract classes', async () => {
    const ctx = context(scripted().client)

    const bySearch = payload(await listClassesTool.handler(ctx, { search: 'TRACKER' }))
    expect(bySearch.classes.map((row: Row) => row.id)).toEqual([ISSUE, 'tracker:mixin:Extra'])

    const mixins = payload(await listClassesTool.handler(ctx, { kind: 'mixin' }))
    expect(mixins.classes.map((row: Row) => row.id)).toEqual(['tracker:mixin:Extra'])

    const withAbstract = payload(await listClassesTool.handler(ctx, { includeAbstract: true, search: 'abstract' }))
    expect(withAbstract.classes[0]).toMatchObject({ id: ABSTRACT, queryable: false, domain: null })

    const derived = payload(await listClassesTool.handler(ctx, { extends: ISSUE }))
    expect(derived.classes.map((row: Row) => row.id)).toEqual([ISSUE, 'tracker:mixin:Extra'])
  })

  it('caps the page and still reports the full match count', async () => {
    const result = payload(await listClassesTool.handler(context(scripted().client), { limit: 2 }))

    expect(result.returned).toBe(2)
    expect(result.total).toBe(3)
  })

  it('explains an unknown extends class', async () => {
    const result = await listClassesTool.handler(context(scripted().client), { extends: 'nope:class:Nope' })

    expect(textOf(result)).toContain('not a class in this workspace')
  })
})

describe('huly_describe_class', () => {
  it('describes field types, separates collections, flags custom fields and hides hidden ones', async () => {
    const result = payload(await describeClassTool.handler(context(scripted().client), { classId: ISSUE }))

    expect(result).toMatchObject({ id: ISSUE, kind: 'class', extends: core.class.Doc, domain: 'task', queryable: true })
    const byName = Object.fromEntries(result.fields.map((field: Row) => [field.name, field]))
    expect(byName.title).toMatchObject({ type: 'String', required: true, custom: false })
    expect(byName.assignee).toMatchObject({ type: 'Ref', to: 'contact:class:Person' })
    expect(byName.tags).toMatchObject({ type: 'Array', of: { type: 'String' } })
    expect(byName.size).toMatchObject({ custom: true })
    expect(byName.secretField).toBeUndefined()
    expect(result.collections).toEqual([{ name: 'labels', of: 'tags:class:TagReference' }])
  })

  it('points at the discovery tool for an unknown class', async () => {
    const result = await describeClassTool.handler(context(scripted().client), { classId: 'nope:class:Nope' })

    expect(textOf(result)).toContain('huly_list_classes')
  })
})

describe('huly_find', () => {
  const docs = [
    { _id: 'a', _class: ISSUE, title: 'One', extra: 1 },
    { _id: 'b', _class: ISSUE, title: 'Two', extra: 2 }
  ]

  it('passes the query through, sorts by modification time by default and reports the total', async () => {
    const { client, recorded } = scripted(docs, 42)

    const result = payload(await findTool.handler(context(client), { classId: ISSUE, query: { space: 's1' }, limit: 2 }))

    expect(recorded.findAll[0]).toMatchObject({
      cls: ISSUE,
      query: { space: 's1' },
      options: { limit: 2, sort: { modifiedOn: -1 }, total: true }
    })
    expect(result).toMatchObject({ total: 42, returned: 2 })
  })

  it('honours an explicit sort direction', async () => {
    const { client, recorded } = scripted(docs)

    await findTool.handler(context(client), { classId: ISSUE, sortBy: 'title', ascending: true })

    expect(recorded.findAll[0].options.sort).toEqual({ title: 1 })
  })

  it('projects fields but always keeps the id and class', async () => {
    const result = payload(await findTool.handler(context(scripted(docs).client), { classId: ISSUE, fields: ['title'] }))

    expect(result.documents[0]).toEqual({ _id: 'a', _class: ISSUE, title: 'One' })
  })

  it('refuses an abstract or unknown class without querying', async () => {
    const { client, recorded } = scripted(docs)

    const abstract = await findTool.handler(context(client), { classId: ABSTRACT })
    const unknown = await findTool.handler(context(client), { classId: 'nope:class:Nope' })

    expect(textOf(abstract)).toContain('abstract class')
    expect(textOf(unknown)).toContain('huly_list_classes')
    expect(recorded.findAll).toHaveLength(0)
  })

  it('cuts an oversized result to fit and says so', async () => {
    const big = Array.from({ length: 40 }, (_, index) => ({ _id: String(index), _class: ISSUE, body: 'x'.repeat(5000) }))

    const result = payload(await findTool.handler(context(scripted(big).client), { classId: ISSUE }))

    expect(result.truncated).toBe(true)
    expect(result.returned).toBeLessThan(40)
    expect(result.total).toBe(40)
  })

  it('suggests checking field names when nothing matches', async () => {
    const result = await findTool.handler(context(scripted([]).client), { classId: ISSUE, query: { nope: 1 } })

    expect(textOf(result)).toContain('huly_describe_class')
  })
})

describe('huly_get_doc', () => {
  const inline = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inline body' }] }] })
  const doc = { _id: 'a', _class: ISSUE, title: 'One', description: 'blob-ref-1', notes: inline, size: 3 }

  it('resolves blob references and inline markup to Markdown and leaves other fields alone', async () => {
    const read = jest.fn(async (ref: string) => (ref === 'blob-ref-1' ? 'Blob body' : ''))

    const result = await getDocTool.handler(context(scripted([], 0, doc).client, read), { classId: ISSUE, id: 'a' })

    expect(payload(result)).toMatchObject({ title: 'One', description: 'Blob body', notes: 'Inline body', size: 3 })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reports a missing document without throwing', async () => {
    const result = await getDocTool.handler(context(scripted([], 0, undefined).client), { classId: ISSUE, id: 'zzz' })

    expect(textOf(result)).toContain('No tracker:class:Issue with id zzz')
  })

  it('skips empty rich-text fields', async () => {
    const read = jest.fn(async () => 'never')

    await getDocTool.handler(context(scripted([], 0, { ...doc, description: '', notes: '' }).client, read), {
      classId: ISSUE,
      id: 'a'
    })

    expect(read).not.toHaveBeenCalled()
  })
})
