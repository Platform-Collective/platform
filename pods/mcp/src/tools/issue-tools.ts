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

import chunter, { type ChatMessage } from '@hcengineering/chunter'
import core, { generateId, SortingOrder } from '@hcengineering/core'
import task from '@hcengineering/task'
import tracker, { IssuePriority, type Issue, type Milestone } from '@hcengineering/tracker'

import { textResult } from '../mcp/protocol'
import { toMarkup } from '../platform/markup'
import { booleanProp, objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool, type ToolContext } from '../mcp/tool'
import { clampLimit, likePattern, personNames, projectNames, statusNames, toIso } from './shared'

/** The slice of an Issue the tools read. */
interface IssueRow {
  _id: string
  number: number
  title: string
  status: string
  priority: number
  assignee: string | null
  space: string
  labels: number
  rank: string
  createdOn: number
  modifiedOn: number
  startDate: number | null
  dueDate: number | null
  milestone: string | null
  description?: string | null
  estimation: number
}

const PRIORITY_NAMES = Object.keys(IssuePriority).filter((key) => Number.isNaN(Number(key)))

const priorityName = (value: number): string => PRIORITY_NAMES[value] ?? `Unknown(${value})`

const priorityIndex = (name: string | undefined): number => {
  if (name === undefined) return IssuePriority.NoPriority
  const index = PRIORITY_NAMES.indexOf(name)
  return index < 0 ? IssuePriority.NoPriority : index
}

/**
 * Turns raw issues into the shape an agent can act on: human names instead of
 * ids, ISO dates instead of epoch millis, and an `identifier-number` key.
 */
async function formatIssues (ctx: ToolContext, issues: IssueRow[]): Promise<Array<Record<string, unknown>>> {
  const [people, statuses, projects] = await Promise.all([
    personNames(
      ctx.client,
      issues.map((issue) => issue.assignee)
    ),
    statusNames(
      ctx.client,
      issues.map((issue) => issue.status)
    ),
    projectNames(
      ctx.client,
      issues.map((issue) => issue.space)
    )
  ])

  return issues.map((issue) => {
    const project = projects.get(issue.space)
    const status = statuses.get(issue.status)
    return {
      id: issue._id,
      key: project?.identifier != null ? `${project.identifier}-${issue.number}` : `${issue.number}`,
      title: issue.title,
      status: status?.name ?? 'Unknown',
      statusCategory: status?.category ?? null,
      priority: priorityName(issue.priority),
      assignee: issue.assignee === null ? null : (people.get(issue.assignee) ?? 'Unknown'),
      projectId: issue.space,
      project: project?.name ?? null,
      labels: issue.labels,
      startDate: toIso(issue.startDate),
      dueDate: toIso(issue.dueDate),
      estimation: issue.estimation,
      modifiedOn: toIso(issue.modifiedOn)
    }
  })
}

/** Status categories that mean the work is finished, whether completed or canceled. */
const DONE_CATEGORIES = new Set(['won', 'lost'])

/** Ids of the issue statuses matching a name and/or excluding finished ones. */
async function allowedStatusIds (ctx: ToolContext, name: string | undefined, excludeDone: boolean): Promise<string[]> {
  const query: Record<string, unknown> = { ofAttribute: tracker.attribute.IssueStatus }
  const statuses = (await ctx.client.findAll(tracker.class.IssueStatus, query as never, {
    limit: 200
  })) as unknown as Array<{ _id: string }>
  const resolved = await statusNames(
    ctx.client,
    statuses.map((status) => status._id)
  )

  const wanted = name?.toLowerCase()
  return statuses
    .filter((status) => {
      const info = resolved.get(status._id)
      if (wanted !== undefined && (info?.name ?? '').toLowerCase() !== wanted) return false
      if (excludeDone && DONE_CATEGORIES.has((info?.category ?? '').toLowerCase())) return false
      return true
    })
    .map((status) => status._id)
}

