// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import { type Domain, type Ref } from '@hcengineering/core'
import { Model, Prop, TypeBoolean, TypeRef, TypeString, UX, type Builder } from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import type { Project } from '@hcengineering/tracker'
import workflowRules, {
  type WorkflowRule,
  type WorkflowRuleAllowedLoop,
  type WorkflowRuleAutoCreate,
  type WorkflowRuleLinkKind
} from '@hcengineering/workflow-rules'

export { workflowRulesId } from '@hcengineering/workflow-rules'
export { default } from '@hcengineering/workflow-rules'

/** @public */
export const DOMAIN_WORKFLOW_RULES = 'workflow_rules' as Domain

/**
 * @public
 *
 * TypeORM-ish model for `WorkflowRule`. The complex nested fields
 * (`forwardMap`, `allowedLoops`, `autoCreate`) are kept as plain JSON on the
 * doc rather than modeled with `@Prop`:
 *
 *  - They are never queried on their inner shape (the trigger reads the
 *    whole rule by `_id`, then walks the map in memory).
 *  - They are rarely edited field-by-field; the matrix editor writes the
 *    entire map on save.
 *  - The TypeScript type in `plugins/workflow-rules/src/index.ts` is
 *    authoritative; the trigger validates on read.
 *
 * This mirrors how `WorkingDaysConfig` is stored on `Project` (`weekdayMask`
 * is a bitmask integer, no bitfield-level `@Prop`).
 */
@Model(workflowRules.class.WorkflowRule, core.class.Doc, DOMAIN_WORKFLOW_RULES)
@UX(workflowRules.string.WorkflowRules, workflowRules.icon.WorkflowRule)
export class TWorkflowRule extends TDoc implements WorkflowRule {
  // `space` is inherited from TDoc as Ref<Space>. The runtime value is a
  // Ref<Project>; refined by the interface declaration in plugins/workflow-rules.
  declare space: Ref<Project>

  @Prop(TypeRef(core.class.Space), workflowRules.string.LinkedProject)
  linkedProject!: Ref<Project>

  @Prop(TypeString(), workflowRules.string.LinkKind)
  linkKind!: WorkflowRuleLinkKind

  // Nested JSON - see class JSDoc for the rationale.
  forwardMap!: WorkflowRule['forwardMap']
  allowedLoops!: WorkflowRuleAllowedLoop[]
  autoCreate?: WorkflowRuleAutoCreate

  @Prop(TypeBoolean(), workflowRules.string.Enabled)
  enabled!: boolean
}

export function createModel (builder: Builder): void {
  builder.createModel(TWorkflowRule)
}
