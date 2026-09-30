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

import core, { type TxOperations } from '@hcengineering/core'
import chunter from '@hcengineering/chunter'
import contact from '@hcengineering/contact'
import task from '@hcengineering/task'
import tracker from '@hcengineering/tracker'

import { fakeIdentity, fakeMeasureContext } from '../../__tests__/test-doubles'
import { toolContext, type ToolContext } from '../../mcp/tool'
import { type MarkupWriter } from '../../platform/markup-reader'
import { type WorkspaceSession } from '../../platform/workspace-client-provider'
import { createComponentTool, listComponentsTool } from '../component-tools'
import {
  addCommentTool,
  createIssueTool,
  createMilestoneTool,
  getIssueTool,
  listIssuesTool,
  updateIssueTool,
  updateMilestoneTool
} from '../issue-tools'
import { findPeopleTool, listMilestonesTool } from '../people-tools'
import { listProjectsTool } from '../project-tools'
import { likePattern, projectNames } from '../shared'

type Row = Record<string, unknown>

interface Recorded {
  findAll: Array<{ cls: string, query: Row }>
  updateDoc: Row[]
  createDoc: Array<{ cls: string, space: string, attributes: Row }>
  addCollection: Array<{ cls: string, space: string, attachedTo: string, collection: string, attributes: Row }>
}

interface Script {
  findAll?: Record<string, Row[] | ((query: Row) => Row[])>
  findOne?: Record<string, Row | undefined>
  sequence?: number
}

function scriptedClient (script: Script): { client: TxOperations, recorded: Recorded } {
  const recorded: Recorded = { findAll: [], updateDoc: [], createDoc: [], addCollection: [] }
  const client = {
    findAll: async (cls: string, query: Row) => {
      recorded.findAll.push({ cls, query })
      const rows = script.findAll?.[cls]
      return typeof rows === 'function' ? rows(query) : (rows ?? [])
    },
    findOne: async (cls: string) => script.findOne?.[cls],
    createDoc: async (cls: string, space: string, attributes: Row) => {
      recorded.createDoc.push({ cls, space, attributes })
    },
    updateDoc: async (...args: unknown[]) => {
      recorded.updateDoc.push({ args })
      return { object: { sequence: script.sequence ?? 1 } }
    },
    addCollection: async (cls: string, space: string, attachedTo: string, _attachedToClass: string, collection: string, attributes: Row) => {
      recorded.addCollection.push({ cls, space, attachedTo, collection, attributes })
    }
  }
  return { client: client as unknown as TxOperations, recorded }
}

function context (client: TxOperations, markupWriter?: MarkupWriter): ToolContext {
  const session: WorkspaceSession = {
    client,
    identity: fakeIdentity(),
    markup: { read: async () => '' },
    markupWriter
  }
  return toolContext(session, fakeMeasureContext())
}

const PROJECT = { _id: 'proj-1', identifier: 'HULY', type: 'type-1', defaultIssueStatus: null }
const TASK_TYPE = { _id: 'kind-1', statuses: ['status-backlog', 'status-todo'] }

describe('likePattern', () => {
  it('wraps the needle and escapes LIKE wildcards', () => {
    expect(likePattern('abc')).toBe('%abc%')
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%')
  })
})

