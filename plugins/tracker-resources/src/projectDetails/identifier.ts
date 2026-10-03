//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/** Longest identifier of a project. */
export const MAX_IDENTIFIER_LENGTH = 5

/**
 * The first identifier derived from `base` that no other project uses: `TSK2`, `TSK3`, ..., kept within the longest
 * identifier by shortening the base. Used to name the copy of a project.
 */
export function freeIdentifier (base: string, taken: ReadonlySet<string>): string {
  const clean = base.toUpperCase().replace(/[-\s]/g, '_')
  for (let n = 2; n < 100000; n++) {
    const suffix = String(n)
    const candidate = `${clean.slice(0, Math.max(1, MAX_IDENTIFIER_LENGTH - suffix.length))}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return clean.slice(0, MAX_IDENTIFIER_LENGTH)
}
