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
 * The part of a Huly event that describes its location.
 * `importedConferenceLink` is the value the Google sync itself put into `location` from the conference link.
 */
export interface LocationState {
  location?: string
  importedConferenceLink?: string
}

const isBlank = (value: string | undefined | null): boolean => value == null || value.trim() === ''

/**
 * Checks whether the Huly location is the conference link imported by the sync, not a location entered by a user.
 * Such a location is never written to the Google location field.
 */
export function isImportedConferenceLink (current: LocationState): boolean {
  return !isBlank(current.importedConferenceLink) && current.location === current.importedConferenceLink
}

/**
 * Checks whether the sync may replace the Huly location with the conference link of the Google event:
 * the location is the previously imported link (or the empty value left after it was removed),
 * or it is empty and nothing was imported yet. A link cleared by the user in Huly stays cleared.
 */
function isLocationManagedBySync (current: LocationState): boolean {
  if (current.importedConferenceLink !== undefined) {
    return (current.location ?? '') === current.importedConferenceLink
  }
  return isBlank(current.location)
}

/**
 * Returns the location data to store in Huly when a Google event is first imported.
 * An explicit location always wins; the conference link is used only when the location is empty.
 */
export function getEventLocation (event: calendar_v3.Schema$Event): LocationState {
  if (!isBlank(event.location)) {
    return { location: event.location ?? undefined }
  }
  const link = getConferenceLink(event)
  if (link !== undefined) {
    return { location: link, importedConferenceLink: link }
  }
  return { location: event.location ?? undefined }
}

/**
 * Returns the location changes to apply to an existing Huly event for an incoming Google event.
 * - An explicit Google location always wins.
 * - Otherwise a location managed by the sync follows the conference link: it is set when a link is added,
 *   replaced when the link changes and cleared when the conference is removed.
 * - A location the user set or cleared in Huly is not replaced by the conference link.
 */
export function getEventLocationUpdate (event: calendar_v3.Schema$Event, current: LocationState): LocationState {
  if (!isBlank(event.location)) {
    return { location: event.location ?? undefined }
  }
  if (!isLocationManagedBySync(current)) {
    // Same as before conference links were imported: an empty Google location that is present is copied.
    return event.location != null ? { location: event.location } : {}
  }
  const link = getConferenceLink(event) ?? ''
  if (link === '' && current.importedConferenceLink === undefined) {
    // Nothing was imported and there is nothing to import.
    return {}
  }
  return { location: link, importedConferenceLink: link }
}

/**
 * Returns the location to send to Google for a Huly event; an imported conference link is not a real location.
 */
export function getOutgoingLocation (current: LocationState): string | undefined {
  return isImportedConferenceLink(current) ? undefined : current.location
}

/**
 * Checks whether the Huly location of an event is already reflected in the Google event.
 * The imported conference link is always in sync: it is owned by Google's conference data,
 * and writing it into the Google location field would bring back a changed or removed link.
 */
export function isLocationInSync (current: LocationState, event: calendar_v3.Schema$Event): boolean {
  if (isImportedConferenceLink(current)) return true
  return (current.location ?? '') === (event.location ?? '')
}
