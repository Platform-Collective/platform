// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import type { AttachedData, DocumentUpdate, Ref, Space, TxOperations } from '@hcengineering/core'
import { TrackerEvents } from '@hcengineering/tracker'
import type { Issue, TimeSpendReport } from '@hcengineering/tracker'
import tracker from '../../../plugin'
import { commitTimerWrite, saveReportOnce } from './issue-timer'

interface TimeReportIssue extends Pick<Issue, '_id' | '_class'> {
  space: Ref<Space>
  identifier?: string
}

export interface SaveTimeSpendReportOptions {
  target?: TimeReportIssue
  value?: TimeSpendReport
  data: AttachedData<TimeSpendReport>
  reportId?: Ref<TimeSpendReport>
  onAlreadySaved: () => Promise<void>
  onSaveFailed: () => Promise<void>
}

/** Create a time report through the issue collection so existing time totals and activity are updated. */
export async function createTimeSpendReport (
  client: TxOperations,
  issue: TimeReportIssue,
  data: AttachedData<TimeSpendReport>,
  id?: Ref<TimeSpendReport>
): Promise<void> {
  await client.addCollection(tracker.class.TimeSpendReport, issue.space, issue._id, issue._class, 'reports', data, id)
  Analytics.handleEvent(TrackerEvents.IssueTimeSpentAdded, { issue: issue.identifier ?? issue._id })
}

/**
 * Create a report under a fixed ID unless it exists. The scoped apply checks and inserts atomically on the server, so
 * concurrent submissions cannot add the time twice (a plain duplicate insert may be ignored by the adapter while its
 * triggers still update the issue totals). Returns false when the report already existed.
 */
export async function createTimeSpendReportOnce (
  client: TxOperations,
  issue: TimeReportIssue,
  data: AttachedData<TimeSpendReport>,
  id: Ref<TimeSpendReport>
): Promise<boolean> {
  const ops = client.apply(`tracker:time-report:${id}`).notMatch(tracker.class.TimeSpendReport, { _id: id })
  await ops.addCollection(tracker.class.TimeSpendReport, issue.space, issue._id, issue._class, 'reports', data, id)
  const result = await commitTimerWrite(ops)
  if (result) Analytics.handleEvent(TrackerEvents.IssueTimeSpentAdded, { issue: issue.identifier ?? issue._id })
  return result
}

export async function saveTimeSpendReport (client: TxOperations, options: SaveTimeSpendReportOptions): Promise<void> {
  try {
    await writeTimeSpendReport(client, options)
  } catch (err) {
    if (options.value === undefined && options.reportId !== undefined) throw err
    await options.onSaveFailed()
  }
}

async function writeTimeSpendReport (client: TxOperations, options: SaveTimeSpendReportOptions): Promise<void> {
  const { target, value, data, reportId, onAlreadySaved } = options
  if (value === undefined) {
    if (target === undefined) return
    if (reportId === undefined) {
      await createTimeSpendReport(client, target, data)
      return
    }
    const result = await saveReportOnce(
      async () => (await client.findOne(tracker.class.TimeSpendReport, { _id: reportId })) !== undefined,
      async () => await createTimeSpendReportOnce(client, target, data, reportId)
    )
    if (result === 'exists') await onAlreadySaved()
    return
  }

  const ops: DocumentUpdate<TimeSpendReport> = {}
  if (value.value !== data.value) ops.value = data.value
  if (value.employee !== data.employee) ops.employee = data.employee
  if (value.description !== data.description) ops.description = data.description
  if (value.date !== data.date) ops.date = data.date
  if (Object.keys(ops).length > 0) {
    await client.update(value, ops)
    Analytics.handleEvent(TrackerEvents.IssueTimeSpentUpdated, { issue: target?.identifier ?? value._id })
  }
}
