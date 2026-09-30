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

import core, { type AnyAttribute, type Class, type Doc, type Hierarchy, type Ref, SortingOrder } from '@hcengineering/core'

import { textResult } from '../mcp/protocol'
import { booleanProp, objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool, type ToolContext } from '../mcp/tool'
import { fromMarkup } from '../platform/markup'
import { truncate } from '../platform/markup-reader'
import { clampLimit } from './shared'

/**
 * Generic, read-only access to any class in the workspace model.
 *
 * The curated tools cover the common screens. These four let an agent reach
 * everything else (templates, space types, custom fields, other apps) by first
 * discovering what exists. They run as the caller through the workspace
 * client, so the transactor decides which documents come back.
 */

/** Ceiling on the serialised size of one tool result, to protect the model's context window. */
const MAX_RESULT_CHARS = 60_000
/** Ceiling on one resolved rich-text field. */
const MAX_MARKUP_CHARS = 20_000

/** Attributes every document carries; they are not listed per class. */
const BASE_FIELDS = ['_id', '_class', 'space', 'modifiedOn', 'modifiedBy', 'createdOn', 'createdBy']

const RICH_TEXT_TYPES: string[] = [core.class.TypeCollaborativeDoc, core.class.TypeMarkup]

const classKind = (hierarchy: Hierarchy, id: Ref<Class<Doc>>): 'mixin' | 'class' =>
  hierarchy.isMixin(id) ? 'mixin' : 'class'

/** Domain of a class, or undefined when it is abstract and so cannot be queried. */
function domainOf (hierarchy: Hierarchy, id: string): string | undefined {
  return hierarchy.findDomain(id as Ref<Class<Doc>>)
}

/** Refuses ids that are not queryable classes, with a pointer to the discovery tool. */
function queryableError (hierarchy: Hierarchy, id: string): string | undefined {
  if (!hierarchy.hasClass(id as Ref<Class<Doc>>)) {
    return `"${id}" is not a class in this workspace. Call huly_list_classes to find the right id.`
  }
  if (domainOf(hierarchy, id) === undefined) {
    return `"${id}" is an abstract class and cannot be queried directly. Call huly_list_classes with extends="${id}" to see the classes derived from it.`
  }
  return undefined
}

/** Model type classes whose own names read poorly to an agent. */
const TYPE_NAMES: Record<string, string> = { RefTo: 'Ref', ArrOf: 'Array', EnumOf: 'Enum' }

interface TypeDescription {
  type: string
  to?: string
  of?: string | TypeDescription
}

/** Reduces a model `Type` to a short, readable description. */
function describeType (type: { _class: string, to?: string, of?: unknown }): TypeDescription {
  const name = type._class.split(':').pop() ?? type._class
  const kind = TYPE_NAMES[name] ?? (name.startsWith('Type') ? name.slice(4) : name)
  const result: TypeDescription = { type: kind }
  if (typeof type.to === 'string') result.to = type.to
  if (typeof type.of === 'string') result.of = type.of
  else if (typeof type.of === 'object' && type.of !== null) result.of = describeType(type.of as never)
  return result
}

export const listClassesTool: HulyTool = {
  name: 'huly_list_classes',
  title: 'List model classes',
  description:
    'Discover what kinds of objects exist in this workspace. Returns class ids you can pass to ' +
    'huly_describe_class, huly_find and huly_get_doc. Narrow with search (substring of the id) or ' +
    'extends (a parent class id, e.g. "core:class:Space" for every kind of space). ' +
    'By default only classes that can be queried are listed.',
  readOnly: true,
  inputSchema: objectSchema({
    search: stringProp('Case-insensitive substring of the class id, e.g. "template" or "tracker".'),
    extends: stringProp('Only classes derived from this class id. Defaults to core:class:Doc (all documents).'),
    kind: { type: 'string', description: 'Restrict to classes or to mixins.', enum: ['class', 'mixin'] },
    includeAbstract: booleanProp('Also list abstract classes that cannot be queried. Defaults to false.'),
    limit: { type: 'integer', description: 'Maximum classes to return (1-200, default 100).', default: 100 }
  }),
  handler: async (ctx, args) => {
    const hierarchy = ctx.client.getHierarchy()
    const root = (args.extends as string | undefined) ?? core.class.Doc

    if (!hierarchy.hasClass(root as Ref<Class<Doc>>)) {
      return textResult(`"${root}" is not a class in this workspace.`, { classes: [] })
    }

    const needle = (args.search as string | undefined)?.toLowerCase()
    const limit = clampLimit(args.limit, 100)

    const candidates = new Set<string>([root, ...hierarchy.getDescendants(root as Ref<Class<Doc>>)])
    const rows: Array<Record<string, unknown>> = []
    let matched = 0

    for (const id of [...candidates].sort()) {
      const klass = hierarchy.findClass(id as Ref<Class<Doc>>)
      if (klass === undefined) continue
      if (needle !== undefined && !id.toLowerCase().includes(needle)) continue
      const kind = classKind(hierarchy, id as Ref<Class<Doc>>)
      if (args.kind !== undefined && args.kind !== kind) continue
      const domain = domainOf(hierarchy, id)
      if (domain === undefined && args.includeAbstract !== true) continue

      matched++
      if (rows.length < limit) {
        rows.push({ id, kind, extends: klass.extends ?? null, queryable: domain !== undefined, domain: domain ?? null })
      }
    }

    if (rows.length === 0) {
      return textResult('No classes matched. Try a shorter search or a different extends.', { classes: [] })
    }

    const payload = { total: matched, returned: rows.length, classes: rows }
    return textResult(JSON.stringify(payload, null, 2), payload)
  }
}

