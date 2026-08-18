//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

/**
 * blob: and data: URLs are already same-origin object URLs. Embedding them
 * in an iframe does not need another download, and the caller owns revoke.
 */
export function isLocalObjectUrl (src: string): boolean {
  return src.startsWith('blob:') || src.startsWith('data:')
}

/**
 * Non-credentialed Authorization header. Datalake accepts Bearer tokens this
 * way; default cors() allows the preflight. Do not use credentials:'include'
 * — the file server answers Access-Control-Allow-Origin: * without
 * Allow-Credentials, so a cookie-bearing cross-origin fetch is blocked.
 */
export function authorizationHeaders (token: string | undefined): HeadersInit {
  if (token === undefined || token === '') {
    return {}
  }
  return { Authorization: `Bearer ${token}` }
}

/**
 * Download a remote file (with optional Bearer token) and return a blob: URL
 * suitable for iframe embedding. Local object URLs are returned as-is.
 */
export async function fetchAsObjectUrl (
  src: string,
  token?: string,
  signal?: AbortSignal
): Promise<{ url: string, owned: boolean }> {
  if (isLocalObjectUrl(src)) {
    return { url: src, owned: false }
  }

  const response = await fetch(src, {
    headers: authorizationHeaders(token),
    signal
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`)
  }

  const blob = await response.blob()
  return { url: URL.createObjectURL(blob), owned: true }
}
