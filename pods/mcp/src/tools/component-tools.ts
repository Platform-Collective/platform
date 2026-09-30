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

import { generateId } from '@hcengineering/core'
import tracker, { type Component } from '@hcengineering/tracker'

import { textResult } from '../mcp/protocol'
import { objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool } from '../mcp/tool'
import { toMarkup } from '../platform/markup'
import { clampLimit, personNames } from './shared'

interface ComponentRow {
  _id: string
  label: string
  lead: string | null
  space: string
}

export const listComponentsTool: HulyTool = {
  name: 'huly_list_components',
  title: 'List components',
  description:
    'List the components of a project (the areas of a product that issues are grouped under). ' +
    'Component ids are what huly_create_issue and huly_update_issue expect as componentId.',
  readOnly: true,
  inputSchema: objectSchema({
    projectId: stringProp('Restrict to one project id from huly_list_projects.'),
    limit: { type: 'integer', description: 'Maximum components to return (1-200, default 50).', default: 50 }
  }),
  handler: async (ctx, args) => {
    const query: Record<string, unknown> = {}
    if (args.projectId !== undefined) query.space = args.projectId

    const components = (await ctx.client.findAll(tracker.class.Component, query as never, {
      limit: clampLimit(args.limit)
    })) as unknown as ComponentRow[]

    if (components.length === 0) {
      return textResult('No components found.', { components: [] })
    }

    const leads = await personNames(
      ctx.client,
      components.map((component) => component.lead)
    )
    const rows = components.map((component) => ({
      id: component._id,
      name: component.label,
      projectId: component.space,
      lead: component.lead === null ? null : (leads.get(component.lead) ?? 'Unknown')
    }))

    return textResult(JSON.stringify({ components: rows }, null, 2), { components: rows })
  }
}

export const createComponentTool: HulyTool = {
  name: 'huly_create_component',
  title: 'Create component',
  description: 'Create a component in a project. Use huly_find_people to look up a lead.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      projectId: stringProp('Project id from huly_list_projects.'),
      name: stringProp('Component name.', { minLength: 1, maxLength: 200 }),
      description: stringProp('Component description. Plain text or Markdown.', { maxLength: 20_000 }),
      lead: stringProp('Person id of the component lead.')
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

    const componentId = generateId<Component>()
    const attributes: Record<string, unknown> = {
      label: args.name,
      description: toMarkup((args.description as string | undefined) ?? ''),
      lead: (args.lead as string | undefined) ?? null,
      comments: 0,
      attachments: 0
    }
    await ctx.client.createDoc(tracker.class.Component, projectId as never, attributes as never, componentId)

    return textResult(JSON.stringify({ componentId, name: args.name }, null, 2), { created: true, componentId })
  }
}

export const componentTools: HulyTool[] = [listComponentsTool, createComponentTool]
