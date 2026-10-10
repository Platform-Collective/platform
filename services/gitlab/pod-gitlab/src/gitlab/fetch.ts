// SPDX-License-Identifier: EPL-2.0

import type { HostGuard } from '../host-guard'
import type { FetchFn } from './api'

export interface SafeFetchOptions {
  // Unset: no host check (tests)
  guard?: Pick<HostGuard, 'assertAllowed' | 'assertRedirectAllowed'>
  // Per request, body and redirects included; a caller's own signal replaces it
  timeoutMs: number
}

// Redirects followed for a request that asks for them (upload downloads); the next one is refused
const MAX_REDIRECTS = 3

/** GitLab answered with a redirect; following it could reach a host the guard never saw. */
export class GitlabRedirectError extends Error {
  constructor (readonly status: number) {
    super(`GitLab answered with a redirect (HTTP ${status}); redirects are not followed`)
    this.name = 'GitlabRedirectError'
  }
}

function isRedirect (res: Response): boolean {
  return res.status >= 300 && res.status < 400
}

/**
 * The FetchFn of every GitLab call: an allowed host, no redirects followed, and a time limit.
 *
 * A request with an explicit `redirect: 'follow'` (upload downloads, which GitLab with object storage answers with a
 * redirect) follows at most MAX_REDIRECTS redirects by hand. A target on GitLab's own origin passes the usual host
 * check; any other target passes the guard's redirect check (https, public addresses), and the Authorization header
 * is dropped from then on.
 */
export function safeFetch (options: SafeFetchOptions, base: FetchFn = fetch): FetchFn {
  return (async (input: Parameters<FetchFn>[0], init?: RequestInit): Promise<Response> => {
    // A Request object is never passed by the pod; String() of one is not a URL, so the guard refuses it
    let url = String(input)
    await options.guard?.assertAllowed(url)
    const gitlabOrigin = URL.canParse(url) ? new URL(url).origin : undefined
    const follow = init?.redirect === 'follow'
    const signal = init?.signal ?? AbortSignal.timeout(options.timeoutMs)
    let headers = new Headers(init?.headers)
    for (let redirects = 0; ; redirects++) {
      const res = await base(url, { ...init, headers, redirect: 'manual', signal })
      if (!isRedirect(res)) return res
      await res.body?.cancel().catch(() => {})
      const location = res.headers.get('location')
      if (!follow || redirects >= MAX_REDIRECTS || location === null) {
        throw new GitlabRedirectError(res.status)
      }
      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw new GitlabRedirectError(res.status)
      }
      if (next.origin === gitlabOrigin) {
        // Back on GitLab itself, where GITLAB_ALLOWED_HOSTS applies
        await options.guard?.assertAllowed(next.href)
      } else {
        await options.guard?.assertRedirectAllowed(next.href)
        headers = new Headers(headers)
        headers.delete('authorization')
      }
      url = next.href
    }
  }) as FetchFn
}
