// SPDX-License-Identifier: EPL-2.0

import contact from '@hcengineering/contact'
import core, { AccountRole, type AccountUuid, type Hierarchy, type TxOperations } from '@hcengineering/core'
import document from '@hcengineering/document'
import tags from '@hcengineering/tags'
import task from '@hcengineering/task'
import tracker from '@hcengineering/tracker'

import { fakeIdentity, fakeMeasureContext } from '../../__tests__/test-doubles'
import { toolContext, type ToolContext } from '../../mcp/tool'
import { type AccountApi } from '../../platform/account-api'
import { type WorkspaceSession } from '../../platform/workspace-client-provider'
import { createDocTool, deleteDocTool, updateDocTool } from '../generic-write-tools'

type Row = Record<string, unknown>

const ME = 'account-1' as AccountUuid
const PROJECT = 'proj-1'

const str = { _class: 'core:class:TypeString' }
const markup = { _class: core.class.TypeMarkup }
const ref = { _class: 'core:class:RefTo', to: 'x' }
const date = { _class: 'core:class:TypeDate' }
const bool = { _class: 'core:class:TypeBoolean' }
const arr = { _class: 'core:class:ArrOf', of: str }
const num = { _class: 'core:class:TypeNumber' }
const attrs = (entries: Record<string, Row>): Map<string, Row> => new Map(Object.entries(entries))

// `members` and `owners` are ArrOf(TypeAccountUuid()) in the model, so push and
// pull must accept one account id and nothing else.
const accountId = { _class: 'core:class:TypeAccountUuid' }
const idArr = { _class: 'core:class:ArrOf', of: accountId }

const ATTRIBUTES: Record<string, Map<string, Row>> = {
  [tracker.class.Component]: attrs({ label: { type: str }, description: { type: markup }, lead: { type: ref } }),
  [tracker.class.Milestone]: attrs({
    label: { type: str },
    description: { type: markup },
    status: { type: { _class: 'tracker:class:TypeMilestoneStatus' } },
    startDate: { type: date },
    targetDate: { type: date }
  }),
  [tracker.class.IssueTemplate]: attrs({
    title: { type: str },
    description: { type: markup },
    priority: { type: { _class: 'tracker:class:TypeIssuePriority' } },
    assignee: { type: ref },
    component: { type: ref },
    milestone: { type: ref },
    estimation: { type: num },
    labels: { type: arr }
  }),
  [tags.class.TagElement]: attrs({ title: { type: str }, description: { type: str }, color: { type: num }, targetClass: { type: ref }, category: { type: ref } }),
  [document.class.Teamspace]: attrs({
    name: { type: str },
    description: { type: str },
    private: { type: bool },
    archived: { type: bool },
    members: { type: idArr },
    owners: { type: idArr },
    autoJoin: { type: bool }
  }),
  [tracker.class.Project]: attrs({
    name: { type: str },
    description: { type: str },
    archived: { type: bool },
    members: { type: idArr },
    owners: { type: idArr }
  })
}

const DERIVED: Record<string, string[]> = {
  [tracker.class.Project]: [core.class.Space, tracker.class.Project],
  [document.class.Teamspace]: [core.class.Space, document.class.Teamspace]
}

const hierarchy = (): Hierarchy =>
  ({
    getAllAttributes: (id: string) => ATTRIBUTES[id] ?? new Map(),
    isDerived: (id: string, from: string) => id === from || (DERIVED[id] ?? []).includes(from)
  }) as unknown as Hierarchy

interface Calls {
  createDoc: Array<{ cls: string, space: string, values: Row, id: string }>
  updateDoc: Array<{ cls: string, space: string, id: string, ops: Row }>
  removeDoc: Array<[string, string, string]>
  removeCollection: unknown[][]
}

type FindAll = (cls: string, query: Row, options?: { limit?: number }) => Row[]

interface Script {
  findOne?: Record<string, Row | undefined>
  /** Per class, or a function for fakes that must react to the query. */
  findAll?: Record<string, Row[]> | FindAll
  /** Lets a fake apply a recorded write, as the workspace would. */
  onOps?: (id: string, ops: Row) => void
  role?: AccountRole
}

