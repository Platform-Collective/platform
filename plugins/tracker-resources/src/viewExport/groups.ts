//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { NO_GROUPING } from '../board/config'

/**
 * The keys an export is grouped by, outermost first, as the view shows its rows: a table or a roadmap lists group after
 * group by the "Group by" of the view, a board lists lane after lane (the "Group by"), and inside a lane column after
 * column. A key that means "no grouping" is left out, and so is a key that is listed twice.
 */
export function exportGroupKeys (params: {
  groupBy: readonly string[] | undefined
  // Set for a board: the keys of its columns and of its swimlanes
  board?: { columnKey: string, laneKey: string | undefined }
}): string[] {
  const keys: string[] = []
  const add = (key: string | undefined): void => {
    if (key === undefined || key === '' || key === NO_GROUPING || keys.includes(key)) return
    keys.push(key)
  }
  if (params.board !== undefined) {
    add(params.board.laneKey)
    add(params.board.columnKey)
    return keys
  }
  for (const key of params.groupBy ?? []) add(key)
  return keys
}
