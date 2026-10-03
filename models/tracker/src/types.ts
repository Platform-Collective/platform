//
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import chunter from '@hcengineering/chunter'
import contact, { type Employee, type Person } from '@hcengineering/contact'
import {
  DOMAIN_MODEL,
  DateRangeMode,
  IndexKind,
  type MarkupBlobRef,
  type Domain,
  type Markup,
  type Ref,
  type RelatedDocument,
  type Timestamp,
  type Type,
  type RolesAssignment,
  type Role,
  type CollectionSize,
  type AccountUuid
} from '@hcengineering/core'
import {
  ArrOf,
  Collection,
  Hidden,
  Index,
  Mixin,
  Model,
  Prop,
  ReadOnly,
  TypeBoolean,
  TypeCollaborativeDoc,
  TypeDate,
  TypeMarkup,
  TypeNumber,
  TypeRecord,
  TypeRef,
  TypeString,
  UX
} from '@hcengineering/model'
import attachment from '@hcengineering/model-attachment'
import core, { TAttachedDoc, TDoc, TStatus, TType } from '@hcengineering/model-core'
import notification, { TCommonInboxNotification } from '@hcengineering/model-notification'
import task, { TTask, TProject as TTaskProject } from '@hcengineering/model-task'
import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
import tags, { type TagElement } from '@hcengineering/tags'
import time, { type ToDo } from '@hcengineering/time'
import {
  type ProjectTargetPreference,
  type Component,
  type DependencyKind,
  type DependencyShiftedNotification,
  type DependencyShiftRequest,
  type Issue,
  type IssueChildInfo,
  type IssueParentInfo,
  type IssuePriority,
  type IssueRelation,
  type IssueStatus,
  type IssueTemplate,
  type IssueTemplateChild,
  type Milestone,
  type InsightChart,
  type InsightDateBucket,
  type InsightLayout,
  type InsightYAxis,
  type Iteration,
  type ProjectField,
  type ProjectFieldOption,
  ProjectFieldType,
  type ProjectStatus,
  type ProjectStatusUpdate,
  type ProjectWebhook,
  type ProjectWebhookSecret,
  type WebhookEvent,
  type Workflow,
  type WorkflowConfig,
  type WorkflowKind,
  type MilestoneStatus,
  type Project,
  type RelatedClassRule,
  type RelatedIssueTarget,
  type RelatedSpaceRule,
  type ShiftedIssuePayload,
  type TimeReportDayType,
  type TimeSpendReport,
  type WorkingDaysConfig
} from '@hcengineering/tracker'
import tracker from './plugin'
import { type TaskType } from '@hcengineering/task'

import preference, { TPreference } from '@hcengineering/model-preference'

export const DOMAIN_TRACKER = 'tracker' as Domain

@Model(tracker.class.IssueStatus, core.class.Status)
@UX(tracker.string.IssueStatus, undefined, undefined, 'rank', 'name')
export class TIssueStatus extends TStatus implements IssueStatus {}
/**
 * @public
 */

export function TypeIssuePriority (): Type<IssuePriority> {
  return { _class: tracker.class.TypeIssuePriority, label: tracker.string.TypeIssuePriority }
}
/**
 * @public
 */

@Model(tracker.class.TypeIssuePriority, core.class.Type, DOMAIN_MODEL)
export class TTypeIssuePriority extends TType {}
/**
 * @public
 */

export function TypeMilestoneStatus (): Type<MilestoneStatus> {
  return { _class: tracker.class.TypeMilestoneStatus, label: 'TypeMilestoneStatus' as IntlString }
}
/**
 * @public
 */

@Model(tracker.class.TypeMilestoneStatus, core.class.Type, DOMAIN_MODEL)
export class TTypeMilestoneStatus extends TType {}
/**
 * @public
 */

