//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { AttributeModel } from '@hcengineering/view'

/**
 * How the categories of one axis of the board (the columns or the swimlanes) are shown and written.
 */
export interface DimensionInfo {
  // View key of the field: a built-in attribute, or `customFields.<key>`
  key: string
  // Whether the field is a custom field
  custom: boolean
  // Presenter of the title of a category of a built-in field
  presenter?: AttributeModel
  // Presenter of the title of a category of a custom field (an option or an iteration)
  customHeader?: any
  // Title of the category without a value of a custom field ("No <field>")
  emptyLabel?: string
}
