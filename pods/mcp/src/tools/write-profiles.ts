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

import core, { type AnyAttribute, type Class, type Doc, type Hierarchy, type Ref } from '@hcengineering/core'
import document from '@hcengineering/document'
import tags from '@hcengineering/tags'
import task from '@hcengineering/task'
import tracker, { IssuePriority, MilestoneStatus } from '@hcengineering/tracker'

import { type ToolContext } from '../mcp/tool'
import { toMarkup } from '../platform/markup'
import { describeType } from './model-tools'
import { MILESTONE_STATUS_NAMES } from './shared'

/**
 * The classes the generic write tools may touch, and exactly how.
 *
 * A write is only as good as the bookkeeping around it: the web client
 * initialises counters, derives kinds and ranks, and detaches references before
 * a delete. Letting an agent write an arbitrary class would skip all of that and
 * leave documents the UI misrenders. So a class is writable only when it has a
 * profile here, and each profile was exercised against a live workspace.
 * Fields outside `writable` are refused.
 */

export type WriteData = Record<string, unknown>

export interface WriteProfile {
  classId: string
  label: string
  /** Fields accepted on create and update. */
  writable: string[]
  required?: string[]
  /** Array fields huly_update_doc may push to or pull from. */
  pushable?: string[]
  /** Numeric enums exposed to the agent by name. */
  enums?: Record<string, string[]>
  create?: {
    /** `given` when the caller names the space, otherwise the fixed space id. */
    space: 'given' | string
    /** Class the named space must belong to. */
    spaceClass?: string
    defaults: (ctx: ToolContext, data: WriteData) => WriteData
    /** Derives fields that need a lookup. Returns a message to refuse the create. */
    prepare?: (ctx: ToolContext, spaceId: string, data: WriteData) => Promise<WriteData | string>
  }
  remove?: {
    /** Attached documents are removed through their parent's collection. */
    attached?: boolean
    /** Clears references that would otherwise dangle. */
    beforeRemove?: (ctx: ToolContext, doc: Doc) => Promise<void>
  }
}

const PRIORITY_NAMES = Object.keys(IssuePriority).filter((key) => Number.isNaN(Number(key)))
const DEFAULT_MILESTONE_SPAN_MS = 14 * 24 * 60 * 60 * 1000

/** Colour index for a new label, stable per title like the web client's text-derived colour. */
const colorFor = (title: string): number => {
  let sum = 0
  for (const char of title) sum = (sum * 31 + char.charCodeAt(0)) % 1000
  return sum % 20
}

const emptyMarkup = (): string => toMarkup('')

/** Sets a reference field to null on every issue that points at the removed document. */
async function detachFromIssues (ctx: ToolContext, field: 'milestone' | 'component', doc: Doc): Promise<void> {
  const query: Record<string, unknown> = { [field]: doc._id }
  const issues = await ctx.client.findAll(tracker.class.Issue, query as never, { limit: 1000 })
  for (const issue of issues) {
    const clear: Record<string, unknown> = { [field]: null }
    await ctx.client.updateDoc(tracker.class.Issue, issue.space as never, issue._id as never, clear as never)
  }
}

async function issueKindFor (ctx: ToolContext, projectId: string): Promise<WriteData | string> {
  const projectQuery: Record<string, unknown> = { _id: projectId }
  const project = (await ctx.client.findOne(tracker.class.Project, projectQuery as never)) as unknown as
    | { type?: string }
    | undefined
  const taskTypeQuery: Record<string, unknown> = { parent: project?.type, ofClass: tracker.class.Issue }
  const taskType = (await ctx.client.findOne(task.class.TaskType, taskTypeQuery as never)) as unknown as
    | { _id: string }
    | undefined
  return taskType === undefined
    ? 'The project has no issue task type configured, so nothing was created.'
    : { kind: taskType._id }
}