describe('huly_create_issue', () => {
  const script = (): Script => ({
    findOne: { [tracker.class.Project]: PROJECT, [task.class.TaskType]: TASK_TYPE },
    sequence: 7
  })

  it('creates through addCollection, numbers via the atomic sequence and falls back to the task type status', async () => {
    const { client, recorded } = scriptedClient(script())

    const result = await createIssueTool.handler(context(client), { projectId: 'proj-1', title: 'Hello' })

    expect(recorded.updateDoc).toHaveLength(1)
    expect(recorded.addCollection).toHaveLength(1)
    const call = recorded.addCollection[0]
    expect(call.cls).toBe(tracker.class.Issue)
    expect(call.space).toBe('proj-1')
    expect(call.collection).toBe('subIssues')
    expect(call.attributes).toMatchObject({
      number: 7,
      identifier: 'HULY-7',
      kind: 'kind-1',
      status: 'status-backlog',
      description: null
    })
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(JSON.stringify(result.content)).toContain('HULY-7')
  })

  it('prefers an explicit status, then the project default', async () => {
    const withDefault = scriptedClient({
      ...script(),
      findOne: { [tracker.class.Project]: { ...PROJECT, defaultIssueStatus: 'status-todo' }, [task.class.TaskType]: TASK_TYPE }
    })
    await createIssueTool.handler(context(withDefault.client), { projectId: 'proj-1', title: 'A' })
    expect(withDefault.recorded.addCollection[0].attributes.status).toBe('status-todo')

    const explicit = scriptedClient(script())
    await createIssueTool.handler(context(explicit.client), { projectId: 'proj-1', title: 'B', statusId: 'status-x' })
    expect(explicit.recorded.addCollection[0].attributes.status).toBe('status-x')
  })

  it('refuses a description without a markup writer and consumes no issue number', async () => {
    const { client, recorded } = scriptedClient(script())

    const result = await createIssueTool.handler(context(client), {
      projectId: 'proj-1',
      title: 'Hello',
      description: 'Body'
    })

    expect(JSON.stringify(result.content)).toContain('COLLABORATOR_URL')
    expect(recorded.updateDoc).toHaveLength(0)
    expect(recorded.addCollection).toHaveLength(0)
  })

  it('stores the description through the writer and keeps its reference', async () => {
    const { client, recorded } = scriptedClient(script())
    const written: string[][] = []
    const writer: MarkupWriter = {
      write: async (cls, id, attribute, markdown) => {
        written.push([cls, attribute, markdown])
        return `blob-for-${id}`
      }
    }

    await createIssueTool.handler(context(client, writer), { projectId: 'proj-1', title: 'Hello', description: 'Body' })

    expect(written).toEqual([[tracker.class.Issue, 'description', 'Body']])
    expect(String(recorded.addCollection[0].attributes.description)).toMatch(/^blob-for-/)
  })

  it('does not create anything for an unknown project', async () => {
    const { client, recorded } = scriptedClient({})
    await createIssueTool.handler(context(client), { projectId: 'missing', title: 'Hello' })
    expect(recorded.addCollection).toHaveLength(0)
  })
})

describe('huly_add_issue_comment', () => {
  it('attaches the comment to the issue as rich text instead of creating a free-standing doc', async () => {
    const { client, recorded } = scriptedClient({
      findOne: { [tracker.class.Issue]: { _id: 'issue-1', space: 'proj-1' } }
    })

    await addCommentTool.handler(context(client), { issueId: 'issue-1', text: 'A **bold** note' })

    expect(recorded.addCollection).toHaveLength(1)
    const call = recorded.addCollection[0]
    expect(call.cls).toBe(chunter.class.ChatMessage)
    expect(call.space).toBe('proj-1')
    expect(call.attachedTo).toBe('issue-1')
    expect(call.collection).toBe('comments')
    expect(String(call.attributes.message)).toContain('"type":"doc"')
  })
})

describe('huly_list_issues', () => {
  const statuses = [
    { _id: 's-todo', name: 'Todo' },
    { _id: 's-done', name: 'Done' },
    { _id: 's-lost', name: 'Canceled' }
  ]

  function scripted (): ReturnType<typeof scriptedClient> {
    return scriptedClient({
      findAll: {
        [tracker.class.IssueStatus]: statuses,
        [core.class.Status]: statuses,
        [tracker.class.Issue]: []
      }
    })
  }

  it('searches titles with a database LIKE, not a regular expression', async () => {
    const { client, recorded } = scripted()
    await listIssuesTool.handler(context(client), { search: 'Smoke' })

    const issueQuery = recorded.findAll.find((call) => call.cls === tracker.class.Issue)?.query
    expect(issueQuery?.title).toEqual({ $like: '%Smoke%' })
  })

  it('does not apply the search text as a regular expression', async () => {
    const { client, recorded } = scripted()
    await listIssuesTool.handler(context(client), { search: '(a+)+' })

    const title = recorded.findAll.find((call) => call.cls === tracker.class.Issue)?.query.title
    expect(JSON.stringify(title)).not.toContain('regex')
  })
})

