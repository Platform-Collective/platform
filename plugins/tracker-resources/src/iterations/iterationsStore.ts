//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { createQuery } from '@hcengineering/presentation'
import type { Ref } from '@hcengineering/core'
import type { Iteration, Project, ProjectField } from '@hcengineering/tracker'
import { readable, type Readable } from 'svelte/store'

import tracker from '../plugin'

/**
 * Live list of the iterations of all Iteration fields of a project. The query is started on first
 * subscription and stopped when the last subscriber leaves.
 */
export function iterationsStore (project: Ref<Project>): Readable<Iteration[]> {
  return readable<Iteration[]>([], (set) => {
    const query = createQuery(true)
    query.query(tracker.class.Iteration, { space: project }, (result) => {
      set(result)
    })
    return () => {
      query.unsubscribe()
    }
  })
}

const sharedStores = new Map<Ref<Project>, Readable<Iteration[]>>()

/**
 * Same as `iterationsStore`, but one store (and so one live query) per project is shared by all callers.
 * Use it where many components need the iterations at once, e.g. one cell per list row.
 */
export function sharedIterationsStore (project: Ref<Project>): Readable<Iteration[]> {
  let store = sharedStores.get(project)
  if (store === undefined) {
    store = iterationsStore(project)
    sharedStores.set(project, store)
  }
  return store
}

/**
 * The iterations of one field.
 */
export function iterationsOfField (iterations: readonly Iteration[], field: Pick<ProjectField, '_id'>): Iteration[] {
  return iterations.filter((it) => it.field === field._id)
}

/**
 * The iterations of every field, by field key.
 */
export function iterationsByFieldKey (
  iterations: readonly Iteration[],
  fields: ReadonlyArray<Pick<ProjectField, '_id' | 'key'>>
): Map<string, Iteration[]> {
  const res = new Map<string, Iteration[]>()
  for (const field of fields) res.set(field.key, iterationsOfField(iterations, field))
  return res
}
