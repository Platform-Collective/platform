// SPDX-License-Identifier: EPL-2.0

import type { DropdownTextItem } from '@hcengineering/ui'

/** Return the label for the enum selection shown by the dropdown. */
export function getEnumTooltipLabel (items: DropdownTextItem[] | undefined, value: string): string | undefined {
  return items?.find((item) => item.id === value)?.label
}
