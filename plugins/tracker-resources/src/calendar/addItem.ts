//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { DraftValues } from '../draft/create'
import { planSchedule, buildIssuePatch, type PlanFailure, type ScheduleContext } from '../roadmap/reschedule'

export type DayDraftValues = { ok: true, values: DraftValues } | { ok: false, reason: PlanFailure }

/**
 * What a draft item that is added to a day cell starts with: the day in the date fields of the view (the same plan as
 * putting an item without dates on a day), nothing else. Fails when neither date field can be written, e.g. when the
 * view takes its dates from the milestone.
 */
export function draftValuesForDay (ctx: Omit<ScheduleContext, 'issue'>, day: number): DayDraftValues {
  const plan = planSchedule({ ...ctx, issue: {} }, day)
  if (plan.ok === false) return { ok: false, reason: plan.reason }
  const patch = buildIssuePatch({}, plan.writes)
  const values: DraftValues = {}
  for (const key of ['startDate', 'dueDate', 'deadline'] as const) {
    const value = patch[key]
    if (typeof value === 'number') values[key] = value
  }
  const custom = patch.customFields
  if (custom !== null && typeof custom === 'object') values.customFields = { ...(custom as Record<string, unknown>) }
  return { ok: true, values }
}
