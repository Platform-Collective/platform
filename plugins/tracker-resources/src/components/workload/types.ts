//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Issue } from '@hcengineering/tracker'
import type { RowLoad, RowSummary } from '../../workload/compute'
import type { RowInfo } from '../../workload/rows'

/** A row of the grid: a person (or the unassigned items) with the load and the header figures. */
export interface GridRow {
  info: RowInfo
  load: RowLoad
  summary: RowSummary
}

/** A cell of the grid: a bucket of a row, or the cell of the items without a day. */
export interface CellRef {
  row: string
  bucket: number | 'unscheduled'
}

/** An item in the list of a cell and the part of its load that falls into the cell. */
export interface PanelItem {
  issue: Issue
  share: number
}
