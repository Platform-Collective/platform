//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { getFieldValue, ProjectFieldType, type ProjectField } from '@hcengineering/tracker'

export interface IterationLabel {
  _id: string
  label: string
}

/**
 * Plain text of the value of a custom field, for labels and group headers; undefined when the item has no value.
 */
export function formatCustomValue (
  field: Pick<ProjectField, 'key' | 'type' | 'options'>,
  customFields: Record<string, unknown> | undefined,
  iterations: readonly IterationLabel[],
  locale?: string
): string | undefined {
  const value = getFieldValue(customFields, field)
  if (value === null) return undefined
  switch (field.type) {
    case ProjectFieldType.Text:
      return value === '' ? undefined : String(value)
    case ProjectFieldType.Number:
      return String(value)
    case ProjectFieldType.Date:
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value as number))
    case ProjectFieldType.SingleSelect:
      return (field.options ?? []).find((o) => o.value === value)?.label
    case ProjectFieldType.MultiSelect: {
      const options = field.options ?? []
      const labels = (value as string[]).map((v) => options.find((o) => o.value === v)?.label).filter((l) => l !== undefined)
      return labels.length > 0 ? labels.join(', ') : undefined
    }
    case ProjectFieldType.Iteration:
      return iterations.find((it) => it._id === value)?.label
  }
}