export const describeClassTool: HulyTool = {
  name: 'huly_describe_class',
  title: 'Describe a class',
  description:
    'Show the fields of a class: each field\'s name and type (a Ref field names the class it points to), ' +
    'whether it is required, and whether it is a custom field added by a user. Also lists the parent ' +
    'classes and collections of attached documents. Every document also has ' +
    BASE_FIELDS.join(', ') +
    '.',
  readOnly: true,
  inputSchema: objectSchema({ classId: stringProp('Class id from huly_list_classes.') }, ['classId']),
  handler: async (ctx, args) => {
    const hierarchy = ctx.client.getHierarchy()
    const id = args.classId as string
    const ref = id as Ref<Class<Doc>>

    if (!hierarchy.hasClass(ref)) {
      return textResult(`"${id}" is not a class in this workspace. Call huly_list_classes to find the right id.`, {
        found: false
      })
    }

    let attributes: Map<string, AnyAttribute>
    try {
      attributes = hierarchy.getAllAttributes(ref, core.class.Doc)
    } catch {
      attributes = hierarchy.getAllAttributes(ref)
    }

    const fields: Array<Record<string, unknown>> = []
    const collections: Array<Record<string, unknown>> = []

    for (const [name, attribute] of attributes) {
      if (attribute.hidden === true) continue
      const description = describeType(attribute.type as never)
      if (description.type === 'Collection') {
        collections.push({ name, of: description.of })
        continue
      }
      fields.push({
        name,
        ...description,
        required: attribute.required === true,
        custom: attribute.isCustom === true
      })
    }

    const klass = hierarchy.findClass(ref)
    const payload = {
      id,
      kind: classKind(hierarchy, ref),
      extends: klass?.extends ?? null,
      domain: domainOf(hierarchy, id) ?? null,
      queryable: domainOf(hierarchy, id) !== undefined,
      fields,
      collections
    }
    return textResult(JSON.stringify(payload, null, 2), { found: true, ...payload })
  }
}

/** Serialises rows, dropping from the end until the result fits the size ceiling. */
function fitRows (rows: Array<Record<string, unknown>>): { rows: Array<Record<string, unknown>>, truncated: boolean } {
  let kept = rows
  while (kept.length > 1 && JSON.stringify(kept).length > MAX_RESULT_CHARS) {
    kept = kept.slice(0, Math.ceil(kept.length / 2))
  }
  return { rows: kept, truncated: kept.length < rows.length }
}

function project (doc: Record<string, unknown>, fields: string[] | undefined): Record<string, unknown> {
  if (fields === undefined) return doc
  const picked: Record<string, unknown> = {}
  for (const name of ['_id', '_class', ...fields]) {
    if (name in doc) picked[name] = doc[name]
  }
  return picked
}

