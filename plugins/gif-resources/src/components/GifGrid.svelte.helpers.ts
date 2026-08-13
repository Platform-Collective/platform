//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { WorkspaceGif } from '@hcengineering/gif'

/** The picker is a fixed 25.5rem wide on both tabs, matching the emoji popup, so the popup
 * never resizes when you switch tabs. */
export const GIF_GRID_COLUMNS = 2
export const GIF_GRID_COLUMNS_NARROW = 1
export const NARROW_BREAKPOINT_PX = 360

/** @public */
export function columnCount (widthPx: number): number {
  return widthPx < NARROW_BREAKPOINT_PX ? GIF_GRID_COLUMNS_NARROW : GIF_GRID_COLUMNS
}

/**
 * Aspect ratio, clamped. A GIF that is 8:1 or 1:8 would otherwise make one grid cell absurd
 * and push everything below it off screen.
 * @public
 */
export function aspectRatio (gif: Pick<WorkspaceGif, 'width' | 'height'>): number {
  const w = gif.width > 0 ? gif.width : 1
  const h = gif.height > 0 ? gif.height : 1
  return Math.min(3, Math.max(1 / 3, w / h))
}

/**
 * Shortest-column-first packing. A naive round-robin leaves one column dangling far below the
 * others whenever heights differ, which is what makes a GIF grid look broken rather than dense.
 * Order within a column is preserved so the result is stable across re-renders.
 * @public
 */
export function packColumns<T extends Pick<WorkspaceGif, 'width' | 'height'>> (items: T[], columns: number): T[][] {
  const n = Math.max(1, columns)
  const result: T[][] = Array.from({ length: n }, () => [])
  const heights = new Array<number>(n).fill(0)

  for (const item of items) {
    let shortest = 0
    for (let i = 1; i < n; i++) {
      if (heights[i] < heights[shortest]) shortest = i
    }
    result[shortest].push(item)
    // Unit width per column, so relative height is 1 / aspect.
    heights[shortest] += 1 / aspectRatio(item)
  }

  return result
}

/** Recents, newest first, deduped by id and capped. Mirrors the emoji picker's
 * frequently-used group, which users expect to find here too.
 * @public */
export const MAX_RECENTS = 12

/** @public */
export function pushRecent (recents: string[], id: string, max: number = MAX_RECENTS): string[] {
  return [id, ...recents.filter((r) => r !== id)].slice(0, max)
}

/** Persisted state is attacker-adjacent only in the sense that it rots: a corrupt or
 * hand-edited entry must not break the tab.
 * @public */
export function parseRecents (raw: string | null): string[] {
  if (raw === null || raw === '') return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

/** @public */
export function orderByRecents<T extends { _id: string }> (items: T[], recents: string[]): T[] {
  const rank = new Map(recents.map((id, i) => [id, i]))
  return [...items].sort((a, b) => (rank.get(a._id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b._id) ?? Number.MAX_SAFE_INTEGER))
}
