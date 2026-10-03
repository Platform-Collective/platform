//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { TxOperations } from '@hcengineering/core'
import type { Issue, ProjectFieldValue } from '@hcengineering/tracker'

import { mergeCustomFieldValue } from './registry'

/**
 * Store one custom field value on an issue. An empty value removes the key.
 */
export async function setIssueCustomFieldValue (
  client: TxOperations,
  issue: Pick<Issue, '_class' | '_id' | 'space' | 'attachedTo' | 'attachedToClass' | 'collection' | 'customFields'>,
  key: string,
  value: ProjectFieldValue
): Promise<void> {
  const customFields = mergeCustomFieldValue(issue.customFields, key, value)
  await client.updateCollection(
    issue._class,
    issue.space,
    issue._id,
    issue.attachedTo,
    issue.attachedToClass,
    issue.collection,
    { customFields }
  )
}