@Model(tracker.class.Project, task.class.Project)
@UX(tracker.string.Project, tracker.icon.Issues, 'Project', 'name')
export class TProject extends TTaskProject implements Project {
  @Prop(TypeString(), tracker.string.ProjectIdentifier)
  @Index(IndexKind.FullText)
    identifier!: IntlString

  @Prop(TypeNumber(), tracker.string.Number)
  @Hidden()
    sequence!: number

  @Prop(TypeRef(tracker.class.IssueStatus), tracker.string.DefaultIssueStatus)
    defaultIssueStatus?: Ref<IssueStatus>

  @Prop(TypeRef(contact.mixin.Employee), tracker.string.DefaultAssignee)
    defaultAssignee!: Ref<Employee>

  declare defaultTimeReportDay: TimeReportDayType

  @Prop(Collection(tracker.class.RelatedIssueTarget), tracker.string.RelatedIssues)
    relatedIssueTargets!: number

  @Prop(TypeRecord(), tracker.string.WorkingDaysConfig)
    workingDaysConfig?: WorkingDaysConfig

  @Prop(TypeString(), tracker.string.ProjectShortDescription)
  @Hidden()
    shortDescription?: string

  @Prop(TypeMarkup(), tracker.string.ProjectReadme)
  @Hidden()
    readme?: Markup

  @Prop(TypeBoolean(), tracker.string.ProjectTemplate)
  @Hidden()
    isTemplate?: boolean
}
/**
 * @public
 */

@Model(tracker.class.RelatedIssueTarget, core.class.Doc, DOMAIN_TRACKER)
@UX(tracker.string.RelatedIssues)
export class TRelatedIssueTarget extends TDoc implements RelatedIssueTarget {
  @Prop(TypeRef(tracker.class.Project), tracker.string.Project)
    target!: Ref<Project>

  rule!: RelatedClassRule | RelatedSpaceRule
}

/**
 * @public
 */
export function TypeReportedTime (): Type<number> {
  return { _class: tracker.class.TypeReportedTime, label: tracker.string.ReportedTime }
}

/**
 * @public
 */
export function TypeRemainingTime (): Type<number> {
  return { _class: tracker.class.TypeRemainingTime, label: tracker.string.RemainingTime }
}

/**
 * @public
 */
export function TypeEstimation (): Type<number> {
  return { _class: tracker.class.TypeEstimation, label: tracker.string.Estimation }
}

/**
 * @public
 */
@Model(tracker.class.Issue, task.class.Task)
@UX(tracker.string.Issue, tracker.icon.Issue, 'TSK', 'title', undefined, tracker.string.Issues)
export class TIssue extends TTask implements Issue {
  @Prop(TypeRef(tracker.class.Issue), tracker.string.Parent)
  declare attachedTo: Ref<Issue>

  @Prop(TypeString(), tracker.string.Title)
  @Index(IndexKind.FullText)
    title!: string

  @Prop(TypeCollaborativeDoc(), tracker.string.Description)
  @Index(IndexKind.FullText)
    description!: MarkupBlobRef | null

  @Prop(TypeRef(tracker.class.IssueStatus), tracker.string.Status, {
    _id: tracker.attribute.IssueStatus,
    iconComponent: tracker.activity.StatusIcon
  })
  @Index(IndexKind.Indexed)
  declare status: Ref<IssueStatus>

  @Prop(TypeIssuePriority(), tracker.string.Priority, {
    iconComponent: tracker.activity.PriorityIcon
  })
  @Index(IndexKind.Indexed)
    priority!: IssuePriority

  @Prop(TypeNumber(), tracker.string.Number)
  @Index(IndexKind.FullText)
  @ReadOnly()
  declare number: number

  @Prop(TypeRef(contact.class.Person), tracker.string.Assignee)
  @Index(IndexKind.Indexed)
  declare assignee: Ref<Person> | null

  @Prop(TypeRef(tracker.class.Component), tracker.string.Component, { icon: tracker.icon.Component })
  @Index(IndexKind.Indexed)
    component!: Ref<Component> | null

