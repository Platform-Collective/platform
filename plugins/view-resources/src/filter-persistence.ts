// SPDX-License-Identifier: EPL-2.0

import type { Location } from '@hcengineering/ui'
import type { Filter } from '@hcengineering/view'

/** Unsaved filters are kept per view: the whole location path (without query and fragment) and class. */
export function makeFilterStorageKey (location: Location, filterClass?: string): string {
  return `filter/${location.path.map(encodeURIComponent).join('/')}${filterClass ?? ''}`
}

export interface FilterPersistence {
  load: (key: string, savedView: boolean, override?: Filter[], location?: string) => void
  save: (key: string, filters: Filter[], savedView: boolean) => void
}

/** Keeps unsaved filters scoped to the current view and class. */
export function createFilterPersistence (
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  restore: (filters: Filter[]) => void
): FilterPersistence {
  let activeKey: string | undefined
  let activeLocation: string | undefined
  let restoring = false
  let navigationFilters: Filter[] | undefined

  return {
    load (key, savedView, override, location = key) {
      if (activeKey === key && activeLocation === location && override === undefined) return
      activeKey = key
      activeLocation = location
      navigationFilters = override
      if (savedView && override === undefined) return

      let filters: Filter[] = []
      try {
        const items = storage.getItem(key)
        const parsed: unknown = items === null ? [] : JSON.parse(items)
        if (Array.isArray(parsed)) filters = parsed
      } catch {
        // Invalid or unavailable browser storage must not prevent opening a view.
      }

      restoring = true
      try {
        restore(override ?? filters)
      } finally {
        restoring = false
      }
    },
    save (key, filters, savedView) {
      // Location changes can arrive before the component restores its new filters.
      if (restoring || key !== activeKey || savedView || filters === navigationFilters) return
      navigationFilters = undefined
      try {
        if (filters.length === 0) storage.removeItem(key)
        else storage.setItem(key, JSON.stringify(filters))
      } catch {
        // Filtering still works when storage is unavailable or its quota is exceeded.
      }
    }
  }
}

/** Whether the selected saved view owns the current location's filters. */
export function isSavedFilterLocation (selected: { location: Location } | undefined, location: Location): boolean {
  return selected !== undefined && JSON.stringify(selected.location.path) === JSON.stringify(location.path)
}
