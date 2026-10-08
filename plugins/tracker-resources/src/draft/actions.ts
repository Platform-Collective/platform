//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { Analytics } from '@hcengineering/analytics'
import { getClient } from '@hcengineering/presentation'
import type { Issue } from '@hcengineering/tracker'

import { convertDraftsToIssues } from './convert'

/**
 * Converts draft items to issues (GitHub "Convert to issue"): they get the next numbers of their project.
 */
export async function convertDraftToIssue (draft: Issue | Issue[]): Promise<void> {
  try {
    await convertDraftsToIssues(getClient(), Array.isArray(draft) ? draft : [draft])
  } catch (err: any) {
    Analytics.handleError(err)
  }
}