function setup (script: Script = {}): { ctx: ToolContext, calls: Calls } {
  const calls: Calls = { createDoc: [], updateDoc: [], removeDoc: [], removeCollection: [] }
  const client = {
    getHierarchy: hierarchy,
    findOne: async (cls: string) => script.findOne?.[cls],
    findAll: async (cls: string, query: Row, options?: { limit?: number }) => {
      if (typeof script.findAll === 'function') {
        return script.findAll(cls, query, options)
      }
      return script.findAll?.[cls] ?? []
    },
    createDoc: async (cls: string, space: string, values: Row, id: string) => {
      calls.createDoc.push({ cls, space, values, id })
    },
    updateDoc: async (cls: string, space: string, id: string, ops: Row) => {
      calls.updateDoc.push({ cls, space, id, ops })
      script.onOps?.(id, ops)
    },
    removeDoc: async (cls: string, space: string, id: string) => {
      calls.removeDoc.push([cls, space, id])
    },
    removeCollection: async (...args: unknown[]) => {
      calls.removeCollection.push(args)
    }
  }
  const accounts = {
    getWorkspaceMembers: async () => [{ person: ME, role: script.role ?? AccountRole.User }]
  }
  const session: WorkspaceSession = {
    client: client as unknown as TxOperations,
    accounts: accounts as unknown as AccountApi,
    identity: fakeIdentity({ account: ME }),
    markup: { read: async () => '' }
  }
  return { ctx: toolContext(session, fakeMeasureContext()), calls }
}

const textOf = (result: { content: unknown[] }): string => (result.content[0] as { text: string }).text
const projectSpace = { _id: PROJECT, _class: tracker.class.Project }

/**
 * A query-aware fake for issues linked to one document: findAll only returns
 * issues that still carry the reference, and the recorded updates clear it, so
 * a sweep has to come back batch after batch until nothing matches. That is the
 * contract detachFromIssues relies on to know when it is finished.
 */
function linkedIssues (
  ids: string[],
  field: 'milestone' | 'component',
  target: string
): { findAll: FindAll, onOps: (id: string, ops: Row) => void, queries: Row[], limits: number[] } {
  const issues: Row[] = ids.map((id) => ({ _id: id, space: PROJECT, [field]: target }))
  const queries: Row[] = []
  const limits: number[] = []
  return {
    queries,
    limits,
    findAll: (_cls, query, options) => {
      queries.push(query)
      limits.push(options?.limit ?? 0)
      return issues.filter((issue) => issue[field] === query[field]).slice(0, options?.limit)
    },
    onOps: (id, ops) => {
      const issue = issues.find((row) => row._id === id)
      if (issue !== undefined) Object.assign(issue, ops)
    }
  }
}

