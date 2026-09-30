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

import contact, { type Person } from '@hcengineering/contact'
import core, { generateId, SortingOrder } from '@hcengineering/core'
import drive, { type Drive } from '@hcengineering/drive'
import task from '@hcengineering/task'
import tracker from '@hcengineering/tracker'

import { textResult } from '../mcp/protocol'
import { booleanProp, objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool } from '../mcp/tool'
import { clampLimit, personNames, statusNames, taskProjectNames, toIso } from './shared'

interface TaskRow {
  _id: string
  number: number
  title: string
  status: string
  assignee: string | null
  kind: string
  dueDate: number | null
  modifiedOn: number
  labels: number
  isDone?: boolean
  space: string
}

interface MilestoneRow {
  _id: string
  name: string
  dueDate?: number
  done?: string[]
}

export const listTasksTool: HulyTool = {
  name: 'huly_list_tasks',
  title: 'List tasks',
  description:
    'List to-do tasks and subtasks, optionally scoped to one task project (board). ' + 'Returns at most 200 per call.',
  readOnly: true,
  inputSchema: objectSchema({
    projectId: stringProp('Task project (board) id from huly_list_projects.'),
    assignee: stringProp('Person id to filter by. Use huly_find_people.'),
    includeDone: booleanProp('Include completed tasks. Defaults to true.'),
    limit: { type: 'integer', description: 'Maximum tasks to return (1-200, default 50).', default: 50 }
  }),
  handler: async (ctx, args) => {
    const query: Record<string, unknown> = { space: core.space.Space }
    if (args.projectId !== undefined) query.space = args.projectId
    if (args.assignee !== undefined) query.assignee = args.assignee

    let rows = (await ctx.client.findAll(task.class.Task, query as never, {
      limit: clampLimit(args.limit),
      sort: { modifiedOn: SortingOrder.Descending }
    })) as unknown as TaskRow[]

    if (args.includeDone === false) {
      rows = rows.filter((row) => row.isDone !== true)
    }

    if (rows.length === 0) {
      return textResult('No tasks matched.', { tasks: [] })
    }

    const [people, statuses, projects] = await Promise.all([
      personNames(
        ctx.client,
        rows.map((row) => row.assignee)
      ),
      statusNames(
        ctx.client,
        rows.map((row) => row.status)
      ),
      taskProjectNames(
        ctx.client,
        rows.map((row) => row.space)
      )
    ])

    const tasks = rows.map((row) => ({
      id: row._id,
      number: row.number,
      title: row.title,
      done: row.isDone === true,
      status: statuses.get(row.status)?.name ?? 'Unknown',
      assignee: row.assignee === null ? null : (people.get(row.assignee) ?? 'Unknown'),
      projectId: row.space,
      project: projects.get(row.space)?.name ?? null,
      kind: row.kind,
      dueDate: toIso(row.dueDate),
      modifiedOn: toIso(row.modifiedOn)
    }))

    return textResult(JSON.stringify({ tasks }, null, 2), { tasks })
  }
}

export const findPeopleTool: HulyTool = {
  name: 'huly_find_people',
  title: 'Find people',
  description:
    'Find people in this workspace by name or email. Use the returned id with the assignee fields ' +
    'of the issue and task tools.',
  readOnly: true,
  inputSchema: objectSchema({
    query: stringProp('Name or email to match, case-insensitively. Omit to list everyone.'),
    limit: { type: 'integer', description: 'Maximum people to return (1-200, default 50).', default: 50 }
  }),
  handler: async (ctx, args) => {
    const limit = clampLimit(args.limit)

    const persons = (await ctx.client.findAll(
      contact.class.Person,
      {},
      { limit, sort: { name: SortingOrder.Ascending } }
    )) as unknown as Person[]

    const identityQuery: Record<string, unknown> = { _id: { $in: persons.map((person) => person._id) } }
    const identities = await ctx.client.findAll(contact.class.SocialIdentity, identityQuery as never, {
      limit: persons.length
    })

    const byPerson = new Map<string, string>()
    for (const identity of identities as unknown as Array<{ _id: string, value: string }>) {
      byPerson.set(identity._id, identity.value)
    }

    const needle = (args.query as string | undefined)?.toLowerCase()
    const rows = persons
      .map((person) => ({ id: person._id, name: person.name, email: byPerson.get(person._id) ?? null }))
      .filter(
        (row) =>
          needle === undefined ||
          row.name.toLowerCase().includes(needle) ||
          (row.email ?? '').toLowerCase().includes(needle)
      )

    if (rows.length === 0) {
      return textResult('No people matched.', { people: [] })
    }

    return textResult(JSON.stringify({ people: rows }, null, 2), { people: rows })
  }
}

