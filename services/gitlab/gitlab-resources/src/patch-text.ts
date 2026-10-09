// SPDX-License-Identifier: EPL-2.0

// A diff may be a few MB; a tab keeps this many
export const TEXT_CACHE_LIMIT = 8

/**
 * Downloads each blob once and keeps the `limit` most recently used ones. A failed download is forgotten, so the next
 * call tries again.
 */
export function createTextCache (
  load: (file: string, name: string) => Promise<string>,
  limit = TEXT_CACHE_LIMIT
): (file: string, name: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>()
  return async (file, name) => {
    let text = cache.get(file)
    if (text !== undefined) {
      // Map order is insertion order: re-inserting marks it most recently used
      cache.delete(file)
    } else {
      const loading = load(file, name)
      loading.catch(() => {
        if (cache.get(file) === loading) cache.delete(file)
      })
      text = loading
    }
    cache.set(file, text)
    while (cache.size > limit) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return await text
  }
}
