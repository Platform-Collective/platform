// SPDX-License-Identifier: EPL-2.0

import { LRUCache } from 'lru-cache'

// A diff may be a few MB; a tab keeps this many
export const TEXT_CACHE_LIMIT = 8

/**
 * Loads each blob once and keeps the `limit` most recently used results. Concurrent calls for one blob share its
 * load; a failed load is forgotten, so the next call tries again.
 */
export function createTextCache<T extends {} = string> (
  load: (file: string, name: string) => Promise<T>,
  limit = TEXT_CACHE_LIMIT
): (file: string, name: string) => Promise<T> {
  const cache = new LRUCache<string, T, string>({
    max: limit,
    fetchMethod: async (file, _stale, { context: name }) => await load(file, name)
  })
  return async (file, name) => {
    const value = await cache.fetch(file, { context: name })
    // Only an aborted fetch resolves to undefined; nothing here aborts one
    if (value === undefined) throw new Error(`Failed to load ${name}`)
    return value
  }
}
