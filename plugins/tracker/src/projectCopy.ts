//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { AccountUuid, Class, Doc, PersonId, Ref, Space } from '@hcengineering/core'
import type { FilteredView } from '@hcengineering/view'
import type { Project, WorkingDaysConfig } from './index'
import type { InsightChart } from './insightChart'
import { addDays, daysBetween, startOfDay, type Iteration } from './iteration'
import { MAX_PROJECT_FIELDS, type ProjectField } from './projectField'
import type { Workflow } from './workflow'

// Copying a project (GitHub "Copy project", "Use this template"). GitHub copies the fields, views, workflows and
// Insights charts of a project (and, as an option, its draft items). The copy is built as a plan first, a plain list
// of documents to create, so that the id remapping can be tested without a server and the whole copy can be applied
// in one batch together with the new project.
//
//  - Fields keep their `key` (items and views address a custom field by its key, `customFields.<key>`) and the
//    values of their select options, only the document ids are new.
//  - Iterations are recreated for the new Iteration fields, moved by whole days so that the first one of each field
//    starts today (durations, gaps and breaks stay as they are).
//  - Views keep everything they are made of. Whatever refers to a document id of the source (iteration ids in column
//    limits and filters, the project in the location) is rewritten to the new ids.
//  - Workflows keep their enabled state, filter and target (they refer to the field key and the option value).
//  - Insights charts are copied as they are (they refer to the field key too).
//  - Issues are NOT copied (`includeIssues` is not supported): Huly has no draft items, an issue belongs to exactly
//    one project and numbering, status and parent links would have to be rebuilt.

/** The project documents a copy is made from. @public */
export interface ProjectCopySource {
  project: Pick<Project, '_id' | 'shortDescription' | 'readme' | 'workingDaysConfig'>
  fields: readonly ProjectField[]
  iterations: readonly Iteration[]
  views: readonly FilteredView[]
  workflows: readonly Workflow[]
  charts: readonly InsightChart[]
}

/**
 * The classes of the documents a copy creates. They are passed in so that this module stays free of runtime imports
 * (the plugin ids live in `tracker` and `view`, which would make a cycle here).
 * @public
 */
export interface ProjectCopyClasses {
  field: Ref<Class<Doc>>
  iteration: Ref<Class<Doc>>
  view: Ref<Class<Doc>>
  workflow: Ref<Class<Doc>>
  chart: Ref<Class<Doc>>
}

/** @public */
export interface ProjectCopyOptions {
  classes: ProjectCopyClasses
  // The new project
  target: Ref<Project>
  now: number
  // Source of the ids of the new documents
  generateId: () => string
  // Owner of the copied views
  author: { account: AccountUuid, person: PersonId }
}

/** One document to create. @public */
export interface ProjectCopyOp {
  _class: Ref<Class<Doc>>
  space: Ref<Space>
  id: Ref<Doc>
  data: Record<string, any>
}

/** @public */
export interface ProjectCopyPlan {
  // Properties of the new project that come from the source
  projectData: { shortDescription?: string, readme?: string, workingDaysConfig?: WorkingDaysConfig }
  // Everything to create after the project, in the order it has to be created
  ops: ProjectCopyOp[]
  // Old id -> new id
  fieldIds: ReadonlyMap<string, string>
  iterationIds: ReadonlyMap<string, string>
  viewIds: ReadonlyMap<string, string>
}

// Ids shorter than this are never replaced inside text (they could be part of anything)
const MIN_REPLACED_ID_LENGTH = 8

function clone<T> (value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

/**
 * Replace every occurrence of the old ids in the text by the new ones. The ids are random, so a plain replacement is
 * safe; it also reaches ids inside the JSON strings the views store their filters in.
 */
function replaceIds (text: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  let result = text
  for (const [from, to] of pairs) {
    if (from.length < MIN_REPLACED_ID_LENGTH || from === to) continue
    result = result.split(from).join(to)
  }
  return result
}

function remapJson<T> (value: T, pairs: ReadonlyArray<readonly [string, string]>): T {
  if (value === undefined) return value
  return JSON.parse(replaceIds(JSON.stringify(value), pairs))
}

function withoutUndefined (data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) result[key] = value
  }
  return result
}

/**
 * Plan of the copy of a project: the documents to create in the new project, with every id remapped.
 * @public
 */
