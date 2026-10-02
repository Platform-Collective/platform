// SPDX-License-Identifier: EPL-2.0

import core, { generateId, type Class, type Doc, type Hierarchy, type Ref } from '@hcengineering/core'

import { textResult } from '../mcp/protocol'
import { objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool } from '../mcp/tool'
import { mayDelete, mayManageSpace } from './caller-rights'
import {
  checkArrayItem,
  coerceFields,
  creatableClasses,
  profileFor,
  removableClasses,
  updatableClasses,
  type WriteData,
  type WriteProfile
} from './write-profiles'

/**
 * Generic create, update and delete for the classes that have a write profile.
 *
 * All three run as the caller through the workspace client, so the transactor
 * still decides whether the caller may touch the target space or document.
 */

const unsupported = (action: string, classId: string, supported: string[]): string =>
  `${classId} cannot be ${action} through the generic tools. Supported: ${supported.join(', ')}. ` +
  'Other classes can be read with huly_find but not written yet.'

const isObject = (value: unknown): value is WriteData =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Narrows a field value to the id list that array fields such as members hold. */
const idList = (value: unknown): string[] | undefined => (Array.isArray(value) ? (value as string[]) : undefined)

export const createDocTool: HulyTool = {
  name: 'huly_create_doc',
  title: 'Create a document of a supported class',
  description:
    'Create a component, milestone, issue template, label or document teamspace. data holds the fields ' +
    '(see huly_describe_class for names and types); dates are ISO-8601, rich text is Markdown, and ' +
    'counters and defaults are filled in for you. spaceId is required for project-scoped classes ' +
    '(component, milestone, issue template) and ignored for labels and teamspaces. ' +
    'Supported classes: ' +
    creatableClasses().join(', ') +
    '. Issues and documents have their own tools.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      classId: stringProp('Class id to create.'),
      spaceId: stringProp('Project id for project-scoped classes.'),
      data: { type: 'object', description: 'Field values, e.g. {"label": "Backend"}.' }
    },
    ['classId', 'data']
  ),
  handler: async (ctx, args) => {
    const classId = args.classId as string
    const profile = profileFor(classId)
    if (profile?.create === undefined) {
      return textResult(unsupported('created', classId, creatableClasses()), { created: false })
    }
    const create = profile.create

    const hierarchy = ctx.client.getHierarchy()
    const coerced = coerceFields(hierarchy, profile, args.data as WriteData)
    if (!coerced.ok) return textResult(coerced.error, { created: false })

    const missing = (profile.required ?? []).filter((field) => coerced.data[field] === undefined)
    if (missing.length > 0) {
      return textResult(`Missing required field(s) for ${classId}: ${missing.join(', ')}.`, { created: false })
    }

    let spaceId: string
    if (create.space === 'given') {
      if (typeof args.spaceId !== 'string') {
        return textResult(`spaceId is required to create a ${classId}. Use huly_list_projects to find one.`, {
          created: false
        })
      }
      const query: Record<string, unknown> = { _id: args.spaceId }
      const space = (await ctx.client.findOne(core.class.Space, query as never)) as unknown as
        | { _class: string }
        | undefined
      if (space === undefined) {
        return textResult(`No space with id ${args.spaceId} is visible to you, so nothing was created.`, {
          created: false
        })
      }
      if (create.spaceClass !== undefined && !hierarchy.isDerived(space._class as Ref<Class<Doc>>, create.spaceClass as Ref<Class<Doc>>)) {
        return textResult(`${classId} can only be created in a ${create.spaceClass}; ${args.spaceId} is a ${space._class}.`, {
          created: false
        })
      }
      spaceId = args.spaceId
    } else {
      spaceId = create.space
    }

    // The caller's data wins over the defaults, except for the array fields the
    // profile lists in unionDefaults: there the default items are kept as well,
    // so a caller passing `members: []` cannot create a teamspace they are not
    // a member or owner of — and therefore cannot manage afterwards.
    const defaults = create.defaults(ctx, coerced.data)
    let values: WriteData = { ...defaults, ...coerced.data }
    for (const field of create.unionDefaults ?? []) {
      const base = idList(defaults[field])
      const given = idList(coerced.data[field])
      if (base !== undefined && given !== undefined) {
        values[field] = [...new Set([...base, ...given])]
      }
    }
    if (create.prepare !== undefined) {
      const prepared = await create.prepare(ctx, spaceId, values)
      if (typeof prepared === 'string') return textResult(prepared, { created: false })
      values = { ...values, ...prepared }
    }

    const id = generateId<Doc>()
    await ctx.client.createDoc(classId as Ref<Class<Doc>>, spaceId as never, values as never, id)

    return textResult(JSON.stringify({ id, classId, spaceId }, null, 2), { created: true, id })
  }
}

/**
 * Builds the `$push` / `$pull` operations, refusing fields the profile does not
 * allow and items whose type does not match what the field holds — `$push` and
 * `$pull` each carry ONE item, never a whole replacement list.
 */
function arrayOperations (
  hierarchy: Hierarchy,
  profile: WriteProfile,
  push: WriteData | undefined,
  pull: WriteData | undefined
): { ok: true, operations: WriteData } | { ok: false, error: string } {
  const operations: WriteData = {}
  for (const [key, source] of [['$push', push], ['$pull', pull]] as const) {
    if (source === undefined) continue
    for (const [field, item] of Object.entries(source)) {
      if (!(profile.pushable ?? []).includes(field)) {
        const pushable = profile.pushable ?? []
        const allowed = pushable.length === 0 ? 'none' : pushable.join(', ')
        return { ok: false, error: `"${field}" cannot be added to or removed from on ${profile.classId}. Allowed: ${allowed}.` }
      }
      const wrongType = checkArrayItem(hierarchy, profile, field, item)
      if (wrongType !== undefined) return { ok: false, error: wrongType }
    }
    operations[key] = source
  }
  return { ok: true, operations }
}

