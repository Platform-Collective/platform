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
import { addCommentTool, createIssueTool, listIssuesTool } from '../issue-tools'
import { findPeopleTool } from '../people-tools'
import { listProjectsTool } from '../project-tools'
import { likePattern, projectNames } from '../shared'

type Row = Record<string, unknown>

interface Recorded {
  findAll: Array<{ cls: string, query: Row }>
  updateDoc: Row[]
  addCollection: Array<{ cls: string, space: string, attachedTo: string, collection: string, attributes: Row }>
}

interface Script {
  findAll?: Record<string, Row[] | ((query: Row) => Row[])>
  findOne?: Record<string, Row | undefined>
  sequence?: number
}

function scriptedClient (script: Script): { client: TxOperations, recorded: Recorded } {
  const recorded: Recorded = { findAll: [], updateDoc: [], addCollection: [] }
  const client = {
    findAll: async (cls: string, query: Row) => {
      recorded.findAll.push({ cls, query })
      const rows = script.findAll?.[cls]
      return typeof rows === 'function' ? rows(query) : (rows ?? [])
    },
    findOne: async (cls: string) => script.findOne?.[cls],
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