export const listIssuesTool: HulyTool = {
  name: 'huly_list_issues',
  title: 'List issues',
  description:
    'List issues, most recently modified first. Filter by project, status name, assignee or free text. ' +
    'Issue statuses are matched by name; call huly_list_issue_statuses to see the valid values. ' +
    'Returns at most 200 issues per call; narrow the filters for large projects.',
  readOnly: true,
  inputSchema: objectSchema({
    projectId: stringProp('Restrict to one project id.'),
    status: stringProp('Restrict to one status, matched case-insensitively by name (e.g. "In Progress").'),
    assignee: stringProp('Restrict to issues assigned to this person id. Use huly_find_people to look one up.'),
    search: stringProp('Case-insensitive substring match against the issue title.'),
    includeDone: booleanProp('Include issues in a "done" category. Defaults to true.'),
    limit: { type: 'integer', description: 'Maximum issues to return (1-200, default 50).', default: 50 }
  }),
  handler: async (ctx, args) => {
    const limit = clampLimit(args.limit)
    const query: Record<string, unknown> = {}

    if (args.projectId !== undefined) query.space = args.projectId
    if (args.assignee !== undefined) query.assignee = args.assignee
    if (args.search !== undefined) {
      query.title = { $like: likePattern(String(args.search)) }
    }

    // Status is a reference to a status document, so a name or a "done" filter
    // is turned into a set of status ids first. Filtering before the limit
    // means a page is never emptied by a filter applied afterwards.
    if (args.status !== undefined || args.includeDone === false) {
      const allowed = await allowedStatusIds(ctx, args.status as string | undefined, args.includeDone === false)
      if (allowed.length === 0) {
        return textResult(
          `No issue status matches "${String(args.status)}". Call huly_list_issue_statuses for the valid names.`,
          { issues: [] }
        )
      }
      query.status = { $in: allowed }
    }

    const issues = (await ctx.client.findAll(tracker.class.Issue, query as never, {
      limit,
      sort: { modifiedOn: SortingOrder.Descending }
    })) as unknown as IssueRow[]

    if (issues.length === 0) {
      return textResult('No issues matched. Try widening the filters or call huly_list_projects.', {
        issues: []
      })
    }

    const formatted = await formatIssues(ctx, issues)
    return textResult(JSON.stringify({ issues: formatted }, null, 2), { issues: formatted })
  }
}

export const getIssueTool: HulyTool = {
  name: 'huly_get_issue',
  title: 'Get issue',
  description:
    'Get one issue in full: description text, subtasks and comments. ' +
    'Pass the issue id returned by huly_list_issues or huly_search.',
  readOnly: true,
  inputSchema: objectSchema({ issueId: stringProp('Issue id.') }, ['issueId']),
  handler: async (ctx, args) => {
    const issueId = args.issueId as string

    const issueIdQuery: Record<string, unknown> = { _id: issueId }
    const issue = (await ctx.client.findOne(tracker.class.Issue, issueIdQuery as never)) as unknown as
      | IssueRow
      | undefined

    if (issue === undefined) {
      return textResult(
        `No issue with id ${issueId} is visible to you. It may have been deleted or belong to another project.`,
        { found: false }
      )
    }

    const subtaskQuery: Record<string, unknown> = { space: issue.space, parent: issue._id }
    const commentQuery: Record<string, unknown> = { attachedTo: issueId, collection: 'comments' }

    const [subtasks, comments, description] = await Promise.all([
      ctx.client.findAll(tracker.class.Issue, subtaskQuery as never, {
        limit: 100,
        sort: { rank: SortingOrder.Ascending }
      }) as Promise<unknown>,
      ctx.client.findAll(chunter.class.ChatMessage, commentQuery as never, {
        limit: 200,
        sort: { createdOn: SortingOrder.Ascending }
      }) as Promise<unknown>,
      ctx.markup.read(issue.description as string)
    ])

    const subtaskRows = await formatIssues(ctx, subtasks as IssueRow[])
    const commentRows = await formatComments(ctx, comments as ChatMessage[])
    const [formatted] = await formatIssues(ctx, [issue])

    return textResult(
      JSON.stringify(
        {
          ...formatted,
          description: (description ?? '').trim(),
          subtasks: subtaskRows,
          comments: commentRows
        },
        null,
        2
      ),
      { found: true, issueId: issue._id, commentCount: commentRows.length, subtaskCount: subtaskRows.length }
    )
  }
}

async function formatComments (ctx: ToolContext, comments: ChatMessage[]): Promise<Array<Record<string, unknown>>> {
  if (comments.length === 0) return []
  const people = await personNames(
    ctx.client,
    comments.map((comment) => comment.createdBy as never)
  )
  return comments.map((comment) => ({
    id: comment._id,
    author: people.get(comment.createdBy as never) ?? 'Unknown',
    createdOn: toIso(comment.createdOn),
    text: (comment.message ?? '').trim()
  }))
}