export function buildProjectCopyPlan (source: ProjectCopySource, options: ProjectCopyOptions): ProjectCopyPlan {
  const { target, now, generateId, author, classes } = options
  const ops: ProjectCopyOp[] = []

  // ---- fields ----
  const fieldIds = new Map<string, string>()
  const fields = [...source.fields].sort((a, b) => a.position - b.position).slice(0, MAX_PROJECT_FIELDS)
  for (const field of fields) {
    const id = generateId()
    fieldIds.set(field._id, id)
    ops.push({
      _class: classes.field,
      space: target,
      id: id as Ref<Doc>,
      data: withoutUndefined({
        label: field.label,
        key: field.key,
        type: field.type,
        position: field.position,
        description: field.description,
        defaultValue: field.defaultValue,
        options: clone(field.options)
      })
    })
  }

  // ---- iterations ----
  const iterationIds = new Map<string, string>()
  const today = startOfDay(now)
  const firstStart = new Map<string, number>()
  for (const it of source.iterations) {
    const first = firstStart.get(it.field)
    if (first === undefined || it.startDate < first) firstStart.set(it.field, it.startDate)
  }
  const iterations = [...source.iterations].sort((a, b) => a.startDate - b.startDate || a.number - b.number)
  for (const it of iterations) {
    const newField = fieldIds.get(it.field)
    // The iterations of a field that was not copied have nowhere to go
    if (newField === undefined) continue
    const id = generateId()
    iterationIds.set(it._id, id)
    const shift = daysBetween(firstStart.get(it.field) ?? it.startDate, today)
    ops.push({
      _class: classes.iteration,
      space: target,
      id: id as Ref<Doc>,
      data: withoutUndefined({
        field: newField,
        label: it.label,
        number: it.number,
        startDate: addDays(it.startDate, shift),
        duration: it.duration,
        isBreak: it.isBreak
      })
    })
  }

  const idPairs: Array<readonly [string, string]> = [
    [source.project._id, target],
    ...fieldIds.entries(),
    ...iterationIds.entries()
  ]

  // ---- views ----
  const viewIds = new Map<string, string>()
  const views = [...source.views].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const doc of views) {
    const id = generateId()
    viewIds.set(doc._id, id)
    ops.push({
      _class: classes.view,
      space: target,
      id: id as Ref<Doc>,
      data: withoutUndefined({
        name: doc.name,
        location: remapJson(doc.location, idPairs),
        filters: replaceIds(doc.filters, idPairs),
        viewOptions: remapJson(doc.viewOptions, idPairs),
        filterClass: doc.filterClass,
        viewletId: doc.viewletId,
        sharable: true,
        users: [author.account],
        createdBy: author.person,
        attachedTo: target,
        project: target,
        config: remapJson(doc.config, idPairs),
        order: doc.order,
        extra: doc.extra !== undefined ? replaceIds(doc.extra, idPairs) : undefined,
        filterQuery: doc.filterQuery
      })
    })
  }

  // ---- workflows (one per kind, the oldest wins like everywhere else) ----
  const seenKinds = new Set<string>()
  for (const wf of [...source.workflows].sort((a, b) => (a.createdOn ?? 0) - (b.createdOn ?? 0))) {
    if (seenKinds.has(wf.kind)) continue
    seenKinds.add(wf.kind)
    ops.push({
      _class: classes.workflow,
      space: target,
      id: generateId() as Ref<Doc>,
      data: withoutUndefined({
        name: wf.name,
        enabled: wf.enabled,
        kind: wf.kind,
        filter: wf.filter,
        config: clone(wf.config)
      })
    })
  }

  // ---- Insights charts ----
  for (const chart of [...source.charts].sort((a, b) => a.position - b.position)) {
    ops.push({
      _class: classes.chart,
      space: target,
      id: generateId() as Ref<Doc>,
      data: withoutUndefined({
        name: chart.name,
        layout: chart.layout,
        xField: chart.xField,
        xBucket: chart.xBucket,
        groupField: chart.groupField,
        yAggregate: clone(chart.yAggregate),
        filter: chart.filter,
        position: chart.position
      })
    })
  }

  return {
    projectData: withoutUndefined({
      shortDescription: source.project.shortDescription,
      readme: source.project.readme,
      workingDaysConfig: clone(source.project.workingDaysConfig)
    }),
    ops,
    fieldIds,
    iterationIds,
    viewIds
  }
}