describe('project listings', () => {
  it('does not list a tracker project a second time as a task project', async () => {
    const row = { _id: 'proj-1', name: 'Huly', identifier: 'HULY', archived: false, private: false }
    const { client } = scriptedClient({
      findAll: { [tracker.class.Project]: [row], [task.class.Project]: [row, { _id: 'proj-2', name: 'Board' }] }
    })

    const result = await listProjectsTool.handler(context(client), {})
    const payload = JSON.parse((result.content[0] as { text: string }).text) as { projects: Array<{ id: string, kind: string }> }

    expect(payload.projects.map((project) => project.id)).toEqual(['proj-1', 'proj-2'])
    expect(payload.projects.map((project) => project.kind)).toEqual(['tracker', 'task'])
  })

  it('keeps the tracker identifier when the same id also comes back as a task project', async () => {
    const { client } = scriptedClient({
      findAll: {
        [tracker.class.Project]: [{ _id: 'proj-1', name: 'Huly', identifier: 'HULY' }],
        [task.class.Project]: [{ _id: 'proj-1', name: 'Huly' }]
      }
    })

    const names = await projectNames(client, ['proj-1'])

    expect(names.get('proj-1')?.identifier).toBe('HULY')
  })
})

describe('huly_find_people', () => {
  it('filters by name and email in the database, before any limit', async () => {
    const { client, recorded } = scriptedClient({
      findAll: {
        [contact.class.Person]: [{ _id: 'p-1', name: 'Hopper,Grace' }],
        [contact.class.SocialIdentity]: [],
        [contact.class.Channel]: []
      }
    })

    await findPeopleTool.handler(context(client), { query: 'hopper' })

    const personQuery = recorded.findAll.find((call) => call.cls === contact.class.Person)?.query
    expect(personQuery?.name).toEqual({ $like: '%hopper%' })
    const identityQuery = recorded.findAll.find((call) => call.cls === contact.class.SocialIdentity)?.query
    expect(identityQuery?.value).toEqual({ $like: '%hopper%' })
  })

  it('reads emails from identities attached to the person, not by matching ids', async () => {
    const { client } = scriptedClient({
      findAll: {
        [contact.class.Person]: [{ _id: 'p-1', name: 'Hopper,Grace' }],
        [contact.class.SocialIdentity]: [{ attachedTo: 'p-1', type: 'email', value: 'grace@example.test' }],
        [contact.class.Channel]: []
      }
    })

    const result = await findPeopleTool.handler(context(client), {})
    const payload = JSON.parse((result.content[0] as { text: string }).text) as { people: Array<{ email: string | null }> }

    expect(payload.people[0].email).toBe('grace@example.test')
  })
})

