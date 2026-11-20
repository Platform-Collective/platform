// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import type { AttachedData, Ref, Space, TxOperations } from '@hcengineering/core'
import { TrackerEvents } from '@hcengineering/tracker'
import type { Issue, TimeSpendReport } from '@hcengineering/tracker'
import tracker from '../../../plugin'

interface TimeReportIssue extends Pick<Issue, '_id' | '_class'> {
  space: Ref<Space>
  identifier?: string
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
  const { result } = await ops.commit()
  if (result) Analytics.handleEvent(TrackerEvents.IssueTimeSpentAdded, { issue: issue.identifier ?? issue._id })
  return result
}
