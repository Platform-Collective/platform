// SPDX-License-Identifier: EPL-2.0

import type { Doc } from '@hcengineering/core'

// Track object identity, propagating only to trusted cache-derived copies in Refs.
// Neither server-loaded copies nor later edits inherit the marker.
// Weak references keep this local bookkeeping out of documents and release discarded windows.
const optimisticCreates = new WeakSet<Doc>()

export function markOptimisticCreate (doc: Doc): void {
  optimisticCreates.add(doc)
}

export function isOptimisticCreate (doc: Doc): boolean {
  return optimisticCreates.has(doc)
}

export function clearOptimisticCreate (doc: Doc): void {
  optimisticCreates.delete(doc)
}