describe('huly_create_doc', () => {
  it('refuses a class without a create profile and lists what is supported', async () => {
    const { ctx, calls } = setup()

    const result = await createDocTool.handler(ctx, { classId: 'contact:class:Person', data: {} })

    expect(textOf(result)).toContain('cannot be created')
    expect(textOf(result)).toContain(tracker.class.Component)
    expect(calls.createDoc).toHaveLength(0)
  })

  it('refuses fields outside the profile, unknown fields and missing required fields', async () => {
    const { ctx, calls } = setup({ findOne: { [core.class.Space]: projectSpace } })

    const counter = await createDocTool.handler(ctx, { classId: tracker.class.Component, spaceId: PROJECT, data: { label: 'x', comments: 9 } })
    const missing = await createDocTool.handler(ctx, { classId: tracker.class.Component, spaceId: PROJECT, data: {} })
    const wrongType = await createDocTool.handler(ctx, { classId: tracker.class.Component, spaceId: PROJECT, data: { label: 5 } })

    expect(textOf(counter)).toContain('"comments" cannot be set')
    expect(textOf(missing)).toContain('Missing required field(s) for tracker:class:Component: label')
    expect(textOf(wrongType)).toContain('"label" must be a string')
    expect(calls.createDoc).toHaveLength(0)
  })

  it('needs a space of the right class for project-scoped classes', async () => {
    const noSpace = setup()
    expect(textOf(await createDocTool.handler(noSpace.ctx, { classId: tracker.class.Component, data: { label: 'x' } }))).toContain('spaceId is required')

    const missing = setup()
    expect(textOf(await createDocTool.handler(missing.ctx, { classId: tracker.class.Component, spaceId: 'nope', data: { label: 'x' } }))).toContain('No space with id nope')

    const wrongClass = setup({ findOne: { [core.class.Space]: { _id: 'w', _class: core.class.Space } } })
    const refused = await createDocTool.handler(wrongClass.ctx, { classId: tracker.class.Component, spaceId: 'w', data: { label: 'x' } })
    expect(textOf(refused)).toContain('can only be created in a tracker:class:Project')
    expect(wrongClass.calls.createDoc).toHaveLength(0)
  })

  it('creates a component with defaults, rich text converted and the generated id returned', async () => {
    const { ctx, calls } = setup({ findOne: { [core.class.Space]: projectSpace } })

    const result = await createDocTool.handler(ctx, {
      classId: tracker.class.Component,
      spaceId: PROJECT,
      data: { label: 'Backend', description: 'Core **services**' }
    })

    expect(calls.createDoc).toHaveLength(1)
    const [call] = calls.createDoc
    expect(call).toMatchObject({ cls: tracker.class.Component, space: PROJECT })
    expect(call.values).toMatchObject({ label: 'Backend', lead: null, comments: 0, attachments: 0 })
    expect(String(call.values.description)).toContain('"type":"doc"')
    expect(JSON.parse(textOf(result)).id).toBe(call.id)
  })

  it('converts milestone status names and ISO dates to their stored form', async () => {
    const { ctx, calls } = setup({ findOne: { [core.class.Space]: projectSpace } })

    await createDocTool.handler(ctx, {
      classId: tracker.class.Milestone,
      spaceId: PROJECT,
      data: { label: 'Beta', status: 'InProgress', targetDate: '2026-12-31T00:00:00Z' }
    })
    const bad = await createDocTool.handler(ctx, { classId: tracker.class.Milestone, spaceId: PROJECT, data: { label: 'x', status: 'Done' } })

    expect(calls.createDoc[0].values).toMatchObject({ status: 1, targetDate: Date.parse('2026-12-31T00:00:00Z'), startDate: null })
    expect(textOf(bad)).toContain('"status" must be one of: Planned, InProgress, Completed, Canceled')
  })

  it('derives the kind of an issue template from the project task type, or refuses without one', async () => {
    const withType = setup({
      findOne: { [core.class.Space]: projectSpace, [tracker.class.Project]: { type: 'pt' }, [task.class.TaskType]: { _id: 'kind-1' } }
    })
    await createDocTool.handler(withType.ctx, { classId: tracker.class.IssueTemplate, spaceId: PROJECT, data: { title: 'Bug', priority: 'High' } })
    expect(withType.calls.createDoc[0].values).toMatchObject({ kind: 'kind-1', priority: 2, comments: 0 })

    const withoutType = setup({ findOne: { [core.class.Space]: projectSpace, [tracker.class.Project]: { type: 'pt' } } })
    const refused = await createDocTool.handler(withoutType.ctx, { classId: tracker.class.IssueTemplate, spaceId: PROJECT, data: { title: 'Bug' } })
    expect(textOf(refused)).toContain('no issue task type')
    expect(withoutType.calls.createDoc).toHaveLength(0)
  })

  it('creates a label in the workspace space and a teamspace with the creator as member and owner', async () => {
    const { ctx, calls } = setup()

    await createDocTool.handler(ctx, { classId: tags.class.TagElement, data: { title: 'urgent' } })
    await createDocTool.handler(ctx, { classId: document.class.Teamspace, data: { name: 'Handbook' } })

    expect(calls.createDoc[0]).toMatchObject({ cls: tags.class.TagElement, space: core.space.Workspace })
    expect(calls.createDoc[0].values).toMatchObject({ title: 'urgent', targetClass: tracker.class.Issue, category: tags.category.NoCategory })
    expect(typeof calls.createDoc[0].values.color).toBe('number')
    expect(calls.createDoc[1]).toMatchObject({ cls: document.class.Teamspace, space: core.space.Space })
    expect(calls.createDoc[1].values).toMatchObject({ name: 'Handbook', members: [ME], owners: [ME], private: false })
  })

  it('keeps the creator in members and owners when the caller passes empty lists', async () => {
    const { ctx, calls } = setup()

    await createDocTool.handler(ctx, {
      classId: document.class.Teamspace,
      data: { name: 'Handbook', members: [], owners: [] }
    })

    expect(calls.createDoc).toHaveLength(1)
    expect(calls.createDoc[0].values).toMatchObject({ members: [ME], owners: [ME] })
  })

  it('adds the creator to caller-supplied members and owners instead of replacing them', async () => {
    const { ctx, calls } = setup()

    await createDocTool.handler(ctx, {
      classId: document.class.Teamspace,
      data: { name: 'Handbook', members: ['a2', 'a3'], owners: ['a2'] }
    })

    expect(calls.createDoc[0].values).toMatchObject({ members: [ME, 'a2', 'a3'], owners: [ME, 'a2'] })
  })
})

