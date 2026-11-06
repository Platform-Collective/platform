// SPDX-License-Identifier: EPL-2.0

import type { Contact } from '@hcengineering/contact'
import type { DocumentQuery } from '@hcengineering/core'

export function getPersonNameQueries (search: string): Array<DocumentQuery<Contact>> {
  const normalizedSearch = search.trim()
  const parts = normalizedSearch.split(/\s+/)
  const patterns = new Set([`%${normalizedSearch}%`])

  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).join('%')
    const right = parts.slice(i).join('%')
    patterns.add(`%${right}%,%${left}%`)
    patterns.add(`%${left}%,%${right}%`)
  }

  return Array.from(patterns, ($like) => ({ name: { $like } }))
}