export const createPersonTool: HulyTool = {
  name: 'huly_create_person',
  title: 'Create person',
  description:
    'Create a new person record in this workspace, optionally with an email address. ' +
    'Use this to add an external collaborator who does not have a Huly account.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      name: stringProp('Full name.', { minLength: 1, maxLength: 200 }),
      email: stringProp('Email address, used as the primary communication channel.')
    },
    ['name']
  ),
  handler: async (ctx, args) => {
    const name = args.name as string
    const personId = generateId<Person>()

    const attributes: Record<string, unknown> = {
      name,
      avatar: null,
      avatarProps: { color: 'blue' },
      personUuid: generateId(),
      city: '',
      comments: 0,
      channels: args.email === undefined ? 0 : 1,
      attachments: 0,
      links: 0,
      socialIds: 0
    }
    await ctx.client.createDoc(contact.class.Person, contact.space.Contacts, attributes as never, personId)

    if (args.email !== undefined) {
      const channel: Record<string, unknown> = {
        provider: contact.channelProvider.Email,
        value: args.email
      }
      await ctx.client.addCollection(
        contact.class.Channel,
        contact.space.Contacts,
        personId as never,
        contact.class.Person,
        'channels',
        channel as never
      )
    }

    return textResult(JSON.stringify({ id: personId, name }, null, 2), { created: true, personId })
  }
}

export const listSpacesTool: HulyTool = {
  name: 'huly_list_spaces',
  title: 'List spaces',
  description:
    'List every typed space the user belongs to: projects, drives, document teamspaces and ' +
    'anything else that holds documents. Use the id to scope huly_list_documents.',
  readOnly: true,
  inputSchema: objectSchema({
    limit: { type: 'integer', description: 'Maximum spaces to return (1-200, default 100).', default: 100 }
  }),
  handler: async (ctx, args) => {
    const query: Record<string, unknown> = { members: ctx.account }
    const spaces = (await ctx.client.findAll(core.class.TypedSpace, query as never, {
      limit: clampLimit(args.limit),
      sort: { name: SortingOrder.Ascending }
    })) as unknown as Array<{ _id: string, name: string, type: string, archived?: boolean }>

    const rows = spaces
      .filter((space) => space.archived !== true)
      .map((space) => ({ id: space._id, name: space.name, type: space.type }))

    if (rows.length === 0) {
      return textResult('No spaces found for this user.', { spaces: [] })
    }

    return textResult(JSON.stringify({ spaces: rows }, null, 2), { spaces: rows })
  }
}

export const listDrivesTool: HulyTool = {
  name: 'huly_list_drives',
  title: 'List drives',
  description: 'List the drives (file collections) in this workspace that the user belongs to.',
  readOnly: true,
  inputSchema: objectSchema({}),
  handler: async (ctx) => {
    const query: Record<string, unknown> = { members: ctx.account }
    const drives = (await ctx.client.findAll(drive.class.Drive, query as never, {
      limit: 200,
      sort: { name: SortingOrder.Ascending }
    })) as unknown as Drive[]

    const rows = drives
      .filter((item) => !item.archived)
      .map((item) => ({ id: item._id, name: item.name, description: item.description ?? '' }))

    return textResult(rows.length === 0 ? 'No drives found.' : JSON.stringify({ drives: rows }, null, 2), {
      drives: rows
    })
  }
}

export const listMilestonesTool: HulyTool = {
  name: 'huly_list_milestones',
  title: 'List milestones',
  description: 'List the milestones of a project, with their target dates and how many issues are done.',
  readOnly: true,
  inputSchema: objectSchema({ projectId: stringProp('Project id.') }, ['projectId']),
  handler: async (ctx, args) => {
    const query: Record<string, unknown> = { project: args.projectId }
    const milestones = (await ctx.client.findAll(tracker.class.Milestone, query as never, {
      limit: 200
    })) as unknown as MilestoneRow[]

    const rows = milestones.map((milestone) => ({
      id: milestone._id,
      name: milestone.name,
      dueDate: toIso(milestone.dueDate),
      doneCount: milestone.done?.length ?? 0
    }))

    return textResult(
      rows.length === 0
        ? `No milestones in project ${args.projectId as string}.`
        : JSON.stringify({ milestones: rows }, null, 2),
      { milestones: rows }
    )
  }
}

/* -------------------------------------------------------------------------- */

export const personTools: HulyTool[] = [
  findPeopleTool,
  createPersonTool,
  listSpacesTool,
  listDrivesTool,
  listMilestonesTool,
  listTasksTool
]
