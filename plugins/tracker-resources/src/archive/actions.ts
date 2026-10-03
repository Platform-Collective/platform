//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { Analytics } from '@hcengineering/analytics'
import { getClient } from '@hcengineering/presentation'
import type { Issue } from '@hcengineering/tracker'

import { setArchived } from './apply'

/**
 * Archives issues (GitHub "Archive item"). They keep every value and can be restored.
 */
export async function archiveIssue (issue: Issue | Issue[]): Promise<void> {
  try {
    await setArchived(getClient(), Array.isArray(issue) ? issue : [issue], true)
  } catch (err: any) {
    Analytics.handleError(err)
  }
}

/**
 * Restores archived issues to the views.
 */
export async function restoreIssue (issue: Issue | Issue[]): Promise<void> {
  try {
    await setArchived(getClient(), Array.isArray(issue) ? issue : [issue], false)
  } catch (err: any) {
    Analytics.handleError(err)
  }
}