describe('huly_create_issue relations', () => {
  const PARENT = {
    _id: 'issue-parent',
    title: 'Parent',
    identifier: 'HULY-1',
    space: 'proj-1',
    parents: [{ parentId: 'issue-root', parentTitle: 'Root', space: 'proj-1', identifier: 'HULY-0' }]
  }
  const base = (): Script => ({
    findOne: { [tracker.class.Project]: PROJECT, [task.class.TaskType]: TASK_TYPE, [tracker.class.Issue]: PARENT },
    sequence: 9
  })

  it('attaches a sub-issue to its parent and records the ancestor chain nearest first', async () => {
    const { client, recorded } = scriptedClient(base())

    await createIssueTool.handler(context(client), { projectId: 'proj-1', title: 'Child', parentIssueId: 'issue-parent' })

    const call = recorded.addCollection[0]
    expect(call.attachedTo).toBe('issue-parent')
    expect(call.attributes.parents).toEqual([
      { parentId: 'issue-parent', parentTitle: 'Parent', space: 'proj-1', identifier: 'HULY-1' },
      { parentId: 'issue-root', parentTitle: 'Root', space: 'proj-1', identifier: 'HULY-0' }
    ])
  })

  it('refuses a parent from another project before consuming a number', async () => {
    const { client, recorded } = scriptedClient({
      ...base(),
      findOne: { ...base().findOne, [tracker.class.Issue]: { ...PARENT, space: 'other' } }
    })

    const result = await createIssueTool.handler(context(client), {
      projectId: 'proj-1',
      title: 'Child',
      parentIssueId: 'issue-parent'
    })

    expect(JSON.stringify(result.content)).toContain('sub-issue was not created')
    expect(recorded.updateDoc).toHaveLength(0)
    expect(recorded.addCollection).toHaveLength(0)
  })

  it('sets a component that exists in the project and refuses one that does not', async () => {
    const found = scriptedClient({
      ...base(),
      findOne: { ...base().findOne, [tracker.class.Component]: { _id: 'comp-1' } }
    })
    await createIssueTool.handler(context(found.client), { projectId: 'proj-1', title: 'A', componentId: 'comp-1' })
    expect(found.recorded.addCollection[0].attributes.component).toBe('comp-1')

    const missing = scriptedClient(base())
    const result = await createIssueTool.handler(context(missing.client), {
      projectId: 'proj-1',
      title: 'B',
      componentId: 'comp-x'
    })
    expect(JSON.stringify(result.content)).toContain('huly_list_components')
    expect(missing.recorded.updateDoc).toHaveLength(0)
  })
})

describe('huly_update_issue component', () => {
  const issue = { _id: 'issue-1', space: 'proj-1' }

  it('validates the component against the issue project and allows clearing it', async () => {
    const ok = scriptedClient({
      findOne: { [tracker.class.Issue]: issue, [tracker.class.Component]: { _id: 'comp-1' } }
    })
    await updateIssueTool.handler(context(ok.client), { issueId: 'issue-1', componentId: 'comp-1' })
    expect(ok.recorded.updateDoc[0]).toMatchObject({ args: [tracker.class.Issue, 'proj-1', 'issue-1', { component: 'comp-1' }] })

    const cleared = scriptedClient({ findOne: { [tracker.class.Issue]: issue } })
    await updateIssueTool.handler(context(cleared.client), { issueId: 'issue-1', componentId: null })
    expect(cleared.recorded.updateDoc[0]).toMatchObject({ args: [tracker.class.Issue, 'proj-1', 'issue-1', { component: null }] })

    const bad = scriptedClient({ findOne: { [tracker.class.Issue]: issue } })
    const result = await updateIssueTool.handler(context(bad.client), { issueId: 'issue-1', componentId: 'nope' })
    expect(JSON.stringify(result.content)).toContain('nothing was changed')
    expect(bad.recorded.updateDoc).toHaveLength(0)
  })
})

