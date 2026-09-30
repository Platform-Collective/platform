/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

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
