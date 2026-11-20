// SPDX-License-Identifier: EPL-2.0

export interface RunningIssueTimer {
  issueId: string
  identifier: string
  reportId: string
  startedAt: number
  stoppedAt?: number
}

interface TimerStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
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

/** Restore a timer, ignoring malformed or obsolete browser data. Storage access errors propagate to the UI. */
export function readIssueTimer (storage: TimerStorage, key: string): RunningIssueTimer | undefined {
  const value = storage.getItem(key)
  if (value === null) return
  let data: unknown
  try {
    data = JSON.parse(value)
  } catch {
    return
  }
  if (typeof data !== 'object' || data === null) return
  const timer = data as Partial<RunningIssueTimer>
  if (
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
  return timer as RunningIssueTimer
}

/** Start only when the user has no running or unsaved timer. Call under the user's timer lock. */
export function startIssueTimer (storage: TimerStorage, key: string, timer: RunningIssueTimer): boolean {
  if (readIssueTimer(storage, key) !== undefined) return false
  storage.setItem(key, JSON.stringify(timer))
  return true
}

/** Remove only the displayed timer, after its report is saved or to discard it. Call under the user's timer lock. */
export function discardIssueTimer (storage: TimerStorage, key: string, reportId: string): void {
  if (readIssueTimer(storage, key)?.reportId === reportId) storage.removeItem(key)
}

/**
 * Freeze the elapsed time so the report can be reviewed without the timer running on, and keep it until the report
 * is saved or the timer is discarded. Call under the user's timer lock.
 */
export function stopIssueTimer (
  storage: TimerStorage,
  key: string,
  reportId: string,
  now: number = Date.now()
): RunningIssueTimer | undefined {
  const timer = readIssueTimer(storage, key)
  // The caller passes the timer it displayed; another tab may have stopped, saved or replaced it before the lock.
  if (timer === undefined || timer.reportId !== reportId) return
  if (timer.stoppedAt === undefined) {
    timer.stoppedAt = Math.max(timer.startedAt, now)
    storage.setItem(key, JSON.stringify(timer))
  }
  return timer
}

/** Report hours of a stopped timer, rounded like getReportHours. */
export function getStoppedTimerHours (timer: RunningIssueTimer): number {
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

let pending: Promise<unknown> = Promise.resolve()

/** Serialize timer changes across browser tabs, or within this window if Web Locks are unavailable. */
export async function withIssueTimerLock (key: string, action: () => Promise<void>): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.locks !== undefined) {
    await navigator.locks.request(key, action)
  } else {
    const next = pending.then(action)
    pending = next.catch(() => {})
    await next
  }
}
