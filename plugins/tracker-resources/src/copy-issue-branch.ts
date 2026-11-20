// SPDX-License-Identifier: EPL-2.0

import type { Doc } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { copyTextToClipboard } from '@hcengineering/presentation'
import type { Issue } from '@hcengineering/tracker'
import { addNotification } from '@hcengineering/ui'
import view from '@hcengineering/view'
import { SimpleNotification } from '@hcengineering/view-resources'
import { generateIssueBranchName } from './issue-branch'

/** Copy the focused issue's Git branch name without updating the issue. */
export async function copyIssueBranch (doc: Doc | Doc[] | undefined): Promise<void> {
  const issue = (Array.isArray(doc) ? doc[0] : doc) as Issue | undefined
  if (issue === undefined) return

  const branch = generateIssueBranchName(issue.identifier, issue.title)
  try {
    await copyTextToClipboard(branch)
    addNotification(await translate(view.string.Copied, {}), branch, SimpleNotification)
  } catch (error) {
    console.error('Failed to copy Git branch name', error)
  }
}
