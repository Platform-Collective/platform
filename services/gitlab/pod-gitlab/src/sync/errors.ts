// SPDX-License-Identifier: EPL-2.0

import { GitlabApiError } from '../gitlab/api'

export function errorMessage (err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Errors a retry cannot fix: missing permission, missing object, rejected input. */
export function isPermanentError (err: unknown): boolean {
  return err instanceof GitlabApiError && [403, 404, 410, 422].includes(err.status)
}
