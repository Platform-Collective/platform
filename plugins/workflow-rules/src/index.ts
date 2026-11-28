// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import type { Class, Doc, Ref } from '@hcengineering/core'
import type { Asset, IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { Component, IssueStatus, Project } from '@hcengineering/tracker'

/**
 * @public
 *
 * How the trigger finds the counterpart issue in `linkedProject` for an issue
 * in `space`. The MVP ships `subIssue` and `parentIssue` because that is what
 * the existing `attachedTo = <otherIssue>, attachedToClass =
 * tracker.class.Issue, collection = 'subIssues'` pattern already encodes.
 * Additional link kinds (by relation, by custom field) are the extension
 * point for later.
 */
export type WorkflowRuleLinkKind = 'subIssue' | 'parentIssue'

/**
 * @public
 *
 * Fields the auto-create section is allowed to copy from the source issue onto
 * the newly created counterpart. The enumeration is closed so clients cannot
 * ask the server to copy arbitrary nested paths; adding a new inheritable
 * field is a deliberate model change.
 */
export type WorkflowRuleInheritField = 'title' | 'description' | 'priority' | 'dueDate' | 'milestone' | 'assignee'

/**
 * @public
 *
 * One allowed "backwards" transition on the target side of a rule - a (from,
 * to) pair the regression guard will let through even when `to` has a lower
 * rank than `from` in the TaskType's status list. Used for intentional loops
 * like "Review → In Progress" when the counterpart needs rework.
 */
export interface WorkflowRuleAllowedLoop {
  from: Ref<IssueStatus>
  to: Ref<IssueStatus>
}

/**
 * @public
 *
 * Auto-create configuration. When present and `triggerStatuses` is non-empty,
 * the trigger creates a counterpart issue in `linkedProject` the first time
 * a source issue enters one of those statuses - but only if no counterpart
 * exists yet under the rule's `linkKind` resolution.
 */
export interface WorkflowRuleAutoCreate {
  /** Source statuses that cause creation. */
  triggerStatuses: Array<Ref<IssueStatus>>

  /**
   * Mapping from a source `Component` to a target `Component` in
   * `linkedProject`. A `null` value means "do NOT create for issues with this
   * source component". An omitted source component falls back to
   * `defaultComponent` (and if that is unset, creation is skipped).
   */
  componentMap: Record<Ref<Component>, Ref<Component> | null>

  /** Fallback component when the source's component is not in `componentMap`. */
  defaultComponent?: Ref<Component>

  /** Which source fields to copy forward onto the new counterpart. */
  inherit: WorkflowRuleInheritField[]
}

/**
 * @public
 *
 * A workflow rule attached to a project. See `docs/workflow-rules/DESIGN.md`
 * for the shape rationale.
 *
 * The rule applies when a `TxUpdateDoc<Issue>` changes `status` for an issue
 * whose `space` matches this rule's `space`. The server trigger looks up the
 * counterpart in `linkedProject` via `linkKind` and emits the mirror update.
 *
 * `forwardMap` is one-directional on purpose. The reverse direction is a
 * separate `WorkflowRule` doc in `linkedProject`, so the two sides can be
 * edited independently by their respective admins.
 */
export interface WorkflowRule extends Doc {
  space: Ref<Project>
  linkedProject: Ref<Project>
  linkKind: WorkflowRuleLinkKind

  /**
   * Map from a source status to the target status to mirror onto the
   * counterpart. A status not present in this map is a no-op; the trigger
   * does nothing for it.
   */
  forwardMap: Record<Ref<IssueStatus>, Ref<IssueStatus>>

  /**
   * Legal backwards transitions on the target project. Pairs are in the
   * TARGET project's status refs. See `WorkflowRuleAllowedLoop`.
   */
  allowedLoops: WorkflowRuleAllowedLoop[]

  /** Soft-off switch. Row stays for audit when paused. */
  enabled: boolean

  /** Optional auto-create section; absent = disabled. */
  autoCreate?: WorkflowRuleAutoCreate
}

/** @public */
export const workflowRulesId = 'workflow-rules' as Plugin

/** @public */
const workflowRules = plugin(workflowRulesId, {
  class: {
    WorkflowRule: '' as Ref<Class<WorkflowRule>>
  },
  string: {
    WorkflowRules: '' as IntlString,
    ConfigLabel: '' as IntlString,
    ConfigDescription: '' as IntlString,
    AddRule: '' as IntlString,
    LinkedProject: '' as IntlString,
    LinkKind: '' as IntlString,
    StatusMatrix: '' as IntlString,
    AllowedLoops: '' as IntlString,
    AutoCreate: '' as IntlString,
    ComponentMap: '' as IntlString,
    DefaultComponent: '' as IntlString,
    InheritFields: '' as IntlString,
    Enabled: '' as IntlString,
    SubIssueLink: '' as IntlString,
    ParentIssueLink: '' as IntlString
  },
  icon: {
    WorkflowRule: '' as Asset
  }
})

/** @public */
export default workflowRules