describe('huly_update_doc', () => {
  const component = { _id: 'c1', space: PROJECT }

  it('sets converted fields on an existing document', async () => {
    const { ctx, calls } = setup({ findOne: { [tracker.class.Component]: component } })

    await updateDocTool.handler(ctx, { classId: tracker.class.Component, id: 'c1', data: { label: 'Renamed', lead: null } })

    expect(calls.updateDoc).toEqual([{ cls: tracker.class.Component, space: PROJECT, id: 'c1', ops: { label: 'Renamed', lead: null } }])
  })

  it('refuses unsupported classes, read-only fields, empty updates and missing documents', async () => {
    const { ctx, calls } = setup({ findOne: { [tracker.class.Component]: component } })

    expect(textOf(await updateDocTool.handler(ctx, { classId: tracker.class.Issue, id: 'i', data: { title: 'x' } }))).toContain('cannot be updated')
    expect(textOf(await updateDocTool.handler(ctx, { classId: tracker.class.Component, id: 'c1', data: { comments: 1 } }))).toContain('cannot be set')
    expect(textOf(await updateDocTool.handler(ctx, { classId: tracker.class.Component, id: 'c1' }))).toContain('Nothing to change')
    expect(textOf(await updateDocTool.handler(setup().ctx, { classId: tracker.class.Component, id: 'zzz', data: { label: 'x' } }))).toContain('No tracker:class:Component with id zzz')
    expect(calls.updateDoc).toHaveLength(0)
  })

  it('adds and removes array items only on allowed fields', async () => {
    const space = { _id: 's1', space: core.space.Space, owners: [ME] }
    const { ctx, calls } = setup({ findOne: { [document.class.Teamspace]: space } })

    await updateDocTool.handler(ctx, { classId: document.class.Teamspace, id: 's1', push: { members: 'a2' }, pull: { owners: 'a3' } })
    const bad = await updateDocTool.handler(ctx, { classId: document.class.Teamspace, id: 's1', push: { name: 'x' } })

    expect(calls.updateDoc[0].ops).toEqual({ $push: { members: 'a2' }, $pull: { owners: 'a3' } })
    expect(textOf(bad)).toContain('"name" cannot be added to or removed from')
    expect(calls.updateDoc).toHaveLength(1)
  })

  it('refuses a push or pull item that is not the field element type, and writes nothing', async () => {
    const space = { _id: 's1', space: core.space.Space, owners: [ME] }
    const { ctx, calls } = setup({ findOne: { [document.class.Teamspace]: space } })

    const numberItem = await updateDocTool.handler(ctx, { classId: document.class.Teamspace, id: 's1', push: { members: 123 } })
    const objectItem = await updateDocTool.handler(ctx, { classId: document.class.Teamspace, id: 's1', push: { owners: { nested: true } } })
    const wholeList = await updateDocTool.handler(ctx, { classId: document.class.Teamspace, id: 's1', pull: { members: ['a2'] } })

    expect(textOf(numberItem)).toContain('"members" expects a single account id')
    expect(textOf(objectItem)).toContain('"owners" expects a single account id')
    expect(textOf(wholeList)).toContain('push and pull take ONE item at a time')
    expect(calls.updateDoc).toHaveLength(0)

    // Only the value was refused: a correctly typed item still goes through.
    await updateDocTool.handler(ctx, { classId: document.class.Teamspace, id: 's1', push: { members: 'a4' } })
    expect(calls.updateDoc).toHaveLength(1)
    expect(calls.updateDoc[0].ops).toEqual({ $push: { members: 'a4' } })
  })

  it('lets only a workspace owner, a space owner or the creator manage a space', async () => {
    const someoneElses = { _id: 's1', space: core.space.Space, owners: ['other'], createdBy: 'not-me' }
    const call = { classId: document.class.Teamspace, id: 's1', data: { name: 'New name' } }

    const plain = setup({ findOne: { [document.class.Teamspace]: someoneElses } })
    expect(textOf(await updateDocTool.handler(plain.ctx, call))).toContain('Only a workspace owner')
    expect(plain.calls.updateDoc).toHaveLength(0)

    const owner = setup({ findOne: { [document.class.Teamspace]: someoneElses }, role: AccountRole.Owner })
    await updateDocTool.handler(owner.ctx, call)
    expect(owner.calls.updateDoc).toHaveLength(1)

    const spaceOwner = setup({ findOne: { [document.class.Teamspace]: { ...someoneElses, owners: [ME] } } })
    await updateDocTool.handler(spaceOwner.ctx, call)
    expect(spaceOwner.calls.updateDoc).toHaveLength(1)

    const creator = setup({
      findOne: { [document.class.Teamspace]: { ...someoneElses, createdBy: 'soc-1' }, [contact.class.Person]: { _id: 'p1' } },
      findAll: { [contact.class.SocialIdentity]: [{ _id: 'soc-1' }] }
    })
    await updateDocTool.handler(creator.ctx, call)
    expect(creator.calls.updateDoc).toHaveLength(1)
  })

  it('does not apply the space rule to ordinary documents', async () => {
    const { ctx, calls } = setup({ findOne: { [tracker.class.Component]: { _id: 'c1', space: PROJECT, createdBy: 'not-me' } } })

    await updateDocTool.handler(ctx, { classId: tracker.class.Component, id: 'c1', data: { label: 'x' } })

    expect(calls.updateDoc).toHaveLength(1)
  })
})

