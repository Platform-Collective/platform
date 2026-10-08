// SPDX-License-Identifier: EPL-2.0

import { PlatformError } from '@hcengineering/platform'

/**
 * Human-readable text of an error for display. sendGLServiceRequest wraps pod errors as
 * PlatformError(unknownError(message)), whose own `message` is a serialized status, so the
 * status `message` param is preferred.
 */
export function errorText (err: unknown): string {
  if (err instanceof PlatformError) {
    const message: unknown = err.status.params?.message
    if (typeof message === 'string' && message !== '') return message
  }
  if (err instanceof Error) return err.message
  return String(err)
}

// Prefix of the pod refusal while members are connected (GitlabService.assertNoConnections).
export const APP_IN_USE_PREFIX = 'Disconnect GitLab before changing the application'

export function isAppInUseError (err: unknown): boolean {
  return errorText(err).startsWith(APP_IN_USE_PREFIX)
}