export const WRITE_PROFILES: WriteProfile[] = [
  {
    classId: tracker.class.Component,
    label: 'Issue component',
    writable: ['label', 'description', 'lead'],
    required: ['label'],
    create: {
      space: 'given',
      spaceClass: tracker.class.Project,
      defaults: () => ({ description: emptyMarkup(), lead: null, comments: 0, attachments: 0 })
    },
    remove: {
      beforeRemove: async (ctx, doc) => {
        await detachFromIssues(ctx, 'component', doc)
      }
    }
  },
  {
    classId: tracker.class.Milestone,
    label: 'Issue milestone',
    writable: ['label', 'description', 'status', 'startDate', 'targetDate'],
    required: ['label'],
    enums: { status: MILESTONE_STATUS_NAMES },
    create: {
      space: 'given',
      spaceClass: tracker.class.Project,
      defaults: () => ({
        description: emptyMarkup(),
        status: MilestoneStatus.Planned,
        comments: 0,
        attachments: 0,
        startDate: null,
        targetDate: Date.now() + DEFAULT_MILESTONE_SPAN_MS
      })
    },
    remove: {
      beforeRemove: async (ctx, doc) => {
        await detachFromIssues(ctx, 'milestone', doc)
      }
    }
  },
  {
    classId: tracker.class.IssueTemplate,
    label: 'Issue template',
    writable: ['title', 'description', 'priority', 'assignee', 'component', 'milestone', 'estimation', 'labels'],
    required: ['title'],
    enums: { priority: PRIORITY_NAMES },
    create: {
      space: 'given',
      spaceClass: tracker.class.Project,
      defaults: () => ({
        description: emptyMarkup(),
        priority: IssuePriority.NoPriority,
        assignee: null,
        component: null,
        milestone: null,
        estimation: 0,
        children: [],
        labels: [],
        relations: [],
        comments: 0,
        attachments: 0
      }),
      // The task type decides the `kind`, as it does for a new issue.
      prepare: async (ctx, spaceId) => await issueKindFor(ctx, spaceId)
    },
    remove: {}
  },
  {
    classId: tags.class.TagElement,
    label: 'Label',
    writable: ['title', 'description', 'color', 'targetClass', 'category'],
    required: ['title'],
    create: {
      space: core.space.Workspace,
      defaults: (_ctx, data) => ({
        description: '',
        targetClass: tracker.class.Issue,
        color: colorFor(String(data.title ?? '')),
        category: tags.category.NoCategory
      })
    },
    remove: {}
  },
  {
    classId: document.class.Teamspace,
    label: 'Document teamspace',
    writable: ['name', 'description', 'private', 'archived', 'members', 'owners', 'autoJoin'],
    required: ['name'],
    pushable: ['members', 'owners'],
    create: {
      space: core.space.Space,
      // The creator becomes a member and owner, as in the web client.
      defaults: (ctx) => ({
        description: '',
        private: false,
        archived: false,
        autoJoin: false,
        autoJoinForRoles: [],
        members: [ctx.account],
        owners: [ctx.account],
        type: document.spaceType.DefaultTeamspaceType
      })
    },
    remove: {}
  },
  {
    classId: tracker.class.Project,
    label: 'Tracker project',
    writable: ['name', 'description', 'private', 'archived', 'members', 'owners', 'autoJoin', 'defaultAssignee'],
    pushable: ['members', 'owners']
  },
  { classId: tracker.class.Issue, label: 'Issue', writable: [], remove: { attached: true } },
  { classId: document.class.Document, label: 'Document', writable: [], remove: {} }
]

export const profileFor = (classId: string): WriteProfile | undefined =>
  WRITE_PROFILES.find((profile) => profile.classId === classId)

const classesWhere = (test: (profile: WriteProfile) => boolean): string[] =>
  WRITE_PROFILES.filter(test).map((profile) => profile.classId)

export const creatableClasses = (): string[] => classesWhere((profile) => profile.create !== undefined)
export const updatableClasses = (): string[] => classesWhere((profile) => profile.writable.length > 0)
export const removableClasses = (): string[] => classesWhere((profile) => profile.remove !== undefined)

export type CoerceResult = { ok: true, data: WriteData } | { ok: false, error: string }

function attributesOf (hierarchy: Hierarchy, classId: string): Map<string, AnyAttribute> {
  try {
    return hierarchy.getAllAttributes(classId as Ref<Class<Doc>>, core.class.Doc)
  } catch {
    return new Map()
  }
}

const toMillis = (value: unknown): number | null | undefined => {
  if (value === null) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

/**
 * Checks caller-supplied fields against the profile and the model, and converts
 * them to stored form: Markdown to rich text, ISO dates to epoch milliseconds,
 * enum names to their numeric value.
 */
export function coerceFields (hierarchy: Hierarchy, profile: WriteProfile, input: WriteData): CoerceResult {
  const attributes = attributesOf(hierarchy, profile.classId)
  const data: WriteData = {}

  for (const [field, value] of Object.entries(input)) {
    if (!profile.writable.includes(field)) {
      const allowed = profile.writable.length === 0 ? 'none' : profile.writable.join(', ')
      return { ok: false, error: `"${field}" cannot be set on ${profile.classId}. Writable fields: ${allowed}.` }
    }
    const attribute = attributes.get(field)
    if (attribute === undefined) {
      return { ok: false, error: `"${field}" is not a field of ${profile.classId} in this workspace.` }
    }

    const enumNames = profile.enums?.[field]
    if (enumNames !== undefined) {
      const index = typeof value === 'string' ? enumNames.indexOf(value) : -1
      if (index < 0) return { ok: false, error: `"${field}" must be one of: ${enumNames.join(', ')}.` }
      data[field] = index
      continue
    }

    const type = describeType(attribute.type as never).type
    const fail = (expected: string): CoerceResult => ({ ok: false, error: `"${field}" must be ${expected}.` })

    switch (type) {
      case 'String':
        if (typeof value !== 'string') return fail('a string')
        data[field] = value
        break
      case 'Number':
      case 'Estimation':
        if (typeof value !== 'number') return fail('a number')
        data[field] = value
        break
      case 'Boolean':
        if (typeof value !== 'boolean') return fail('true or false')
        data[field] = value
        break
      case 'Date':
      case 'Timestamp': {
        const millis = toMillis(value)
        if (millis === undefined) return fail('an ISO-8601 date, epoch milliseconds, or null')
        data[field] = millis
        break
      }
      case 'Ref':
        if (value !== null && typeof value !== 'string') return fail('an id string or null')
        data[field] = value
        break
      case 'Array':
        if (!Array.isArray(value)) return fail('an array')
        data[field] = value
        break
      case 'Markup':
        if (typeof value !== 'string') return fail('Markdown text')
        data[field] = toMarkup(value)
        break
      default:
        data[field] = value
    }
  }

  return { ok: true, data }
}