export const findTool: HulyTool = {
  name: 'huly_find',
  title: 'Find documents of any class',
  description:
    'Query documents of any class. query is a filter object of field: value pairs; a value can be an ' +
    'operator object such as {"$in": [...]}, {"$ne": x}, {"$gt": n}, {"$like": "%text%"}. ' +
    'Get class ids from huly_list_classes and field names from huly_describe_class. ' +
    'Use fields to return only some columns. Returns at most 200 documents and reports the total match count. ' +
    'Rich-text fields come back as stored references; use huly_get_doc to read them as text.',
  readOnly: true,
  inputSchema: objectSchema(
    {
      classId: stringProp('Class id from huly_list_classes.'),
      query: { type: 'object', description: 'Filter, e.g. {"space": "<id>", "title": {"$like": "%bug%"}}. Omit for all.' },
      fields: {
        type: 'array',
        description: 'Only return these fields (plus _id and _class).',
        items: { type: 'string' },
        maxItems: 50
      },
      sortBy: stringProp('Field to sort by. Defaults to most recently modified first.'),
      ascending: booleanProp('Sort ascending instead of descending.'),
      limit: { type: 'integer', description: 'Maximum documents to return (1-200, default 50).', default: 50 }
    },
    ['classId']
  ),
  handler: async (ctx, args) => {
    const hierarchy = ctx.client.getHierarchy()
    const id = args.classId as string

    const problem = queryableError(hierarchy, id)
    if (problem !== undefined) return textResult(problem, { found: false })

    const query = (args.query as Record<string, unknown> | undefined) ?? {}
    const sortField = (args.sortBy as string | undefined) ?? 'modifiedOn'
    const descending = args.sortBy === undefined ? true : args.ascending !== true

    const found = await ctx.client.findAll(id as Ref<Class<Doc>>, query as never, {
      limit: clampLimit(args.limit),
      sort: { [sortField]: descending ? SortingOrder.Descending : SortingOrder.Ascending },
      total: true
    })

    if (found.length === 0) {
      return textResult('No documents matched. Check the field names with huly_describe_class.', {
        total: 0,
        documents: []
      })
    }

    const fields = args.fields as string[] | undefined
    const projected = (found as unknown as Array<Record<string, unknown>>).map((doc) => project(doc, fields))
    const { rows, truncated } = fitRows(projected)

    const payload = {
      total: found.total >= 0 ? found.total : found.length,
      returned: rows.length,
      ...(truncated ? { truncated: true, note: 'Output was cut to fit; narrow the query or pass fields.' } : {}),
      documents: rows
    }
    return textResult(JSON.stringify(payload, null, 2), {
      total: payload.total,
      returned: rows.length,
      truncated
    })
  }
}

/** Resolves one rich-text value (inline markup or a blob reference) to Markdown. */
async function readRichText (ctx: ToolContext, value: string): Promise<string> {
  const text = value.trimStart().startsWith('{') ? fromMarkup(value) : await ctx.markup.read(value)
  return truncate(text.trim(), MAX_MARKUP_CHARS)
}

export const getDocTool: HulyTool = {
  name: 'huly_get_doc',
  title: 'Get one document of any class',
  description:
    'Fetch one document by id with every field, and read its rich-text fields (descriptions, page bodies) ' +
    'as Markdown instead of stored references. Get the class id and document id from huly_find.',
  readOnly: true,
  inputSchema: objectSchema(
    { classId: stringProp('Class id of the document.'), id: stringProp('Document id.') },
    ['classId', 'id']
  ),
  handler: async (ctx, args) => {
    const hierarchy = ctx.client.getHierarchy()
    const classId = args.classId as string

    const problem = queryableError(hierarchy, classId)
    if (problem !== undefined) return textResult(problem, { found: false })

    const query: Record<string, unknown> = { _id: args.id }
    const doc = (await ctx.client.findOne(classId as Ref<Class<Doc>>, query as never)) as unknown as
      | Record<string, unknown>
      | undefined

    if (doc === undefined) {
      return textResult(
        `No ${classId} with id ${String(args.id)} is visible to you. It may not exist or be in a space you cannot access.`,
        { found: false }
      )
    }

    const attributes = hierarchy.getAllAttributes((doc._class ?? classId) as Ref<Class<Doc>>, core.class.Doc)
    const resolved: string[] = []
    const result: Record<string, unknown> = { ...doc }

    for (const [name, attribute] of attributes) {
      const value = doc[name]
      if (!RICH_TEXT_TYPES.includes(attribute.type._class) || typeof value !== 'string' || value === '') continue
      result[name] = await readRichText(ctx, value)
      resolved.push(name)
    }

    return textResult(JSON.stringify(result, null, 2), { found: true, id: doc._id, richTextFields: resolved })
  }
}

export const modelTools: HulyTool[] = [listClassesTool, describeClassTool, findTool, getDocTool]
