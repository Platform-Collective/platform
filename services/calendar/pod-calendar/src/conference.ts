//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { calendar_v3 } from 'googleapis'

/**
 * Returns the video conference link (e.g. Google Meet) attached to a Google event, if any.
 */
export function getConferenceLink (event: calendar_v3.Schema$Event): string | undefined {
  if (event.hangoutLink != null && event.hangoutLink !== '') {
    return event.hangoutLink
  }
  const entryPoint = event.conferenceData?.entryPoints?.find(
    (p) => p.entryPointType === 'video' && p.uri != null && p.uri !== ''
  )
  return entryPoint?.uri ?? undefined
}

/**
 * Returns the location to store in Huly when a Google event is first imported.
 * An explicit location always wins; the conference link is used only when the location is empty.
 * It must not be used for updates of an already imported event: otherwise a location cleared by the user
 * would be restored from the conference link on the next incoming sync.
 */
export function getEventLocation (event: calendar_v3.Schema$Event): string | undefined {
  if (event.location != null && event.location.trim() !== '') {
    return event.location
  }
  return getConferenceLink(event) ?? event.location ?? undefined
}

/**
 * Checks whether the Huly location of an event is already reflected in the Google event.
 * A conference link stored in Huly as a fallback location is not a real Google location,
 * so it is in sync with an empty Google location, and so is a cleared Huly location.
 */
export function isLocationInSync (hulyLocation: string | undefined, event: calendar_v3.Schema$Event): boolean {
  const current = hulyLocation ?? ''
  const google = event.location ?? ''
  if (current === google) return true
  return google.trim() === '' && (current.trim() === '' || current === getConferenceLink(event))
}
