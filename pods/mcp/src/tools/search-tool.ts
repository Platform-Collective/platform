// SPDX-License-Identifier: EPL-2.0

import contact from '@hcengineering/contact'
import doc from '@hcengineering/document'
import task from '@hcengineering/task'
import tracker from '@hcengineering/tracker'

import { textResult } from '../mcp/protocol'
import { numberProp, objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool } from '../mcp/tool'
import { clampLimit } from './shared'

/** Classes worth searching. Anything outside this list is noise for an agent. */
const SEARCHABLE_CLASSES = [
  tracker.class.Issue,
  tracker.class.Project,
  tracker.class.Milestone,
  doc.class.Document,
  task.class.Task,
  contact.class.Person
] as const

/** Maps a class ref to a stable, human-meaningful type name for the response. */
const TYPE_NAMES: Record<string, string> = {
  [tracker.class.Issue]: 'issue',
  [tracker.class.Project]: 'project',
  [tracker.class.Milestone]: 'milestone',
  [doc.class.Document]: 'document',
  [task.class.Task]: 'task',
  [contact.class.Person]: 'person'
}

export const searchTool: HulyTool = {
  name: 'huly_search',
  title: 'Full-text search',
  description:
    'Full-text search across issues, projects, documents, tasks, milestones and people. ' +
    'This is the best starting point when you do not know the id of what you are looking for; ' +
    'returns ranked results with the matching snippet.',
  readOnly: true,
  inputSchema: objectSchema({
    query: stringProp('Search terms.', { minLength: 1, maxLength: 500 }),
    types: {
      type: 'array',
      description: 'Restrict to certain object types.',
      items: { type: 'string', enum: ['issue', 'project', 'milestone', 'document', 'task', 'person'] }
    },
    limit: numberProp('Maximum results to return (1-50, default 20).', {
      minimum: 1,
      maximum: 50,
      default: 20
    })
  }),
  handler: async (ctx, args) => {
    const query = String(args.query)
    const limit = clampLimit(args.limit, 20)

    const types = (args.types as string[] | undefined) ?? []
    const classes =
      types.length === 0 ? [...SEARCHABLE_CLASSES] : SEARCHABLE_CLASSES.filter((cls) => types.includes(TYPE_NAMES[cls]))

    if (classes.length === 0) {
      return textResult(`No searchable type matches: ${types.join(', ')}.`, { results: [] })
    }

    const result = await ctx.client.searchFulltext({ query, classes: [...classes] }, { limit })

    const results = result.docs.map((entry) => ({
      id: entry.id,
      // `_class` lives on the nested `doc`, not on the search hit itself.
      type: TYPE_NAMES[entry.doc?._class] ?? entry.doc?._class ?? 'unknown',
      title: entry.title ?? entry.shortTitle ?? entry.id,
      snippet: entry.description ?? null,
      score: entry.score ?? null
    }))

    if (results.length === 0) {
      return textResult(
        `No results for "${query}". The index may lag behind recent writes, or the terms may not appear ` +
          'verbatim — try fewer or more general words.',
        { results: [] }
      )
    }

    return textResult(JSON.stringify({ query, total: result.total ?? results.length, results }, null, 2), { results })
  }
}

export const searchTools: HulyTool[] = [searchTool]