export const listIssueStatusesTool: HulyTool = {
  name: 'huly_list_issue_statuses',
  title: 'List issue statuses',
  description:
    'List every issue status in this workspace with its id, display name and category. ' +
    'Status ids are what huly_update_issue expects; names are what huly_list_issues matches on.',
  readOnly: true,
  inputSchema: objectSchema({}),
  handler: async (ctx) => {
    const query: Record<string, unknown> = { ofAttribute: tracker.attribute.IssueStatus }
    const statuses = (await ctx.client.findAll(tracker.class.IssueStatus, query as never, {
      limit: 200
    })) as unknown as Array<{ _id: string, name: string }>

    const resolved = await statusNames(
      ctx.client,
      statuses.map((status) => status._id)
    )

    const rows = statuses.map((status) => ({
      id: status._id,
      name: resolved.get(status._id)?.name ?? status.name,
      category: resolved.get(status._id)?.category ?? null
    }))

    return textResult(JSON.stringify({ statuses: rows }, null, 2), { statuses: rows })
  }
}

export const createIssueTool: HulyTool = {
  name: 'huly_create_issue',
  title: 'Create issue',
  description:
    'Create a new issue in a project. The description is plain text or Markdown. ' +
    'The issue starts in the project default status unless statusId is given. ' +
    'Due dates are ISO-8601. Call huly_get_project first to learn the default status.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      projectId: stringProp('Project id from huly_list_projects.'),
      title: stringProp('Short issue title.', { minLength: 1, maxLength: 500 }),
      description: stringProp('Longer description. Plain text or Markdown.', { maxLength: 200_000 }),
      priority: {
        type: 'string',
        description: 'Issue priority.',
        enum: ['NoPriority', 'Urgent', 'High', 'Medium', 'Low']
      },
      statusId: stringProp('Status id from huly_list_issue_statuses. Defaults to the project default.'),
      assignee: stringProp('Person id to assign. Use huly_find_people to look one up.'),
      dueDate: stringProp('ISO-8601 due date, e.g. 2026-12-31 or 2026-12-31T17:00:00Z.'),
      startDate: stringProp('ISO-8601 start date.'),
      milestone: stringProp('Milestone id to attach the issue to.')
    },
    ['projectId', 'title']
  ),
  handler: async (ctx, args) => {
    const projectId = args.projectId as string

    const projectIdQuery: Record<string, unknown> = { _id: projectId }
    const project = (await ctx.client.findOne(tracker.class.Project, projectIdQuery as never)) as unknown as
      | ProjectDefaults
      | undefined

    if (project === undefined) {
      return textResult(`No project with id ${projectId} is visible to you, so the issue was not created.`, {
        created: false
      })
    }

    // The task type decides both the issue `kind` and, when the project itself
    // names no default, the first status of the workflow.
    const taskTypeQuery: Record<string, unknown> = { parent: project.type, ofClass: tracker.class.Issue }
    const taskType = (await ctx.client.findOne(task.class.TaskType, taskTypeQuery as never)) as unknown as
      | TaskTypeDefaults
      | undefined

    const statusId = (args.statusId as string | undefined) ?? project.defaultIssueStatus ?? taskType?.statuses?.[0]
    if (statusId === undefined || taskType === undefined) {
      return textResult(
        'The project has no default issue status or issue task type configured, so the issue was not created. ' +
          'Pass an explicit statusId, or ask an administrator to configure the project.',
        { created: false }
      )
    }

    // The body is stored as a blob owned by the collaborator service. Refuse up
    // front, before a number is consumed, when that service is not configured.
    const issueId = generateId<Issue>()
    const description = ((args.description as string | undefined) ?? '').trim()
    let descriptionRef: string | null = null
    if (description !== '') {
      if (ctx.markupWriter === undefined) {
        return textResult(
          'A description was given but this server has no COLLABORATOR_URL configured, so the issue was not ' +
            'created. Retry without a description, or ask the administrator to set COLLABORATOR_URL.',
          { created: false }
        )
      }
      descriptionRef = await ctx.markupWriter.write(tracker.class.Issue, issueId, 'description', description)
    }

    // Numbers are assigned by incrementing the project's sequence counter, which
    // the transactor applies atomically. This is what the web client does, so
    // concurrent creates never receive the same number.
    const increment: Record<string, unknown> = { $inc: { sequence: 1 } }
    const incremented = (await ctx.client.updateDoc(
      tracker.class.Project,
      core.space.Space,
      projectId as never,
      increment as never,
      true
    )) as unknown as { object?: { sequence?: number } }
    const number = incremented.object?.sequence
    if (typeof number !== 'number') {
      throw new Error('The workspace did not return the next issue number')
    }
    const identifier = `${project.identifier ?? '?'}-${number}`

    const attributes: Record<string, unknown> = {
      title: args.title,
      description: descriptionRef,
      assignee: (args.assignee as string | undefined) ?? null,
      component: null,
      milestone: (args.milestone as string | undefined) ?? null,
      number,
      identifier,
      kind: taskType._id,
      status: statusId,
      priority: priorityIndex(args.priority as string | undefined),
      rank: '',
      comments: 0,
      subIssues: 0,
      parents: [],
      childInfo: [],
      relations: [],
      startDate: toTimestamp(args.startDate as string | undefined),
      dueDate: toTimestamp(args.dueDate as string | undefined),
      estimation: 0,
      remainingTime: 0,
      reportedTime: 0,
      reports: 0
    }

    await ctx.client.addCollection(
      tracker.class.Issue,
      projectId as never,
      tracker.ids.NoParent,
      tracker.class.Issue,
      'subIssues',
      attributes as never,
      issueId
    )

    return textResult(JSON.stringify({ id: issueId, key: identifier, title: args.title }, null, 2), {
      created: true,
      issueId
    })
  }
}

