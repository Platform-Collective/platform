// SPDX-License-Identifier: EPL-2.0

import { concatLink } from '@hcengineering/core'
import { GitlabServiceError } from './errors'

export function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The URL of a GitLab service route; the same join as the GitHub service's requests. */
export function serviceUrl (base: string, path: string): string {
  return concatLink(concatLink(base, '/api/v1/'), path)
}

/** Parses a pod response; throws with the pod's `error` field, or `HTTP <status>` when the body is not a JSON object. */
export function parseServiceResponse (status: number, ok: boolean, text: string): Record<string, unknown> {
  let body: unknown
  if (text.trim() === '') {
    body = {}
  } else {
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
  }
  if (!ok) {
    const error = isRecord(body) ? body.error : undefined
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : undefined
    throw new GitlabServiceError(typeof error === 'string' && error !== '' ? error : `HTTP ${status}`, code)
  }
  if (!isRecord(body)) {
    throw new GitlabServiceError(`HTTP ${status}`)
  }
  return body
}
