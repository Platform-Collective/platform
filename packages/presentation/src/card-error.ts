// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { setPlatformStatus, unknownError } from '@hcengineering/platform'

export function reportCardError (err: unknown): void {
  Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
  void setPlatformStatus(unknownError(err))
}
