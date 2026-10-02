// SPDX-License-Identifier: EPL-2.0

const BEARER = 'bearer '

/**
 * Reads the raw bearer credential out of a set of request headers.
 *
 * Takes headers rather than a Request so it stays a pure function of its input
 * and is testable without constructing an Express object.
 *
 * `decodeToken` is deliberately not used here: it swallows the reason a token
 * failed, and the HTTP layer needs to tell "no credential" (401 plus
 * `WWW-Authenticate`) apart from "bad credential" (401) so clients can react.
 */
export function extractBearerToken (headers: { authorization?: string | string[] }): string | undefined {
  const header = headers.authorization
  if (typeof header !== 'string') return undefined

  const value = header.trim()
  if (value.toLowerCase().startsWith(BEARER)) {
    const token = value.slice(BEARER.length).trim()
    return token.length > 0 ? token : undefined
  }

  return undefined
}
