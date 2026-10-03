//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Class, Doc, Ref, Space, TxOperations } from '@hcengineering/core'
import tracker, {
  type InsightChart,
  type Iteration,
  type Project,
  type ProjectCopyClasses,
  type ProjectCopyPlan,
  type ProjectCopySource,
  type ProjectField,
  type Workflow
} from '@hcengineering/tracker'
import view, { type FilteredView } from '@hcengineering/view'

/** The classes a copy of a project creates, for `buildProjectCopyPlan`. */
export const projectCopyClasses: ProjectCopyClasses = {
  field: tracker.class.ProjectField,
  iteration: tracker.class.Iteration,
  view: view.class.FilteredView,
  workflow: tracker.class.Workflow,
  chart: tracker.class.InsightChart
}

/**
 * Reads what a copy of the project is made from: its fields, iterations, saved views, workflows and Insights charts.
 */
export async function loadProjectCopySource (
  client: Pick<TxOperations, 'findAll'>,
  project: Pick<Project, '_id' | 'shortDescription' | 'readme' | 'workingDaysConfig'>
): Promise<ProjectCopySource> {
  const space = project._id
  const [fields, iterations, views, workflows, charts] = await Promise.all([
    client.findAll(tracker.class.ProjectField, { space }),
    client.findAll(tracker.class.Iteration, { space }),
    client.findAll(view.class.FilteredView, { project: space }),
    client.findAll(tracker.class.Workflow, { space }),
    client.findAll(tracker.class.InsightChart, { space })
  ])
  return {
    project,
    fields: fields as ProjectField[],
    iterations: iterations as Iteration[],
    views: views as FilteredView[],
    workflows: workflows as Workflow[],
    charts: charts as InsightChart[]
  }
}

/** The part of a batch the plan needs. */
export interface CreateDocBatch {
  createDoc: (_class: Ref<Class<Doc>>, space: Ref<Space>, data: any, id?: Ref<Doc>) => Promise<unknown>
}

/**
 * Creates the documents of a copy plan, in the order of the plan. Meant for the batch that also creates the project,
 * so that a copy is made completely or not at all.
 */
export async function applyProjectCopyPlan (batch: CreateDocBatch, plan: ProjectCopyPlan): Promise<void> {
  for (const op of plan.ops) {
    await batch.createDoc(op._class, op.space, op.data, op.id)
  }
}
