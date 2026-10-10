// SPDX-License-Identifier: EPL-2.0

import { GitlabApiError } from '../gitlab/api'

/** The one text for a connection whose GitLab token is gone: integration health, routes and sync docs. */
export const EXPIRED_ERROR = 'GitLab authorization expired, please re-authorize'

export function errorMessage (err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The error itself, or an Error carrying its text (for Analytics.handleError). */
export function toError (err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/** Errors a retry cannot fix: missing permission, missing object, rejected input. */
export function isPermanentError (err: unknown): boolean {
  return err instanceof GitlabApiError && [403, 404, 410, 422].includes(err.status)
}
