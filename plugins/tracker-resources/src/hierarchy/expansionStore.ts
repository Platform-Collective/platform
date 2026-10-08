//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { writable, type Readable } from 'svelte/store'
import { parseExpanded, serializeExpanded, toggleExpanded } from './expansion'

export interface ExpansionStore extends Readable<ReadonlySet<string>> {
  toggle: (id: string) => void
}

const stores = new Map<string, ExpansionStore>()

function load (key: string): Set<string> {
  try {
    return parseExpanded(localStorage.getItem(key))
  } catch {
    // Storage can be unavailable (private mode); the tree then only keeps its state for the session
    return new Set()
  }
}

function save (key: string, ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, serializeExpanded(ids))
  } catch {
    // The in-memory state still works
  }
}

/**
 * The expanded rows of one view of the viewer. The same store is returned for the same key, so that every list
 * that shows the view agrees, and it is mirrored to local storage.
 */
export function expansionStore (storageKey: string): ExpansionStore {
  let store = stores.get(storageKey)
  if (store === undefined) {
    const state = writable<ReadonlySet<string>>(load(storageKey))
    store = {
      subscribe: state.subscribe,
      toggle: (id) => {
        state.update((ids) => {
          const next = toggleExpanded(ids, id)
          save(storageKey, next)
          return next
        })
      }
    }
    stores.set(storageKey, store)
  }
  return store
}
