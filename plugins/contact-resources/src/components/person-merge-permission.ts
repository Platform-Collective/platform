// SPDX-License-Identifier: EPL-2.0

import type { PersonUuid } from '@hcengineering/core'

/** Whether a global-person permission check can be reused for this pair. */
export function isPersonMergePermissionCached (
  primaryUuid: PersonUuid | undefined,
  secondaryUuid: PersonUuid | undefined,
  previousPrimaryUuid: PersonUuid | undefined,
  previousSecondaryUuid: PersonUuid | undefined
): boolean {
  return (
    primaryUuid !== undefined &&
    secondaryUuid !== undefined &&
    primaryUuid === previousPrimaryUuid &&
    secondaryUuid === previousSecondaryUuid
  )
}
