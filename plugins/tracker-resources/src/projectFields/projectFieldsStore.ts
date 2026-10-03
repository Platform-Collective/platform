//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { createQuery } from '@hcengineering/presentation'
import type { Project } from '@hcengineering/tracker'
import type { Ref } from '@hcengineering/core'
import { readable, type Readable } from 'svelte/store'

import tracker from '../plugin'
import { buildRegistry, type ProjectFieldRegistry } from './registry'

/**
 * Live registry of the fields defined in a project. The query is started on first
 * subscription and stopped when the last subscriber leaves.
 */
export function projectFieldsStore (project: Ref<Project>): Readable<ProjectFieldRegistry> {
  return readable<ProjectFieldRegistry>(buildRegistry([]), (set) => {
    const query = createQuery(true)
    query.query(tracker.class.ProjectField, { space: project }, (result) => {
      set(buildRegistry(result))
    })
    return () => {
      query.unsubscribe()
    }
  })
}
