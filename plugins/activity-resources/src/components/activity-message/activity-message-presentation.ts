// SPDX-License-Identifier: EPL-2.0

import { getContext, setContext } from 'svelte'
import { readable, writable, type Readable, type Writable } from 'svelte/store'
import type { ActivityMessagePresentation } from '../../types'

const presentationContext = 'activity-message-presentation'

export function setActivityMessagePresentation (
  presentation: ActivityMessagePresentation
): Writable<ActivityMessagePresentation> {
  const store = writable(presentation)
  setContext(presentationContext, store)
  return store
}

export function getActivityMessagePresentation (): Readable<ActivityMessagePresentation> {
  return (
    getContext<Readable<ActivityMessagePresentation> | undefined>(presentationContext) ??
    readable<ActivityMessagePresentation>('default')
  )
}
