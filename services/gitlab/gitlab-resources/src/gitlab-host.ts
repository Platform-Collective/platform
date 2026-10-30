// SPDX-License-Identifier: EPL-2.0

export const GITLAB_COM = 'https://gitlab.com'

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|.+\.local)$/

export function trimTrailingSlashes (value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Client-side mirror of the pod's GitLab URL rules, for inline feedback only (the pod stays authoritative):
 * `https://…`, or `http://` for localhost, 127.0.0.1 and `*.local`; a sub-path is allowed; no query, fragment or credentials.
 */
export function isValidHostInput (raw: string): boolean {
  const value = trimTrailingSlashes(raw.trim())
  if (value === '' || value.includes('?') || value.includes('#')) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const httpAllowed = url.protocol === 'http:' && LOCAL_HOST.test(url.hostname)
  return (url.protocol === 'https:' || httpAllowed) && url.username === '' && url.password === ''
}

export interface ApplicationLinks {
  user: string
  admin: string
  groupHint: string
}

/** GitLab pages where an OAuth application can be registered, under the given (possibly sub-path) host. */
export function applicationLinks (host: string): ApplicationLinks {
  const base = trimTrailingSlashes(host.trim())
  return {
    user: `${base}/-/user_settings/applications`,
    admin: `${base}/admin/applications`,
    groupHint: `${base}/groups/<your-group>/-/settings/applications`
  }
}
