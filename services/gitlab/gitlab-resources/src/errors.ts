// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { getEmbeddedLabel, type IntlString, PlatformError, translate, unknownError } from '@hcengineering/platform'

/**
 * Human-readable text of an error for display. PlatformErrors, GitlabServiceError included, carry the GitLab
 * service's text in `status.params.message`; their own `message` is a serialized status.
 */
export function errorText (err: unknown): string {
  if (err instanceof PlatformError) {
    const message: unknown = err.status.params?.message
    if (typeof message === 'string' && message !== '') return message
  }
  if (err instanceof Error) return err.message
  return String(err)
}

/** A GitLab service refusal: a PlatformError (so errorText reads its message) that keeps the service's code. */
export class GitlabServiceError extends PlatformError<{ message: string }> {
  constructor (
    message: string,
    readonly code?: string
  ) {
    super(unknownError(message))
  }
}

// Sent by the GitLab service when the application cannot change while members are connected
export const APP_IN_USE_CODE = 'app-in-use'

export function isAppInUseError (err: unknown): boolean {
  return err instanceof GitlabServiceError && err.code === APP_IN_USE_CODE
}

/** An error with its own translated message, for failures the browser detects itself. */
export class GitlabError extends Error {
  constructor (readonly label: IntlString) {
    super(label)
  }
}

/** The label to show for an error: a GitlabError's translation, or the text of any other error. */
export function errorLabel (err: unknown): IntlString {
  return err instanceof GitlabError ? err.label : getEmbeddedLabel(errorText(err))
}

/** The text of an error in `language`: a GitlabError's translation, or errorText for any other error. */
export async function translateError (err: unknown, language?: string): Promise<string> {
  return err instanceof GitlabError ? await translate(err.label, {}, language) : errorText(err)
}

/** Reports an error to Analytics; a value that is not an Error is wrapped with its text. */
export function reportError (err: unknown): void {
  Analytics.handleError(err instanceof Error ? err : new Error(errorText(err)))
}
