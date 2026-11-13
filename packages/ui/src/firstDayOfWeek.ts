// SPDX-License-Identifier: EPL-2.0

/** Browser storage key of the first day of the week chosen on this device. */
export const firstDayOfWeekStorageKey = 'firstDayOfWeek'

/** `system` follows the browser locale, a number is a day from 0 (Sunday) to 6 (Saturday). */
export type FirstDayOfWeekPreference = 'system' | number

export function parseFirstDayOfWeek (stored: string | null | undefined): FirstDayOfWeekPreference {
  const value = stored?.trim()
  if (value === undefined || !/^[0-6]$/.test(value)) {
    return 'system'
  }
  return Number(value)
}

export function resolveFirstDayOfWeek (preference: FirstDayOfWeekPreference, localWeekStart: number): number {
  return preference === 'system' ? localWeekStart : preference
}

export function loadFirstDayOfWeek (): FirstDayOfWeekPreference {
  try {
    return parseFirstDayOfWeek(localStorage.getItem(firstDayOfWeekStorageKey))
  } catch {
    return 'system'
  }
}

export function saveFirstDayOfWeek (preference: FirstDayOfWeekPreference): void {
  try {
    localStorage.setItem(firstDayOfWeekStorageKey, `${preference}`)
  } catch {
    // The choice still applies until the page is reloaded.
  }
}
