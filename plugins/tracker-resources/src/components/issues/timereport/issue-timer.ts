// SPDX-License-Identifier: EPL-2.0

import type { PersonSpace } from '@hcengineering/contact'
import type { ApplyOperations, Data, Ref, TxOperations } from '@hcengineering/core'
import type { IssueTimer } from '@hcengineering/tracker'
import tracker from '../../../plugin'

export type IssueTimerWarning = 'long' | 'pastMidnight'

const longTimerThreshold = 10 * 60 * 60 * 1000

interface TimerStorage {
  getItem: (key: string) => string | null
  removeItem: (key: string) => void
}

export function readStoredIssueTimer (storage: TimerStorage, key: string): Data<IssueTimer> | undefined {
  const value = storage.getItem(key)
  if (value === null) return
  try {
    const timer = JSON.parse(value) as Partial<Data<IssueTimer>> | null
    if (
      timer === null ||
      typeof timer !== 'object' ||
      typeof timer.issueId !== 'string' ||
      typeof timer.identifier !== 'string' ||
      typeof timer.reportId !== 'string' ||
      typeof timer.startedAt !== 'number' ||
      !Number.isFinite(timer.startedAt) ||
      timer.startedAt < 0 ||
      (timer.stoppedAt !== undefined &&
        (typeof timer.stoppedAt !== 'number' || !Number.isFinite(timer.stoppedAt) || timer.stoppedAt < timer.startedAt))
    ) {
      return
    }
    return {
      issueId: timer.issueId,
      identifier: timer.identifier,
      reportId: timer.reportId,
      startedAt: timer.startedAt,
      stoppedAt: timer.stoppedAt
    }
  } catch {}
}

export async function migrateStoredIssueTimer (
  client: TxOperations,
  storage: TimerStorage,
  key: string,
  space: Ref<PersonSpace>,
  id: Ref<IssueTimer>
): Promise<void> {
  const stored = readStoredIssueTimer(storage, key)
  if (stored === undefined) return
  await startIssueTimer(client, space, id, stored)
  storage.removeItem(key)
}

/** Calculate elapsed milliseconds from timestamps, including time spent outside the issue view. */
export function getElapsedTime (startedAt: number, now: number): number {
  return Number.isFinite(startedAt) && Number.isFinite(now) ? Math.max(0, now - startedAt) : 0
}

/** Round to the nearest minute, with a one-minute minimum, in the report's three-decimal hour format. */
export function getReportHours (elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0
  return Math.round((Math.max(1, Math.round(elapsed / 60000)) / 60) * 1000) / 1000
}

/** Format a duration as hours, minutes and seconds without wrapping at midnight. */
export function formatElapsedTime (elapsed: number): string {
  const seconds = Math.floor(getElapsedTime(0, elapsed) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

/** Identify durations that should be explicitly reviewed before creating a report. */
export function getIssueTimerWarnings (startedAt: number, stoppedAt: number): IssueTimerWarning[] {
  const warnings: IssueTimerWarning[] = []
  if (getElapsedTime(startedAt, stoppedAt) > longTimerThreshold) warnings.push('long')
  const started = new Date(startedAt)
  const stopped = new Date(stoppedAt)
  if (
    Number.isFinite(started.getTime()) &&
    Number.isFinite(stopped.getTime()) &&
    (started.getFullYear() !== stopped.getFullYear() ||
      started.getMonth() !== stopped.getMonth() ||
      started.getDate() !== stopped.getDate())
  ) {
    warnings.push('pastMidnight')
  }
  return warnings
}

/** A scoped write must return an explicit outcome before we act on it. */
export async function commitTimerWrite (ops: ApplyOperations): Promise<boolean> {
  const { result } = await ops.commit()
  if (typeof result !== 'boolean') {
    throw new Error('The timer transaction could not be confirmed')
  }
  return result
}

/** Create the user's single timer atomically in their personal space. */
export async function startIssueTimer (
  client: TxOperations,
  space: Ref<PersonSpace>,
  id: Ref<IssueTimer>,
  timer: Data<IssueTimer>
): Promise<boolean> {
  const ops = client.apply(`tracker:issue-timer:${id}`).notMatch(tracker.class.IssueTimer, { _id: id })
  await ops.createDoc(tracker.class.IssueTimer, space, timer, id)
  return await commitTimerWrite(ops)
}

/** Remove only the displayed timer, after its report is saved or to discard it. */
export async function discardIssueTimer (client: TxOperations, timer: IssueTimer): Promise<boolean> {
  const ops = client
    .apply(`tracker:issue-timer:${timer._id}`)
    .match(tracker.class.IssueTimer, { _id: timer._id, reportId: timer.reportId })
  await ops.remove(timer)
  return await commitTimerWrite(ops)
}

/** Freeze the elapsed time atomically so another device cannot move the stop time or replace the timer. */
export async function stopIssueTimer (
  client: TxOperations,
  id: Ref<IssueTimer>,
  reportId: IssueTimer['reportId'],
  now: number = Date.now()
): Promise<IssueTimer | undefined> {
  const timer = await client.findOne(tracker.class.IssueTimer, { _id: id })
  if (timer === undefined || timer.reportId !== reportId) return
  if (timer.stoppedAt !== undefined) return timer
  const stoppedAt = Math.max(timer.startedAt, now)
  const ops = client.apply(`tracker:issue-timer:${id}`).match(tracker.class.IssueTimer, {
    _id: id,
    reportId,
    stoppedAt: { $exists: false }
  })
  await ops.update(timer, { stoppedAt })
  if (!(await commitTimerWrite(ops))) return
  return { ...timer, stoppedAt }
}

/** Report hours of a stopped timer, rounded like getReportHours. */
export function getStoppedTimerHours (timer: Pick<IssueTimer, 'startedAt' | 'stoppedAt'>): number {
  return getReportHours(getElapsedTime(timer.startedAt, timer.stoppedAt ?? timer.startedAt))
}

/**
 * Create a report under a fixed ID at most once. `create` must be a conditional create that returns false when the
 * report already exists, e.g. submitted from a second dialog or tab. A failed create after which the report exists
 * (lost response) also counts as saved.
 */
export async function saveReportOnce (
  exists: () => Promise<boolean>,
  create: () => Promise<boolean>
): Promise<'created' | 'exists'> {
  if (await exists()) return 'exists'
  try {
    return (await create()) ? 'created' : 'exists'
  } catch (err) {
    if (await exists().catch(() => false)) return 'exists'
    throw err
  }
}
