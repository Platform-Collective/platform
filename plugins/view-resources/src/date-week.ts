// SPDX-License-Identifier: EPL-2.0

/** Inclusive local calendar week, using the calendar's locale/user week start (Sunday is 0 or 7). */
export function getWeekRange (now: Date, firstDayOfWeek: number, offset: number = 0): { $gte: number, $lte: number } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() - firstDayOfWeek + 7) % 7) + offset * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { $gte: start.getTime(), $lte: end.getTime() }
}
