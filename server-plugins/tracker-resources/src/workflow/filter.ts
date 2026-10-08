//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  buildWorkflowFilterSchema,
  toIterationRanges,
  type Iteration,
  type NamedOption,
  type ProjectField
} from '@hcengineering/tracker'
import {
  compileFilter,
  mentionsArchived,
  referencedProperties,
  type FilterContext,
  type Node
} from '@hcengineering/view-resources/src/filter/grammar'

// Evaluation of the filter string of a workflow on the server, with the grammar of the project views. The grammar is
// pure (it has no UI imports), so the server loads it from its source.

/**
 * What the names in a filter resolve against.
 */
export interface WorkflowFilterData {
  statuses: NamedOption[]
  components: NamedOption[]
  milestones: NamedOption[]
  assignees: NamedOption[]
  fields: ProjectField[]
  iterations: Iteration[]
  // Ids of the done and canceled statuses, for `is:open` / `is:closed`
  closedStatuses: ReadonlySet<string>
  // `Issue.attachedTo` of an issue without a parent
  noParentId: string
}

/**
 * A filter ready to run on the server.
 */
export type CompiledWorkflowFilter =
  | {
    ok: true
    // The part the database evaluates, a safe narrowing of the candidates
    query: Record<string, any>
    // The whole filter on one document. The scan always applies it, so the result does not depend on how much of the
    // filter the database could take
    matches: (doc: any) => boolean
    // Properties of an issue the evaluation reads
    projection: string[]
    // Whether the filter talks about archived items (a filter workflow decides on its own which ones it scans)
    mentionsArchived: boolean
  }
  | { ok: false, error: string }

/**
 * Parses a workflow filter. Invalid input is reported, never thrown.
 */
export function compileWorkflowFilter (filter: string, data: WorkflowFilterData, now: number): CompiledWorkflowFilter {
  const schema = buildWorkflowFilterSchema({
    statuses: data.statuses,
    assignees: data.assignees,
    components: data.components,
    milestones: data.milestones,
    customFields: data.fields,
    iterations: data.iterations,
    noParentId: data.noParentId
  })
  const fieldIdByKey = new Map(data.fields.map((f) => [f.key, f._id]))
  const ctx: FilterContext = {
    now,
    closedStatuses: data.closedStatuses,
    noParentId: data.noParentId,
    iterations: (fieldKey: string) => {
      const fieldId = fieldIdByKey.get(fieldKey)
      return toIterationRanges(data.iterations.filter((it) => it.field === fieldId))
    }
  }
  const res = compileFilter(filter, schema, ctx)
  if (res.ok === false) return { ok: false, error: res.error.message }
  const ast: Node = res.value.ast
  return {
    ok: true,
    query: res.value.query,
    matches: res.value.matches,
    projection: referencedProperties(ast),
    mentionsArchived: mentionsArchived(ast)
  }
}