  @Prop(Collection(tracker.class.Issue), tracker.string.SubIssues)
    subIssues!: number

  @Prop(ArrOf(TypeRef(core.class.TypeRelatedDocument)), tracker.string.BlockedBy)
    blockedBy!: RelatedDocument[]

  @Prop(ArrOf(TypeRef(core.class.TypeRelatedDocument)), tracker.string.RelatedTo)
  @Index(IndexKind.Indexed)
    relations!: RelatedDocument[]

  parents!: IssueParentInfo[]

  @Prop(Collection(tags.class.TagReference), tracker.string.Labels)
  declare labels: number

  @Prop(TypeRef(tracker.class.Project), tracker.string.Project, { icon: tracker.icon.Issues })
  @Index(IndexKind.Indexed)
  @ReadOnly()
  declare space: Ref<Project>

  @Prop(TypeRecord(), tracker.string.CustomFields)
  @Hidden()
    customFields?: Record<string, unknown>

  @Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.IssueStartDate)
  @Index(IndexKind.Indexed)
  declare startDate: Timestamp | null

  @Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.DueDate)
  declare dueDate: Timestamp | null

  // Set while the issue is archived (GitHub "Archive item"), null once restored
  @Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.ArchivedAt)
  @Hidden()
    archivedAt?: Timestamp | null

  // Soft deadline, independent of dueDate. Optional.
  // When set, the Gantt renders a flag marker at this date and flags the
  // issue as overdue when dueDate > deadline. Undefined for existing issues
  // until the user opts in via the Issue editor (this change ships the
  // inline ControlPanel field; a Gantt context-menu shortcut is a
  // separate follow-up, see Out-of-scope section).
  @Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.Deadline)
    deadline?: Timestamp | null

  @Prop(TypeRef(tracker.class.Milestone), tracker.string.Milestone, { icon: tracker.icon.Milestone })
  @Index(IndexKind.Indexed)
    milestone!: Ref<Milestone> | null

  @Prop(TypeEstimation(), tracker.string.Estimation)
    estimation!: number

  @Prop(TypeReportedTime(), tracker.string.ReportedTime)
    reportedTime!: number

  @Prop(TypeRemainingTime(), tracker.string.RemainingTime)
  @ReadOnly()
    remainingTime!: number

  @Prop(Collection(tracker.class.TimeSpendReport), tracker.string.TimeSpendReports)
    reports!: number

  declare childInfo: IssueChildInfo[]

  @Prop(Collection(time.class.ToDo), getEmbeddedLabel('Action Items'))
    todos?: CollectionSize<ToDo>

  /**
   * Auto-Scheduling-Toggle.
   *
   * Optional property so existing issues stay on the default cascade
   * behaviour with no migration. `@Hidden` keeps the field out of the
   * generic filter/sort UI in `getFiltredKeys`; the dedicated toggle in
   * `ControlPanel.svelte` is the supported entry point. Cascade-time
   * checks live in `gantt/lib/scheduler.ts` (Step 5b filter).
   */
  @Prop(TypeString(), tracker.string.SchedulingMode)
  @Hidden()
    schedulingMode?: 'auto' | 'manual'
}
/**
 * @public
 */

@Model(tracker.class.IssueTemplate, core.class.Doc, DOMAIN_TRACKER)
@UX(
  tracker.string.IssueTemplate,
  tracker.icon.IssueTemplates,
  'PROCESS',
  undefined,
  undefined,
  tracker.string.IssueTemplates
)
export class TIssueTemplate extends TDoc implements IssueTemplate {
  @Prop(TypeString(), tracker.string.Title)
  @Index(IndexKind.FullText)
    title!: string

  @Prop(TypeMarkup(), tracker.string.Description)
  @Index(IndexKind.FullText)
    description!: Markup

  @Prop(TypeIssuePriority(), tracker.string.Priority)
    priority!: IssuePriority