describe('huly_delete_doc', () => {
  const component = { _id: 'c1', space: PROJECT, createdBy: 'not-me' }

  it('refuses classes without a delete profile, including whole projects', async () => {
    const { ctx, calls } = setup({ findOne: { [tracker.class.Project]: { _id: PROJECT, space: 's' } } })

    const result = await deleteDocTool.handler(ctx, { classId: tracker.class.Project, id: PROJECT })

    expect(textOf(result)).toContain('cannot be deleted')
    expect(calls.removeDoc).toHaveLength(0)
  })

  it('reports a document that is not visible', async () => {
    const { ctx, calls } = setup()

    const result = await deleteDocTool.handler(ctx, { classId: tracker.class.Component, id: 'zzz' })

    expect(textOf(result)).toContain('No tracker:class:Component with id zzz')
    expect(calls.removeDoc).toHaveLength(0)
  })

  it("applies the web app's rule: only a workspace owner or the creator may delete", async () => {
    const plain = setup({ findOne: { [tracker.class.Component]: component } })
    expect(textOf(await deleteDocTool.handler(plain.ctx, { classId: tracker.class.Component, id: 'c1' }))).toContain('Only a workspace owner or the creator')
    expect(plain.calls.removeDoc).toHaveLength(0)

    const owner = setup({ findOne: { [tracker.class.Component]: component }, role: AccountRole.Owner })
    await deleteDocTool.handler(owner.ctx, { classId: tracker.class.Component, id: 'c1' })
    expect(owner.calls.removeDoc).toEqual([[tracker.class.Component, PROJECT, 'c1']])

    const creator = setup({
      findOne: { [tracker.class.Component]: { ...component, createdBy: 'soc-1' }, [contact.class.Person]: { _id: 'p1' } },
      findAll: { [contact.class.SocialIdentity]: [{ _id: 'soc-1' }] }
    })
    await deleteDocTool.handler(creator.ctx, { classId: tracker.class.Component, id: 'c1' })
    expect(creator.calls.removeDoc).toHaveLength(1)
  })

  it('detaches issues from a milestone before deleting it', async () => {
    const sweep = linkedIssues(['i1', 'i2'], 'milestone', 'm1')
    const { ctx, calls } = setup({
      role: AccountRole.Owner,
      findOne: { [tracker.class.Milestone]: { _id: 'm1', space: PROJECT } },
      findAll: sweep.findAll,
      onOps: sweep.onOps
    })

    await deleteDocTool.handler(ctx, { classId: tracker.class.Milestone, id: 'm1' })

    expect(calls.updateDoc.map((call) => [call.id, call.ops])).toEqual([
      ['i1', { milestone: null }],
      ['i2', { milestone: null }]
    ])
    expect(calls.removeDoc).toEqual([[tracker.class.Milestone, PROJECT, 'm1']])
  })

  it('detaches every issue in batches, however many point at the milestone', async () => {
    const ids = Array.from({ length: 1500 }, (_unused, index) => `i${index}`)
    const sweep = linkedIssues(ids, 'milestone', 'm1')
    const { ctx, calls } = setup({
      role: AccountRole.Owner,
      findOne: { [tracker.class.Milestone]: { _id: 'm1', space: PROJECT } },
      findAll: sweep.findAll,
      onOps: sweep.onOps
    })

    await deleteDocTool.handler(ctx, { classId: tracker.class.Milestone, id: 'm1' })

    // The same predicate is re-run until it comes back empty: 1000, then 500, then none.
    expect(sweep.queries).toEqual([{ milestone: 'm1' }, { milestone: 'm1' }, { milestone: 'm1' }])
    expect(sweep.limits).toEqual([1000, 1000, 1000])
    expect(calls.updateDoc).toHaveLength(1500)
    expect(calls.removeDoc).toEqual([[tracker.class.Milestone, PROJECT, 'm1']])
  })

  it('refuses the delete instead of leaving issues pointing at a milestone it cannot detach', async () => {
    const { ctx, calls } = setup({
      role: AccountRole.Owner,
      findOne: { [tracker.class.Milestone]: { _id: 'm1', space: PROJECT } },
      // The same issue comes back on every round, as if the clearing never took effect.
      findAll: { [tracker.class.Issue]: [{ _id: 'i1', space: PROJECT }] }
    })

    const result = await deleteDocTool.handler(ctx, { classId: tracker.class.Milestone, id: 'm1' })

    expect(textOf(result)).toContain('did not finish')
    expect(textOf(result)).toContain('nothing was deleted')
    expect(calls.removeDoc).toHaveLength(0)
  })

  it('removes an issue through its parent collection', async () => {
    const issue = { _id: 'i1', space: PROJECT, attachedTo: 'parent', attachedToClass: tracker.class.Issue, collection: 'subIssues' }
    const { ctx, calls } = setup({ role: AccountRole.Owner, findOne: { [tracker.class.Issue]: issue } })

    await deleteDocTool.handler(ctx, { classId: tracker.class.Issue, id: 'i1' })

    expect(calls.removeDoc).toHaveLength(0)
    expect(calls.removeCollection).toEqual([[tracker.class.Issue, PROJECT, 'i1', 'parent', tracker.class.Issue, 'subIssues']])
  })

  it('is marked destructive', () => {
    expect(deleteDocTool.destructive).toBe(true)
  })
})
