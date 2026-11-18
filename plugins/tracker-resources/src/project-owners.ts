// SPDX-License-Identifier: EPL-2.0

import core, { type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import { createQuery, getClient } from '@hcengineering/presentation'
import { trackerId, type ProjectNavigatorPreference } from '@hcengineering/tracker'
import { get, writable } from 'svelte/store'
import tracker from './plugin'

// The navigator preference is a single private document per account (the preference domain only returns the
// caller's own documents), attached to the tracker application.
export const navigatorPreferenceTarget = trackerId as unknown as Ref<Doc>

/** Owners are shown unless the user switched them off. */
export function isShowingProjectOwners (
  preferences: Array<Pick<ProjectNavigatorPreference, 'showProjectOwners'>>
): boolean {
  return preferences[0]?.showProjectOwners ?? true
}

export const showProjectOwners = writable<boolean>(true)

let watching = false
/** Keeps `showProjectOwners` in sync with the account preference; safe to call from every navigator entry. */
export function watchProjectOwnersPreference (): void {
  if (watching) return
  watching = true
  createQuery(true).query(
    tracker.class.ProjectNavigatorPreference,
    { attachedTo: navigatorPreferenceTarget },
    (result) => {
      showProjectOwners.set(isShowingProjectOwners(result))
    },
    { limit: 1 }
  )
}

export async function setShowProjectOwners (client: TxOperations, value: boolean): Promise<void> {
  const current = await client.findOne(tracker.class.ProjectNavigatorPreference, {
    attachedTo: navigatorPreferenceTarget
  })
  if (current === undefined) {
    await client.createDoc(tracker.class.ProjectNavigatorPreference, core.space.Workspace, {
      attachedTo: navigatorPreferenceTarget,
      showProjectOwners: value
    })
  } else if (current.showProjectOwners !== value) {
    await client.updateDoc(current._class, current.space, current._id, { showProjectOwners: value })
  }
  showProjectOwners.set(value)
}

export async function showProjectOwnersAction (): Promise<void> {
  await setShowProjectOwners(getClient(), true)
}

export async function hideProjectOwnersAction (): Promise<void> {
  await setShowProjectOwners(getClient(), false)
}

export async function canShowProjectOwners (): Promise<boolean> {
  return !get(showProjectOwners)
}

export async function canHideProjectOwners (): Promise<boolean> {
  return get(showProjectOwners)
}
