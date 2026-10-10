// SPDX-License-Identifier: EPL-2.0

import { errorMessage } from './sync/errors'

/** An error a route answers with its own HTTP status; `code` is a stable reason for the UI to match on. */
export class HttpError extends Error {
  constructor (
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** The application cannot change or go while members are connected (409). */
export const APP_IN_USE = 'app-in-use'

export interface ErrorBody {
  error: string
  code?: string
}

/** Status and body of a failed route: an HttpError keeps its status and code; anything else is a 400. */
export function errorResponse (err: unknown): { status: number, body: ErrorBody } {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: err.code === undefined ? { error: err.message } : { error: err.message, code: err.code }
    }
  }
  return { status: 400, body: { error: errorMessage(err) } }
}
