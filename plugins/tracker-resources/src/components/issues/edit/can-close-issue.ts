// SPDX-License-Identifier: EPL-2.0

import type { Issue } from '@hcengineering/tracker'

/** Check whether the issue editor can release focus when closing its panel. */
export function canCloseIssue (issue: Issue | undefined, descriptionBox?: { isFocused: () => boolean } | null): boolean {
  return issue === undefined || !descriptionBox?.isFocused()
}