describe('milestones', () => {
  it('creates a milestone with the model fields, in the project space', async () => {
    const { client, recorded } = scriptedClient({ findOne: { [tracker.class.Project]: PROJECT } })

    await createMilestoneTool.handler(context(client), {
      projectId: 'proj-1',
      name: 'Beta',
      targetDate: '2026-12-31T00:00:00Z'
    })

    expect(recorded.createDoc).toHaveLength(1)
    const { cls, space, attributes } = recorded.createDoc[0]
    expect(cls).toBe(tracker.class.Milestone)
    expect(space).toBe('proj-1')
    expect(attributes).toMatchObject({
      label: 'Beta',
      status: 0,
      comments: 0,
      startDate: null,
      targetDate: Date.parse('2026-12-31T00:00:00Z')
    })
    expect(attributes).not.toHaveProperty('name')
    expect(attributes).not.toHaveProperty('project')
  })

  it('lists milestones by space and reports status and dates', async () => {
    const { client, recorded } = scriptedClient({
      findAll: {
        [tracker.class.Milestone]: [
          { _id: 'ms-1', label: 'Beta', status: 1, startDate: null, targetDate: Date.parse('2026-12-31T00:00:00Z') }
        ]
      }
    })

    const result = await listMilestonesTool.handler(context(client), { projectId: 'proj-1' })

    expect(recorded.findAll[0].query).toEqual({ space: 'proj-1' })
    const payload = JSON.parse((result.content[0] as { text: string }).text) as { milestones: Row[] }
    expect(payload.milestones[0]).toEqual({
      id: 'ms-1',
      name: 'Beta',
      status: 'InProgress',
      startDate: null,
      targetDate: '2026-12-31T00:00:00.000Z'
    })
  })

  it('updates only the passed fields and refuses to clear the target date', async () => {
    const milestone = { _id: 'ms-1', space: 'proj-1' }
    const { client, recorded } = scriptedClient({ findOne: { [tracker.class.Milestone]: milestone } })

    await updateMilestoneTool.handler(context(client), { milestoneId: 'ms-1', name: 'GA', status: 'Completed' })
    expect(recorded.updateDoc[0]).toMatchObject({
      args: [tracker.class.Milestone, 'proj-1', 'ms-1', { label: 'GA', status: 2 }]
    })

    const result = await updateMilestoneTool.handler(context(client), { milestoneId: 'ms-1', targetDate: null })
    expect(JSON.stringify(result.content)).toContain('cannot be cleared')
    expect(recorded.updateDoc).toHaveLength(1)

    const unknown = await updateMilestoneTool.handler(context(client), { milestoneId: 'ms-1', status: 'Done' })
    expect(JSON.stringify(unknown.content)).toContain('Unknown milestone status')
  })
})

describe('components', () => {
  it('lists components with lead names', async () => {
    const { client, recorded } = scriptedClient({
      findAll: {
        [tracker.class.Component]: [{ _id: 'comp-1', label: 'API', lead: 'person-1', space: 'proj-1' }],
        [contact.class.Person]: [{ _id: 'person-1', name: 'Grace Hopper' }]
      }
    })

    const result = await listComponentsTool.handler(context(client), { projectId: 'proj-1' })

    expect(recorded.findAll[0].query).toEqual({ space: 'proj-1' })
    const payload = JSON.parse((result.content[0] as { text: string }).text) as { components: Row[] }
    expect(payload.components[0]).toEqual({ id: 'comp-1', name: 'API', projectId: 'proj-1', lead: 'Grace Hopper' })
  })

  it('creates a component through createDoc in the project space', async () => {
    const { client, recorded } = scriptedClient({ findOne: { [tracker.class.Project]: PROJECT } })

    await createComponentTool.handler(context(client), { projectId: 'proj-1', name: 'API', lead: 'person-1' })

    expect(recorded.createDoc[0]).toMatchObject({
      cls: tracker.class.Component,
      space: 'proj-1',
      attributes: { label: 'API', lead: 'person-1', comments: 0 }
    })
  })
})

describe('huly_get_issue', () => {
  it('finds sub-issues by attachment to the parent, not by a nonexistent parent field', async () => {
    const issue = { _id: 'issue-1', number: 1, title: 'P', status: 's', priority: 0, assignee: null, space: 'proj-1', labels: 0, rank: '', createdOn: 0, modifiedOn: 0, startDate: null, dueDate: null, milestone: null, estimation: 0 }
    const { client, recorded } = scriptedClient({ findOne: { [tracker.class.Issue]: issue } })

    await getIssueTool.handler(context(client), { issueId: 'issue-1' })

    const subtaskQuery = recorded.findAll.find((call) => call.cls === tracker.class.Issue)?.query
    expect(subtaskQuery).toEqual({ space: 'proj-1', attachedTo: 'issue-1' })
  })
})