  @Prop(TypeRef(contact.class.Person), tracker.string.Assignee)
    assignee!: Ref<Person> | null

  @Prop(TypeRef(tracker.class.Component), tracker.string.Component)
    component!: Ref<Component> | null

  @Prop(ArrOf(TypeRef(tags.class.TagElement)), tracker.string.Labels)
    labels?: Ref<TagElement>[]

  @Prop(TypeRef(task.class.TaskType), task.string.TaskType)
    kind?: Ref<TaskType>

  declare space: Ref<Project>

  @Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.DueDate)
    dueDate!: Timestamp | null

  @Prop(TypeRef(tracker.class.Milestone), tracker.string.Milestone)
    milestone!: Ref<Milestone> | null

  @Prop(TypeEstimation(), tracker.string.Estimation)
    estimation!: number

  @Prop(ArrOf(TypeRef(tracker.class.IssueTemplate)), tracker.string.IssueTemplate)
    children!: IssueTemplateChild[]

  @Prop(Collection(chunter.class.ChatMessage), tracker.string.Comments)
    comments!: number

  @Prop(Collection(attachment.class.Attachment), tracker.string.Attachments)
    attachments!: number

  @Prop(ArrOf(TypeRef(core.class.TypeRelatedDocument)), tracker.string.RelatedTo)
    relations!: RelatedDocument[]
}
/**
 * @public
 */

@Model(tracker.class.TimeSpendReport, core.class.AttachedDoc, DOMAIN_TRACKER)
@UX(tracker.string.TimeSpendReport, tracker.icon.TimeReport)
export class TTimeSpendReport extends TAttachedDoc implements TimeSpendReport {
  @Prop(TypeRef(tracker.class.Issue), tracker.string.Issue)
  declare attachedTo: Ref<Issue>

  @Prop(TypeRef(contact.mixin.Employee), contact.string.Employee)
    employee!: Ref<Employee>

  @Prop(TypeDate(), tracker.string.TimeSpendReportDate)
    date!: Timestamp | null

  @Prop(TypeNumber(), tracker.string.TimeSpendReportValue)
    value!: number

  @Prop(TypeString(), tracker.string.TimeSpendReportDescription)
    description!: string
}

/**
 * @public
 */
@Model(tracker.class.IssueRelation, core.class.AttachedDoc, DOMAIN_TRACKER)
@UX(tracker.string.GanttDependency, tracker.icon.Issue)
export class TIssueRelation extends TAttachedDoc implements IssueRelation {
  @Prop(TypeRef(tracker.class.Issue), tracker.string.Issue)
  declare attachedTo: Ref<Issue>

  declare collection: 'relations'

  @Prop(TypeRef(tracker.class.Issue), tracker.string.Issue)
  @Index(IndexKind.Indexed)
    target!: Ref<Issue>

  @Prop(TypeString(), tracker.string.GanttDependency)
    kind!: DependencyKind

  @Prop(TypeNumber(), tracker.string.GanttLag)
    lag!: number
}
/**
 * @public
 */

@Model(tracker.class.Component, core.class.Doc, DOMAIN_TRACKER)
@UX(tracker.string.Component, tracker.icon.Component, 'COMPONENT', 'label', undefined, tracker.string.Components)
export class TComponent extends TDoc implements Component {
  @Prop(TypeString(), tracker.string.Title)
  @Index(IndexKind.FullText)
    label!: string

  @Prop(TypeMarkup(), tracker.string.Description)
    description?: Markup

  @Prop(TypeRef(contact.mixin.Employee), tracker.string.ComponentLead)
    lead!: Ref<Employee> | null

  @Prop(Collection(chunter.class.ChatMessage), chunter.string.Comments)
    comments!: number

  @Prop(Collection(attachment.class.Attachment), attachment.string.Attachments, { shortLabel: attachment.string.Files })
    attachments?: number

  @Prop(TypeNumber(), tracker.string.Color)
    color?: number

  declare space: Ref<Project>
}

