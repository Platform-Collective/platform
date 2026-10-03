//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { generateId, type DocData, type Ref, type TxOperations } from '@hcengineering/core'
import type { TaskType } from '@hcengineering/task'
import tracker, {
  draftIdentifier,
  DRAFT_NUMBER,
  IssuePriority,
  type Component,
  type Issue,
  type IssueStatus,
  type Milestone,
  type Project
} from '@hcengineering/tracker'
import type { Employee } from '@hcengineering/contact'

/** What a draft item needs to know about its project. */
export type DraftProject = Pick<Project, '_id' | 'identifier' | 'type' | 'defaultIssueStatus'>

/**
 * Values a draft starts with, e.g. the column and the swimlane of the board it is added from. What is not given is
 * the default of the project (status, assignee) or empty.
 */
export interface DraftValues {
  status?: Ref<IssueStatus>
  priority?: IssuePriority
  assignee?: Ref<Employee> | null
  component?: Ref<Component> | null
  milestone?: Ref<Milestone> | null
  customFields?: Record<string, unknown>
}

/** What a draft needs that comes from the task types of the project. */
export interface DraftTarget {
  project: DraftProject
  kind: Ref<TaskType>
  // The status of a draft that is added without one (the default status of the project, or the first status of its type)
  status: Ref<IssueStatus>
}

/**
 * The kind (task type) a new item gets: the first task type of the project type that issues can be created of, like the
 * type selector of the create issue form.
 */
export function pickDefaultKind (
  taskTypes: Iterable<Pick<TaskType, '_id' | 'parent'>>,
  projectType: Project['type'],
  canCreate: (taskType: Pick<TaskType, '_id' | 'parent'>) => boolean
): Ref<TaskType> | undefined {
  for (const taskType of taskTypes) {
    if (taskType.parent === projectType && canCreate(taskType)) return taskType._id
  }
  return undefined
}

/**
 * The document of a draft item. It has the number 0 and a placeholder identifier, because it takes no number from the
 * sequence of the project until it is converted to an issue.
 */
export function buildDraftIssue (target: DraftTarget, title: string, values: DraftValues = {}): DocData<Issue> {
  const { project } = target
  return {
    title,
    description: null,
    // The default assignee of the project is not applied: it would send an assignment notification for a mere idea
    assignee: values.assignee ?? null,
    component: values.component ?? null,
    milestone: values.milestone ?? null,
    number: DRAFT_NUMBER,
    status: values.status ?? target.status,
    priority: values.priority ?? IssuePriority.NoPriority,
    rank: '',
    comments: 0,
    subIssues: 0,
    startDate: null,
    dueDate: null,
    parents: [],
    reportedTime: 0,
    remainingTime: 0,
    estimation: 0,
    reports: 0,
    relations: [],
    childInfo: [],
    kind: target.kind,
    identifier: draftIdentifier(project.identifier),
    isDraft: true,
    ...(values.customFields !== undefined && Object.keys(values.customFields).length > 0
      ? { customFields: values.customFields }
      : {})
  }
}

/**
 * Creates a draft item in the project and returns its id. The sequence of the project is not touched.
 */
export async function createDraftItem (
  client: Pick<TxOperations, 'addCollection'>,
  target: DraftTarget,
  title: string,
  values: DraftValues = {}
): Promise<Ref<Issue>> {
  const id: Ref<Issue> = generateId()
  await client.addCollection(
    tracker.class.Issue,
    target.project._id,
    tracker.ids.NoParent,
    tracker.class.Issue,
    'subIssues',
    buildDraftIssue(target, title, values),
    id
  )
  return id
}
