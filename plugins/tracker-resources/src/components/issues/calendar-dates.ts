// SPDX-License-Identifier: EPL-2.0

export interface IssueCalendarDates {
  startDate?: number | null
  dueDate?: number | null
}

export interface IssueCalendarRange {
  start: number
  end: number
}

export interface IssueCalendarDateUpdate {
  dueDate: number
  startDate?: number
}

function isValidDate (value: number | null | undefined): value is number {
  return value != null && Number.isFinite(new Date(value).getTime())
}

function startOfDay (value: number): number {
  return new Date(value).setHours(0, 0, 0, 0)
}

/** Inclusive local-day range, matching the shared due-date editor and month grid. */
export function getIssueCalendarRange (issue: IssueCalendarDates): IssueCalendarRange | undefined {
  if (!isValidDate(issue.dueDate)) return undefined
  const end = startOfDay(issue.dueDate)
  const start = isValidDate(issue.startDate) ? Math.min(startOfDay(issue.startDate), end) : end
  return { start, end }
}

/** Whether an issue is visible on a day; a due date is required. */
export function isIssueOnCalendarDay (issue: IssueCalendarDates, date: Date): boolean {
  const range = getIssueCalendarRange(issue)
  const day = startOfDay(date.getTime())
  return range !== undefined && day >= range.start && day <= range.end
}

/** Move the due date to a local day, preserving its time and shifting both timestamps equally. */
export function moveIssueToCalendarDay (issue: IssueCalendarDates, date: Date): IssueCalendarDateUpdate | undefined {
  if (!isValidDate(issue.dueDate) || !Number.isFinite(date.getTime())) return undefined
  const due = new Date(issue.dueDate)
  due.setFullYear(date.getFullYear(), date.getMonth(), date.getDate())
  const dueDate = due.getTime()
  if (dueDate === issue.dueDate) return undefined
  const delta = dueDate - issue.dueDate
  return {
    dueDate,
    ...(isValidDate(issue.startDate) ? { startDate: issue.startDate + delta } : {})
  }
}

/** Navigate from the first day to avoid overflowing short months. */
export function moveCalendarMonth (date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

/** Local-midnight bounds [start, end) that cover every cell of the six-week month grid. */
export function getCalendarQueryWindow (date: Date): IssueCalendarRange {
  const year = date.getFullYear()
  const month = date.getMonth()
  return { start: new Date(year, month, 1 - 7).getTime(), end: new Date(year, month, 1 + 42).getTime() }
}

/** Key of the local day that contains `date`, as used by {@link groupIssuesByCalendarDay}. */
export function getCalendarDayKey (date: Date): number {
  return startOfDay(date.getTime())
}

/**
 * Issues per local day inside `window`, keyed by {@link getCalendarDayKey}. Built once per issue list so
 * the grid cells do not each filter the whole list. Ranges are clipped to the window; order is kept.
 */
export function groupIssuesByCalendarDay<T extends IssueCalendarDates> (
  issues: readonly T[],
  window: IssueCalendarRange
): Map<number, T[]> {
  const result = new Map<number, T[]>()
  for (const issue of issues) {
    const range = getIssueCalendarRange(issue)
    if (range === undefined) continue
    const day = new Date(Math.max(range.start, startOfDay(window.start)))
    while (day.getTime() <= range.end && day.getTime() < window.end) {
      const key = day.getTime()
      const list = result.get(key)
      if (list === undefined) result.set(key, [issue])
      else list.push(issue)
      day.setDate(day.getDate() + 1)
    }
  }
  return result
}