/**
 * @public
 */
@Model(tracker.class.Milestone, core.class.Doc, DOMAIN_TRACKER)
@UX(tracker.string.Milestone, tracker.icon.Milestone, '', 'label', undefined, tracker.string.Milestones)
export class TMilestone extends TDoc implements Milestone {
  @Prop(TypeString(), tracker.string.Title)
  // @Index(IndexKind.FullText)
    label!: string

  @Prop(TypeMarkup(), tracker.string.Description)
    description?: Markup

  @Prop(TypeMilestoneStatus(), tracker.string.Status)
  @Index(IndexKind.Indexed)
    status!: MilestoneStatus

  @Prop(Collection(chunter.class.ChatMessage), chunter.string.Comments)
    comments!: number

  @Prop(Collection(attachment.class.Attachment), attachment.string.Attachments, { shortLabel: attachment.string.Files })
    attachments?: number

  @Prop(TypeDate(), tracker.string.StartDate)
    startDate!: Timestamp | null

  @Prop(TypeDate(), tracker.string.TargetDate)
    targetDate!: Timestamp

  @Prop(TypeNumber(), tracker.string.Color)
    color?: number

  declare space: Ref<Project>
}

/**
 * @public
 */
@Model(tracker.class.ProjectField, core.class.Doc, DOMAIN_TRACKER)
@UX(tracker.string.ProjectField, tracker.icon.Issues, '', 'label', undefined, tracker.string.ProjectFields)
export class TProjectField extends TDoc implements ProjectField {
  @Prop(TypeString(), tracker.string.Title)
    label!: string

  @Prop(TypeString(), tracker.string.FieldKey)
  @ReadOnly()
    key!: string

  @Prop(TypeString(), tracker.string.FieldType)
  @ReadOnly()
    type!: ProjectFieldType

  @Prop(TypeNumber(), tracker.string.Number)
  @Hidden()
    position!: number

  @Prop(TypeString(), tracker.string.Description)
    description?: string

  @Prop(TypeRecord(), tracker.string.FieldDefaultValue)
    defaultValue?: string | number | null

  @Prop(ArrOf(TypeRecord()), tracker.string.FieldOptions)
    options?: ProjectFieldOption[]

  declare space: Ref<Project>
}

/**
 * A time box of an Iteration field. Issues reference it by id from `customFields[field.key]`.
 * @public
 */
@Model(tracker.class.Iteration, core.class.Doc, DOMAIN_TRACKER)
@UX(tracker.string.Iteration, tracker.icon.Issues, '', 'label', undefined, tracker.string.Iterations)
export class TIteration extends TDoc implements Iteration {
  @Prop(TypeRef(tracker.class.ProjectField), tracker.string.ProjectField)
  @ReadOnly()
    field!: Ref<ProjectField>

  @Prop(TypeString(), tracker.string.Title)
    label!: string

  @Prop(TypeNumber(), tracker.string.Number)
  @Hidden()
    number!: number

  @Prop(TypeDate(), tracker.string.StartDate)
    startDate!: Timestamp

  @Prop(TypeNumber(), tracker.string.IterationDuration)
    duration!: number

  @Prop(TypeBoolean(), tracker.string.IterationBreak)
    isBreak?: boolean

  declare space: Ref<Project>
}

/**
 * A saved chart of the project Insights. `space` is the project.
 * @public
 */
@Model(tracker.class.InsightChart, core.class.Doc, DOMAIN_TRACKER)
@UX(tracker.string.InsightChart, tracker.icon.Issues, '', 'name', undefined, tracker.string.InsightCharts)
export class TInsightChart extends TDoc implements InsightChart {
  @Prop(TypeString(), tracker.string.Title)
    name!: string

  @Prop(TypeString(), tracker.string.InsightLayout)
    layout!: InsightLayout

  @Prop(TypeString(), tracker.string.InsightXAxis)
    xField!: string

