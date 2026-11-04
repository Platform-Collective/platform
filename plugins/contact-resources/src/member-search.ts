// SPDX-License-Identifier: EPL-2.0

function matchScore (value: string, query: string): number | undefined {
  if (value === query) return 0
  if (value.startsWith(query)) return 1
  if (value.split(/[\s,]+/).some((word) => word.startsWith(query))) return 2
  if (value.includes(query)) return 3
  return undefined
}

/**
 * Ranks items by how well one of their names matches the search: the whole name, then names
 * starting with it, then names with a word starting with it, then names containing it.
 * Equal matches are sorted alphabetically.
 */
export function rankByName<T> (items: T[], search: string, names: (item: T) => string[], limit: number): T[] {
  const query = search.trim().toLowerCase()
  const ranked: Array<{ item: T, score: number, title: string }> = []
  for (const item of items) {
    const values = names(item)
      .map((name) => name.toLowerCase())
      .filter((name) => name !== '')
    let score: number | undefined = query === '' ? 0 : undefined
    if (query !== '') {
      for (const value of values) {
        const s = matchScore(value, query)
        if (s !== undefined && (score === undefined || s < score)) score = s
      }
    }
    if (score !== undefined) ranked.push({ item, score, title: values[0] ?? '' })
  }
  ranked.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
  return ranked.slice(0, limit).map(({ item }) => item)
}
