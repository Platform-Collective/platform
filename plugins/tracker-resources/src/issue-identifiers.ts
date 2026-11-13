// SPDX-License-Identifier: EPL-2.0

import { SortingOrder, type Client } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

/** Resolve visible current identifiers before historical aliases, including archived projects. */
export async function findIssueByIdentifier (
  client: Pick<Client, 'findOne'>,
  identifier: string
): Promise<Issue | undefined> {
  const options = { showArchived: true }
  const issue = await client.findOne(tracker.class.Issue, { identifier }, options)
  if (issue !== undefined) return issue

  const alias = await client.findOne(
    tracker.class.IssueIdentifierAlias,
    { identifier },
    {
      ...options,
      sort: { createdOn: SortingOrder.Descending, _id: SortingOrder.Descending }
    }
  )
  // Never fall back to an older alias when the chosen target is missing or inaccessible.
  return alias === undefined ? undefined : await client.findOne(tracker.class.Issue, { _id: alias.issue }, options)
}
