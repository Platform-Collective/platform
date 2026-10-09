// SPDX-License-Identifier: EPL-2.0

export interface ThreadExpansion {
  expanded: boolean
  // The resolved state the expansion was last set for
  resolved: boolean
}

/** The thread panel follows resolve and reopen, here or elsewhere; a click in between keeps its choice. */
export function expansionAfter (state: ThreadExpansion, resolved: boolean): ThreadExpansion {
  return resolved === state.resolved ? state : { expanded: !resolved, resolved }
}
