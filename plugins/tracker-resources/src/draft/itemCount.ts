//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref } from '@hcengineering/core'
import { createQuery } from '@hcengineering/presentation'
import type { Project } from '@hcengineering/tracker'
import { readable, type Readable } from 'svelte/store'

import tracker from '../plugin'

const stores = new Map<Ref<Project>, Readable<number>>()

/**
 * Number of items (issues, drafts and archived items) a project holds, live. One store, and so one query, is shared by
 * everything that asks for the same project (every column of a board has an "Add item" row). The query is started on
 * the first subscription and stopped when the last subscriber leaves.
 */
export function sharedItemCountStore (project: Ref<Project>): Readable<number> {
  let store = stores.get(project)
  if (store === undefined) {
    store = readable<number>(0, (set) => {
      const query = createQuery(true)
      query.query(
        tracker.class.Issue,
        { space: project },
        (res) => {
          set(res.total)
        },
        { limit: 1, total: true, projection: { _id: 1 } }
      )
      return () => {
        query.unsubscribe()
      }
    })
    stores.set(project, store)
  }
  return store
}
