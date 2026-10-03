//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { archivedQuery, isWorkflowFilterUsable, WorkflowKind, type FilterWorkflowKind } from '@hcengineering/tracker'
import { filterGrammar } from '@hcengineering/view-resources'

/**
 * A filter of a workflow compiled for a preview: what to scan and how to count. It is the same grammar, schema and
 * rules the server uses, so the count is what the next run would find (up to its cap).
 */
export type CompiledPreview =
  | {
    ok: true
    // Selects the scan: the narrowing of the filter and the archive state the workflow looks at
    query: Record<string, any>
    // Properties the evaluation reads
    projection: string[]
    matches: (doc: any) => boolean
  }
  | { ok: false, reason: 'empty' | 'invalid' }

/**
 * Compiles the filter text of a filter workflow. Auto-archive scans the items that are not archived, Auto-add (restore)
 * the archived ones; Auto-archive with a filter that asks for archived items is invalid.
 */
export function compileWorkflowPreview (
  kind: FilterWorkflowKind,
  text: string,
  schema: filterGrammar.FieldSpec[],
  ctx: filterGrammar.FilterContext
): CompiledPreview {
  if (!isWorkflowFilterUsable(text)) return { ok: false, reason: 'empty' }
  const res = filterGrammar.compileFilter(text, schema, ctx)
  if (res.ok === false) return { ok: false, reason: 'invalid' }
  const mentions = filterGrammar.mentionsArchived(res.value.ast)
  if (kind === WorkflowKind.AutoArchive && mentions) return { ok: false, reason: 'invalid' }
  return {
    ok: true,
    query: { ...res.value.query, ...archivedQuery(kind === WorkflowKind.AutoAddFromQuery) },
    projection: filterGrammar.referencedProperties(res.value.ast),
    matches: res.value.matches
  }
}

/**
 * How many of the scanned issues match; `over` when the scan hit its limit, so the number is a lower bound.
 */
export function countPreviewMatches (
  compiled: Extract<CompiledPreview, { ok: true }>,
  docs: readonly unknown[],
  scanLimit: number
): { count: number, over: boolean } {
  return { count: docs.filter((d) => compiled.matches(d)).length, over: docs.length >= scanLimit }
}