  @Prop(TypeString(), tracker.string.InsightDateBucket)
    xBucket?: InsightDateBucket | null

  @Prop(TypeString(), tracker.string.InsightGroupBy)
    groupField?: string | null

  @Prop(TypeRecord(), tracker.string.InsightYAxis)
    yAggregate!: InsightYAxis

  @Prop(TypeString(), tracker.string.InsightFilter)
    filter!: string

  @Prop(TypeNumber(), tracker.string.Number)
  @Hidden()
    position!: number

  declare space: Ref<Project>
}

/**
 * A built-in workflow of the project. `space` is the project.
 * @public
 */
@Model(tracker.class.Workflow, core.class.Doc, DOMAIN_TRACKER)
@UX(tracker.string.Workflow, tracker.icon.Issues, '', 'name', undefined, tracker.string.Workflows)
export class TWorkflow extends TDoc implements Workflow {
  @Prop(TypeString(), tracker.string.Title)
    name!: string

  @Prop(TypeBoolean(), tracker.string.WorkflowEnabled)
    enabled!: boolean

  @Prop(TypeString(), tracker.string.Workflow)
    kind!: WorkflowKind

  @Prop(TypeString(), tracker.string.InsightFilter)
    filter?: string

  @Prop(TypeRecord(), tracker.string.Workflow)
  @Hidden()
    config?: WorkflowConfig

  @Prop(TypeNumber(), tracker.string.Number)
  @Hidden()
    runRequestedAt?: Timestamp

  declare space: Ref<Project>
}

/**
 * A webhook of the project that is called when an item changes. `space` is the project.
 * @public
 */
@Model(tracker.class.ProjectWebhook, core.class.Doc, DOMAIN_TRACKER)
@UX(tracker.string.ProjectWebhook, tracker.icon.Issues, '', 'url', undefined, tracker.string.ProjectWebhooks)
export class TProjectWebhook extends TDoc implements ProjectWebhook {
  @Prop(TypeString(), tracker.string.WebhookUrl)
    url!: string

  @Prop(TypeBoolean(), tracker.string.WorkflowEnabled)
    enabled!: boolean

  @Prop(ArrOf(TypeString()), tracker.string.WebhookEvents)
    events!: WebhookEvent[]

  @Prop(TypeBoolean(), tracker.string.WebhookSecret)
    hasSecret!: boolean

  @Prop(TypeString(), tracker.string.Description)
    description?: string

  declare space: Ref<Project>
}

/**
 * A status update of the project (GitHub "Project status updates"). `space` is the project; the author is the
 * creator of the document, the latest update is the status of the project.
 * @public
 */
@Model(tracker.class.ProjectStatusUpdate, core.class.Doc, DOMAIN_TRACKER)
@UX(tracker.string.ProjectStatusUpdate, tracker.icon.Issues, '', undefined, undefined, tracker.string.ProjectStatusUpdates)
export class TProjectStatusUpdate extends TDoc implements ProjectStatusUpdate {
  @Prop(TypeString(), tracker.string.Status)
    status!: ProjectStatus

  @Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.StartDate)
    startDate?: Timestamp | null

  @Prop(TypeDate(DateRangeMode.DATETIME), tracker.string.TargetDate)
    targetDate?: Timestamp | null

  @Prop(TypeMarkup(), tracker.string.Description)
    body!: Markup

  declare space: Ref<Project>
}

/**
 * The secret of a webhook. It lives in the personal space of the person who set it (never in the project), so the
 * other members of the project can not read it.
 * @public
 */
@Model(tracker.class.ProjectWebhookSecret, core.class.Doc, DOMAIN_TRACKER)
export class TProjectWebhookSecret extends TDoc implements ProjectWebhookSecret {
  @Prop(TypeRef(tracker.class.ProjectWebhook), tracker.string.ProjectWebhook)
  @Hidden()
    webhook!: Ref<ProjectWebhook>

