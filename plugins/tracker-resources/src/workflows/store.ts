//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref } from '@hcengineering/core'
import { createQuery } from '@hcengineering/presentation'
import { resolveWorkflows, type EffectiveWorkflow, type Project } from '@hcengineering/tracker'
import { readable, type Readable } from 'svelte/store'

import tracker from '../plugin'

/**
 * Live list of the workflows of a project, one per kind, with the defaults of a kind that was never stored. The query is
 * started on first subscription and stopped when the last subscriber leaves.
 */
export function workflowsStore (project: Ref<Project>): Readable<EffectiveWorkflow[]> {
  return readable<EffectiveWorkflow[]>(resolveWorkflows([]), (set) => {
    const query = createQuery(true)
    query.query(tracker.class.Workflow, { space: project }, (result) => {
      set(resolveWorkflows(result))
    })
    return () => {
      query.unsubscribe()
    }
  })
}