interface ProjectDefaults {
  identifier?: string
  type?: string
  defaultIssueStatus?: string | null
}

interface TaskTypeDefaults {
  _id: string
  statuses?: string[]
}

export const updateIssueTool: HulyTool = {
  name: 'huly_update_issue',
  title: 'Update issue',
  description:
    'Change fields on an existing issue. Only the fields you pass are changed; everything else is left alone. ' +
    'Use statusId from huly_list_issue_statuses. Passing null for dueDate, startDate, assignee or ' +
    'milestone clears that field.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      issueId: stringProp('Issue id from huly_list_issues.'),
      title: stringProp('New title.', { maxLength: 500 }),
      statusId: stringProp('New status id from huly_list_issue_statuses.'),
      priority: {
        type: 'string',
        description: 'New priority.',
        enum: ['NoPriority', 'Urgent', 'High', 'Medium', 'Low']
      },
      assignee: stringProp('New assignee person id, or null to unassign.'),
      dueDate: stringProp('New ISO-8601 due date, or null to clear it.'),
      startDate: stringProp('New ISO-8601 start date, or null to clear it.'),
      milestone: stringProp('New milestone id, or null to detach.')
    },
    ['issueId']
  ),
  handler: async (ctx, args) => {
    const issueId = args.issueId as string

    const issueIdQuery: Record<string, unknown> = { _id: issueId }
    const issue = (await ctx.client.findOne(tracker.class.Issue, issueIdQuery as never)) as unknown as
      | IssueRow
      | undefined

    if (issue === undefined) {
      return textResult(`No issue with id ${issueId} is visible to you, so nothing was changed.`, {
        updated: false
      })
    }

    const operations: Record<string, unknown> = {}

    if (args.title !== undefined) operations.title = args.title
    if (args.statusId !== undefined) operations.status = args.statusId
    if (args.priority !== undefined) operations.priority = priorityIndex(args.priority as string)
    if (args.assignee !== undefined) operations.assignee = args.assignee
    if (args.dueDate !== undefined) operations.dueDate = toTimestamp(args.dueDate as string)
    if (args.startDate !== undefined) operations.startDate = toTimestamp(args.startDate as string)
    if (args.milestone !== undefined) operations.milestone = args.milestone

    const changed = Object.keys(operations)
    if (changed.length === 0) {
      return textResult(
        'No fields to update. Pass at least one of title, statusId, priority, assignee, dueDate or milestone.',
        { updated: false }
      )
    }

    await ctx.client.updateDoc(tracker.class.Issue, issue.space as never, issueId as never, operations as never)

    return textResult(`Updated issue ${issueId}: ${changed.sort().join(', ')}.`, { updated: true, changed })
  }
}