  @Prop(TypeString(), tracker.string.WebhookSecret)
  @Hidden()
    secret!: string
}

@UX(core.string.Number)
@Model(tracker.class.TypeReportedTime, core.class.Type)
export class TTypeReportedTime extends TType {}

@UX(core.string.Number)
@Model(tracker.class.TypeEstimation, core.class.Type)
export class TTypeEstimation extends TType {}

@UX(core.string.Number)
@Model(tracker.class.TypeRemainingTime, core.class.Type)
export class TTypeRemainingTime extends TType {}

@Model(tracker.class.ProjectTargetPreference, preference.class.Preference)
export class TProjectTargetPreference extends TPreference implements ProjectTargetPreference {
  @Prop(TypeRef(core.class.Space), core.string.Space)
  declare attachedTo: Ref<Project>

  @Prop(TypeDate(), tracker.string.LastUpdated)
    usedOn!: Timestamp

  @Prop(TypeRecord(), getEmbeddedLabel('Properties'))
    props?: { key: string, value: any }[]
}

@Mixin(tracker.mixin.ClassicProjectTypeData, tracker.class.Project)
@UX(getEmbeddedLabel('Classic project'), tracker.icon.Issues)
export class TClassicProjectTypeData extends TProject implements RolesAssignment {
  [key: Ref<Role>]: AccountUuid[]
}

@Mixin(tracker.mixin.IssueTypeData, tracker.class.Issue)
@UX(getEmbeddedLabel('Issue'), tracker.icon.Issue)
export class TIssueTypeData extends TIssue {}

/**
 * Notification on Dependency-Shift.
 *
 * Persisted model class for the cascade-shift bundle notification. Extends
 * `CommonInboxNotification` so it inherits inbox/email/push routing for
 * free; the cascade-specific payload lives in the (un-`@Prop`'d) fields
 * which are still serialised as part of the Doc body — same pattern that
 * `TReactionInboxNotification` uses for its `ref`/`emoji` fields.
 *
 * @public
 */
@Model(tracker.class.DependencyShiftedNotification, notification.class.CommonInboxNotification)
export class TDependencyShiftedNotification extends TCommonInboxNotification implements DependencyShiftedNotification {
  @Prop(TypeRef(tracker.class.Issue), tracker.string.Issue)
    triggerIssueId!: Ref<Issue>

  @Prop(TypeString(), tracker.string.Issue)
    triggerIssueIdentifier!: string

  @Prop(TypeString(), tracker.string.Issue)
    triggerIssueTitle!: string

  triggerUserId!: AccountUuid

  shiftedIssues!: ShiftedIssuePayload[]

  @Prop(TypeString(), tracker.string.DependencyShifted)
    cascadeToken!: string
}

/**
 * Notification on Dependency-Shift.
 *
 * Short-lived signal doc (DOMAIN_TRACKER) a Gantt client writes into the
 * project space after a cascade commit. The `OnDependencyShiftRequest` server
 * trigger consumes it, dispatches notifications privileged, and removes it. It
 * deliberately carries no `triggerUserId` — the trigger derives the author
 * from `tx.modifiedBy` (anti-spoofing).
 *
 * @public
 */
@Model(tracker.class.DependencyShiftRequest, core.class.Doc, DOMAIN_TRACKER)
export class TDependencyShiftRequest extends TDoc implements DependencyShiftRequest {
  @Prop(TypeRef(tracker.class.Issue), tracker.string.Issue)
    triggerIssueId!: Ref<Issue>

  @Prop(TypeString(), tracker.string.Issue)
    triggerIssueIdentifier!: string

  @Prop(TypeString(), tracker.string.Issue)
    triggerIssueTitle!: string

  @Prop(TypeRef(tracker.class.Project), tracker.string.Project)
    triggerIssueSpace!: Ref<Project>

  shiftedIssues!: ShiftedIssuePayload[]

  @Prop(TypeString(), tracker.string.DependencyShifted)
    cascadeToken!: string
}
