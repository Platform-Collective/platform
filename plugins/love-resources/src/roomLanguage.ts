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

import { type RoomLanguage } from '@hcengineering/love'
import { languagesDisplayData } from './types'

export const defaultRoomLanguage: RoomLanguage = 'en'

/**
 * Map a BCP 47 locale (e.g. navigator.language) to a supported room language.
 * Tries the full locale first, then its base language, and falls back to the default.
 */
export function getRoomLanguageForLocale (
  locale: string | undefined | null,
  fallback: RoomLanguage = defaultRoomLanguage
): RoomLanguage {
  if (locale == null) return fallback
  const normalized = locale.trim().replace(/_/g, '-').toLowerCase()
  if (normalized === '') return fallback
  const supported = Object.keys(languagesDisplayData) as RoomLanguage[]
  const exact = supported.find((lang) => lang.toLowerCase() === normalized)
  if (exact !== undefined) return exact
  const base = normalized.split('-')[0]
  return supported.find((lang) => lang.toLowerCase() === base) ?? fallback
}

/**
 * Room language for a newly created room, based on the browser locale.
 */
export function getBrowserRoomLanguage (fallback: RoomLanguage = defaultRoomLanguage): RoomLanguage {
  const locale = typeof navigator !== 'undefined' ? navigator.language : undefined
  return getRoomLanguageForLocale(locale, fallback)
}