export const addCommentTool: HulyTool = {
  name: 'huly_add_issue_comment',
  title: 'Comment on an issue',
  description: 'Append a comment to an issue. Comments are visible to everyone with access to the issue.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      issueId: stringProp('Issue id from huly_list_issues.'),
      text: stringProp('Comment body. Plain text or Markdown.', { minLength: 1, maxLength: 100_000 })
    },
    ['issueId', 'text']
  ),
  handler: async (ctx, args) => {
    const issueId = args.issueId as string
    const issueIdQuery: Record<string, unknown> = { _id: issueId }
    const issue = (await ctx.client.findOne(tracker.class.Issue, issueIdQuery as never)) as unknown as
      | IssueRow
      | undefined

    if (issue === undefined) {
      return textResult(`No issue with id ${issueId} is visible to you, so no comment was added.`, {
        created: false
      })
    }

    // Comments are attached documents living in the issue's own space, and the
    // message body is stored as rich text, not as the raw string the agent sent.
    const messageId = generateId<ChatMessage>()
    const attributes: Record<string, unknown> = { message: toMarkup(args.text as string) }
    await ctx.client.addCollection(
      chunter.class.ChatMessage,
      issue.space as never,
      issueId as never,
      tracker.class.Issue,
      'comments',
      attributes as never,
      messageId
    )

    return textResult(`Commented on issue ${issueId}.`, { created: true, messageId })
  }
}

export const createMilestoneTool: HulyTool = {
  name: 'huly_create_milestone',
  title: 'Create milestone',
  description:
    'Create a milestone in a project and optionally attach existing issues to it. ' +
    'Use huly_list_issues to find issue ids first. Issues that could not be attached are ' +
    'reported back under skippedIssues rather than silently dropped.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      projectId: stringProp('Project id from huly_list_projects.'),
      name: stringProp('Milestone name.', { minLength: 1, maxLength: 200 }),
      description: stringProp('Milestone description.', { maxLength: 20_000 }),
      dueDate: stringProp('ISO-8601 target date.'),
      issueIds: {
        type: 'array',
        description: 'Issue ids to attach to the new milestone.',
        items: { type: 'string' },
        maxItems: 200
      }
    },
    ['projectId', 'name']
  ),
  handler: async (ctx, args) => {
    const projectId = args.projectId as string
    const projectQuery: Record<string, unknown> = { _id: projectId }
    const project = await ctx.client.findOne(tracker.class.Project, projectQuery as never)

    if (project === undefined) {
      return textResult(`No project with id ${projectId} is visible to you, so nothing was created.`, {
        created: false
      })
    }

    const milestoneId = generateId<Milestone>()
    const attributes: Record<string, unknown> = {
      name: args.name,
      description: toMarkup((args.description as string | undefined) ?? ''),
      dueDate: toTimestamp(args.dueDate as string | undefined),
      project: projectId,
      done: []
    }
    await ctx.client.createDoc(tracker.class.Milestone, projectId as never, attributes as never, milestoneId)

    const issueIds = (args.issueIds as string[] | undefined) ?? []
    const attached: string[] = []

    for (const issueId of issueIds) {
      const issueIdQuery: Record<string, unknown> = { _id: issueId }
      const issue = (await ctx.client.findOne(tracker.class.Issue, issueIdQuery as never)) as unknown as
        | IssueRow
        | undefined
      // Silently skipping unknown ids would make a partial failure look like a
      // complete one, so unattached ids are reported back to the caller.
      if (issue === undefined || issue.space !== projectId) continue
      const attach: Record<string, unknown> = { milestone: milestoneId }
      await ctx.client.updateDoc(tracker.class.Issue, issue.space as never, issue._id as never, attach as never)
      attached.push(issue._id)
    }

    return textResult(
      JSON.stringify(
        {
          milestoneId,
          name: args.name,
          attachedIssues: attached,
          skippedIssues: issueIds.filter((id) => !attached.includes(id))
        },
        null,
        2
      ),
      { created: true, milestoneId, attached: attached.length }
    )
  }
}

function toTimestamp (value: string | null | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    throw Error(`"${value}" is not a valid ISO-8601 date`)
  }
  return parsed
}

export const issueTools: HulyTool[] = [
  listIssuesTool,
  getIssueTool,
  listIssueStatusesTool,
  createIssueTool,
  updateIssueTool,
  addCommentTool,
  createMilestoneTool
]
