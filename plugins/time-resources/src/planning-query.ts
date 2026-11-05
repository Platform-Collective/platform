// SPDX-License-Identifier: EPL-2.0

import type { Class, IdMap, Ref } from '@hcengineering/core'
import type { createQuery } from '@hcengineering/presentation'
import type { Issue } from '@hcengineering/tracker'

/** Shared issue/blocker subscription for list-level planning hints. */
export function queryPlanningIssues (
  query: ReturnType<typeof createQuery>,
  issueClass: Ref<Class<Issue>>,
  ids: Array<Ref<Issue>>,
  set: (value: IdMap<Issue>) => void
): void {
  if (ids.length === 0) {
    query.unsubscribe()
    set(new Map())
    return
  }
  if (query.query(issueClass, { _id: { $in: ids } }, (res) => {
    set(new Map(res.map((issue) => [issue._id, issue])))
  })) {
    set(new Map())
  }
}
