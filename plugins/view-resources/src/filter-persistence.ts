// SPDX-License-Identifier: EPL-2.0

import type { Location } from '@hcengineering/ui'
import type { Filter } from '@hcengineering/view'

export function makeFilterStorageKey (location: Location, filterClass?: string): string {
  return `filter/${location.path.slice(0, 3).map(encodeURIComponent).join('/')}${filterClass ?? ''}`
}

export interface FilterPersistence {
  load: (key: string, savedView: boolean, override?: Filter[], location?: string) => void
  save: (key: string, filters: Filter[], savedView: boolean) => void
}

/** Keeps unsaved filters scoped to the current application and class. */
export function createFilterPersistence (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  restore: (filters: Filter[]) => void
): FilterPersistence {
  let activeKey: string | undefined
  let activeLocation: string | undefined
  let restoring = false

  return {
    load (key, savedView, override, location = key) {
      if (activeKey === key && activeLocation === location && override === undefined) return
      activeKey = key
      activeLocation = location
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
      if (override !== undefined) this.save(key, override, false)
    },
    save (key, filters, savedView) {
      // Location changes can arrive before the component restores its new filters.
      if (restoring || key !== activeKey || savedView) return
      try {
        storage.setItem(key, JSON.stringify(filters))
      } catch {
        // Filtering still works when storage is unavailable or its quota is exceeded.
      }
    }
  }
}