export const updateDocTool: HulyTool = {
  name: 'huly_update_doc',
  title: 'Update a document of a supported class',
  description:
    'Change fields on a component, milestone, issue template, label, document teamspace or tracker project. ' +
    'data sets fields; push and pull add or remove one item from an array field such as members or owners ' +
    '(e.g. push {"members": "<account id>"} to add a member to a project or teamspace). ' +
    'Only the fields you pass change. Supported classes: ' +
    updatableClasses().join(', ') +
    '. Issues and documents have their own update tools.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      classId: stringProp('Class id of the document.'),
      id: stringProp('Document id from huly_find.'),
      data: { type: 'object', description: 'Fields to set.' },
      push: { type: 'object', description: 'Array field -> item to add, e.g. {"members": "<account id>"}.' },
      pull: { type: 'object', description: 'Array field -> item to remove.' }
    },
    ['classId', 'id']
  ),
  handler: async (ctx, args) => {
    const classId = args.classId as string
    const profile = profileFor(classId)
    if (profile === undefined || profile.writable.length === 0) {
      return textResult(unsupported('updated', classId, updatableClasses()), { updated: false })
    }

    const data = isObject(args.data) ? args.data : {}
    const hierarchy = ctx.client.getHierarchy()
    const coerced = coerceFields(hierarchy, profile, data)
    if (!coerced.ok) return textResult(coerced.error, { updated: false })

    const arrays = arrayOperations(
      hierarchy,
      profile,
      isObject(args.push) ? args.push : undefined,
      isObject(args.pull) ? args.pull : undefined
    )
    if (!arrays.ok) return textResult(arrays.error, { updated: false })

    const operations: WriteData = { ...coerced.data, ...arrays.operations }
    if (Object.keys(operations).length === 0) {
      return textResult('Nothing to change. Pass data, push or pull.', { updated: false })
    }

    const query: Record<string, unknown> = { _id: args.id }
    const doc = (await ctx.client.findOne(classId as Ref<Class<Doc>>, query as never)) as unknown as Doc | undefined
    if (doc === undefined) {
      return textResult(`No ${classId} with id ${String(args.id)} is visible to you, so nothing was changed.`, {
        updated: false
      })
    }

    // The transactor lets any member write to a public space; the web app only lets its owners manage it.
    if (hierarchy.isDerived(classId as Ref<Class<Doc>>, core.class.Space as Ref<Class<Doc>>) && !(await mayManageSpace(ctx, doc))) {
      return textResult(
        `Only a workspace owner, an owner of this ${profile.label.toLowerCase()}, or its creator may change it. ` +
          'Nothing was changed.',
        { updated: false }
      )
    }

    await ctx.client.updateDoc(classId as Ref<Class<Doc>>, doc.space as never, doc._id as never, operations as never)

    return textResult(`Updated ${classId} ${String(args.id)}: ${Object.keys(operations).sort().join(', ')}.`, {
      updated: true,
      changed: Object.keys(operations)
    })
  }
}

export const deleteDocTool: HulyTool = {
  name: 'huly_delete_doc',
  title: 'Delete a document of a supported class',
  description:
    'Permanently delete an issue, document, component, milestone, issue template, label or document teamspace. ' +
    'This cannot be undone. Deleting a component or milestone detaches the issues that used it first. ' +
    'Supported classes: ' +
    removableClasses().join(', ') +
    '. A tracker project is archived with huly_update_doc {"archived": true} instead.',
  readOnly: false,
  destructive: true,
  inputSchema: objectSchema({ classId: stringProp('Class id of the document.'), id: stringProp('Document id.') }, [
    'classId',
    'id'
  ]),
  handler: async (ctx, args) => {
    const classId = args.classId as string
    const profile = profileFor(classId)
    if (profile?.remove === undefined) {
      return textResult(unsupported('deleted', classId, removableClasses()), { deleted: false })
    }
    const remove = profile.remove

    const query: Record<string, unknown> = { _id: args.id }
    const doc = (await ctx.client.findOne(classId as Ref<Class<Doc>>, query as never)) as unknown as
      | (Doc & { attachedTo?: string, attachedToClass?: string, collection?: string })
      | undefined
    if (doc === undefined) {
      return textResult(`No ${classId} with id ${String(args.id)} is visible to you, so nothing was deleted.`, {
        deleted: false
      })
    }

    // Same rule as the web app's delete action: a workspace owner, or the creator.
    if (!(await mayDelete(ctx, doc))) {
      return textResult(
        `Only a workspace owner or the creator of this ${profile.label.toLowerCase()} may delete it. Nothing was deleted.`,
        { deleted: false }
      )
    }

    // A string from beforeRemove refuses the delete, as a string from prepare refuses a create.
    const refusal = await remove.beforeRemove?.(ctx, doc)
    if (typeof refusal === 'string') {
      return textResult(refusal, { deleted: false })
    }

    if (remove.attached === true) {
      await ctx.client.removeCollection(
        classId as Ref<Class<Doc>>,
        doc.space as never,
        doc._id as never,
        doc.attachedTo as never,
        doc.attachedToClass as never,
        doc.collection as string
      )
    } else {
      await ctx.client.removeDoc(classId as Ref<Class<Doc>>, doc.space as never, doc._id as never)
    }

    return textResult(`Deleted ${classId} ${String(args.id)}.`, { deleted: true })
  }
}

export const genericWriteTools: HulyTool[] = [createDocTool, updateDocTool, deleteDocTool]
