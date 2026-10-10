// SPDX-License-Identifier: EPL-2.0

/** What the integration card knows about loading its integration. */
export interface IntegrationCardLoad {
  // There is an integration (a GitLab user id) to show
  hasUser: boolean
  // The live query has answered at least once
  answered: boolean
  // The probe lookup failed; a live query never reports a failure itself, and its answer outranks the probe
  loadFailed: boolean
  // The `error` the loaded integration carries, if any
  integrationError?: string | null
}

export interface IntegrationCardState {
  isLoading: boolean
  hasError: boolean
}

/** A failed load shows the error instead of loading forever; a live query answer outranks a transient probe failure. */
export function integrationCardStateOf (load: IntegrationCardLoad): IntegrationCardState {
  if (!load.hasUser) return { isLoading: false, hasError: false }
  if (load.answered) return { isLoading: false, hasError: load.integrationError != null }
  if (load.loadFailed) return { isLoading: false, hasError: true }
  return { isLoading: true, hasError: false }
}
