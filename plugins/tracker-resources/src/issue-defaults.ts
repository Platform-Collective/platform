// SPDX-License-Identifier: EPL-2.0

import core, { fillDefaults } from '@hcengineering/core'
import type { DocData, Hierarchy } from '@hcengineering/core'
import tracker from '@hcengineering/tracker'
import type { Issue, IssueDraft } from '@hcengineering/tracker'

/** Preserves custom draft values and fills missing defaults in the issue creation payload. */
export function fillIssueDefaults (hierarchy: Hierarchy, draft: IssueDraft, value: DocData<Issue>): void {
  const draftValues = draft as unknown as Record<string, unknown>
  const values = value as unknown as Record<string, unknown>
  for (const [key, attribute] of hierarchy.getAllAttributes(tracker.class.Issue, core.class.AttachedDoc)) {
    if (attribute.isCustom === true && draftValues[key] !== undefined && values[key] === undefined) {
      values[key] = draftValues[key]
    }
  }
  fillDefaults(hierarchy, value, tracker.class.Issue)
}
