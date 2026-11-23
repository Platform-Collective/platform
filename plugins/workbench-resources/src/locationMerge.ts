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

import type { Location, ResolvedLocation } from '@hcengineering/ui'

export interface CurrentWorkbenchState {
  currentAppAlias: string | undefined
  currentSpace: string | undefined
  currentSpecial: string | undefined
  currentQuery: Record<string, string | null> | undefined
}

/**
 * Merges a location produced by an application location resolver (short link) into the location the
 * workbench currently shows.
 * @public
 */
export function mergeResolvedLocation (
  loc: Location,
  resolved: ResolvedLocation,
  state: CurrentWorkbenchState
): Location {
  const { currentAppAlias, currentSpace, currentSpecial, currentQuery } = state
  const resolvedApp = resolved.loc.path[2]
  const resolvedSpace = resolved.loc.path[3]
  const resolvedSpecial = resolved.loc.path[4]
  if (resolvedApp === undefined) {
    if (currentAppAlias === undefined) {
      loc.path = [loc.path[0], loc.path[1], ...resolved.defaultLocation.path.slice(2)]
    } else {
      const isSameApp = currentAppAlias === loc.path[2]
      loc.path[2] = currentAppAlias ?? resolved.defaultLocation.path[2]
      loc.path[3] = currentSpace ?? currentSpecial ?? resolved.defaultLocation.path[3]
      if (loc.path[3] !== undefined && isSameApp) {
        // setting space special/aside only if it belongs to the same app
        if (currentSpace) {
          loc.path[4] = currentSpecial ?? resolved.defaultLocation.path[4]
        } else if (currentSpecial) {
          loc.path[4] = resolved.defaultLocation.path[4]
        }
      } else if (loc.path[3] !== undefined && currentSpace && currentSpecial) {
        // The resolved location is only a panel opened over the current application (for example a card
        // referenced from an issue). Keep the current space special, otherwise closing the panel would
        // restore a location without it and leave the main area empty.
        loc.path[4] = currentSpecial
        loc.path.length = 5
      } else {
        loc.path.length = 4
      }
    }
  } else {
    loc.path[2] = resolvedApp
    if (resolvedSpace === undefined) {
      loc.path[3] = currentSpace ?? currentSpecial ?? resolved.defaultLocation.path[3]
      loc.path[4] = currentSpecial ?? resolved.defaultLocation.path[4]
    } else {
      loc.path[3] = resolvedSpace
      if (resolvedSpecial) {
        loc.path[4] = resolvedSpecial
      } else if (currentSpace) {
        loc.path[4] = currentSpecial ?? resolved.defaultLocation.path[4]
      } else if (currentSpecial) {
        loc.path[4] = resolved.defaultLocation.path[4]
      } else {
        loc.path.length = 4
      }
    }
  }
  for (let index = 0; index < loc.path.length; index++) {
    const path = loc.path[index]
    if (path === undefined) {
      loc.path.length = index
      break
    }
  }
  loc.query = resolved.loc.query ?? loc.query ?? currentQuery ?? resolved.defaultLocation.query
  loc.fragment =
    (loc.fragment ?? '') !== '' && resolved.loc.fragment === resolved.defaultLocation.fragment
      ? loc.fragment
      : (resolved.loc.fragment ?? resolved.defaultLocation.fragment)
  return loc
}
