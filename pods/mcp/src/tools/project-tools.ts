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

import { SortingOrder, type TxOperations } from '@hcengineering/core'
import task, { type Project as TaskProject } from '@hcengineering/task'
import tracker from '@hcengineering/tracker'

import { textResult } from '../mcp/protocol'
import { booleanProp, objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool } from '../mcp/tool'
import { clampLimit } from './shared'

/** Huly's to-do/kanban project class, distinct from a tracker project. */
const taskProjectClass = task.class.Project

/** Fields the project tools read. Structurally typed to keep the casts minimal. */
interface ProjectRow {
  _id: string
  name: string
  description?: string
  identifier?: string
  archived?: boolean
  private?: boolean
  defaultIssueStatus?: string
  defaultAssignee?: string
}

const summarize = (project: ProjectRow, kind: string, issueCount?: number): Record<string, unknown> => ({
  id: project._id,
  kind,
  name: project.name,
  ...(project.identifier === undefined ? {} : { identifier: project.identifier }),
  description: project.description ?? '',
  archived: project.archived === true,
  private: project.private === true,
  ...(issueCount === undefined ? {} : { issueCount })
})

export const listProjectsTool: HulyTool = {
  name: 'huly_list_projects',
  title: 'List projects',
  description:
    'List the projects in this workspace that the authenticated user is a member of. ' +
    'Returns tracker projects (issue tracking) and task projects (to-do / kanban boards) together. ' +
    'Use the returned "id" with the issue, task and document tools. ' +
    'Archived projects are excluded unless includeArchived is true.',
  readOnly: true,
  inputSchema: objectSchema({
    includeArchived: booleanProp('Include archived projects. Defaults to false.'),
    limit: { type: 'integer', description: 'Maximum number of projects to return (1-200, default 50).', default: 50 }
  }),
  handler: async (ctx, args) => {
    const includeArchived = args.includeArchived === true
    const limit = clampLimit(args.limit)
    const visibility: Record<string, unknown> = {
      members: ctx.account,
      ...(includeArchived ? {} : { archived: false })
    }

    const [projects, taskProjects] = await Promise.all([
      ctx.client.findAll(tracker.class.Project, visibility as never, {
        limit,
        sort: { name: SortingOrder.Ascending }
      }) as Promise<unknown>,
      ctx.client.findAll(taskProjectClass, visibility as never, {
        limit,
        sort: { name: SortingOrder.Ascending }
      }) as Promise<unknown>
    ])

    const projectRows = projects as ProjectRow[]
    const taskRows = taskProjects as Array<TaskProject & ProjectRow>
    const issueCounts = await countIssuesPerProject(ctx.client, projectRows.map((project) => project._id))

    const payload = [
      ...projectRows.map((project) => summarize(project, 'tracker', issueCounts.get(project._id) ?? 0)),
      ...taskRows.map((project) => summarize(project, 'task'))
    ]

    if (payload.length === 0) {
      return textResult(
        'No projects found. The user is not a member of any project, or every project is archived.',
        { projects: [] }
      )
    }

    return textResult(JSON.stringify({ projects: payload }, null, 2), { projects: payload })
  }
}

export const getProjectTool: HulyTool = {
  name: 'huly_get_project',
  title: 'Get project details',
  description:
    'Get a single project by id, including its default issue status and assignee. ' +
    'Accepts both tracker project ids and task project ids. ' +
    'Call huly_list_issue_statuses for the set of statuses an issue may be moved to.',
  readOnly: true,
  inputSchema: objectSchema(
    { projectId: stringProp('Project id, as returned by huly_list_projects.') },
    ['projectId']
  ),
  handler: async (ctx, args) => {
    const projectId = args.projectId as string

    const project = (await ctx.client.findOne(tracker.class.Project, { _id: projectId } as never)) as
      | unknown as ProjectRow
      | undefined

    if (project !== undefined) {
      return textResult(
        JSON.stringify(
          {
            ...summarize(project, 'tracker'),
            defaultIssueStatus: project.defaultIssueStatus ?? null,
            defaultAssignee: project.defaultAssignee ?? null
          },
          null,
          2
        ),
        { found: true, kind: 'tracker' }
      )
    }

    const taskProject = (await ctx.client.findOne(taskProjectClass, { _id: projectId } as never)) as
      | unknown as ProjectRow
      | undefined

    if (taskProject !== undefined) {
      return textResult(JSON.stringify(summarize(taskProject, 'task'), null, 2), {
        found: true,
        kind: 'task'
      })
    }

    return textResult(
      `No project with id ${projectId} is visible to you. It may have been deleted, archived, ` +
        'or belong to a space you are not a member of. Use huly_list_projects to see what is available.',
      { found: false }
    )
  }
}

/**
 * Counts issues per project in a single pass.
 *
 * One projected `findAll` rather than N per-project counts: the whole point of
 * listing projects is that a caller then asks about each one, and N+1 queries
 * would dominate the latency of the tool.
 */
async function countIssuesPerProject (client: TxOperations, projectIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (projectIds.length === 0) return counts

  const query: Record<string, unknown> = { space: { $in: projectIds } }
  const issues = (await client.findAll(tracker.class.Issue, query as never, {
    limit: 5000,
    projection: { space: 1 }
  })) as unknown as Array<{ space: string }>

  for (const issue of issues) {
    counts.set(issue.space, (counts.get(issue.space) ?? 0) + 1)
  }
  return counts
}

export const projectTools: HulyTool[] = [listProjectsTool, getProjectTool]
