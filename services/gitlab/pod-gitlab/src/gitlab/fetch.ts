// SPDX-License-Identifier: EPL-2.0

import {
  BLOCKED_IPV4_RANGES,
  BLOCKED_IPV6_RANGES,
  createSafeFetch,
  normalizeHostname,
  resolveAndCheck,
  SafeFetchError,
  type SafeFetchOptions,
  validateUrl
} from '@hcengineering/safe-fetch'
import type { FetchFn } from './api'

export interface GitlabHostPolicy {
  // Dev only (GITLAB_ALLOW_INSECURE_HOSTS): plain http and private addresses
  allowInsecure: boolean
  // GITLAB_ALLOWED_HOSTS, normalized host names (parseAllowedHosts): when not empty, the only GitLab hosts accepted, private ones included
  allowedHosts: string[]
}

// Redirects followed for a request that asks for them (upload downloads)
export const MAX_REDIRECTS = 3
// Merge request diffs can be large; uploads have their own, lower limit (MAX_IMAGE_BYTES)
export const MAX_BODY_BYTES = 100 * 1024 * 1024

/**
 * The safe-fetch host options of a policy. safe-fetch's allowlist only grants exceptions to the blocked ranges:
 * GITLAB_ALLOWED_HOSTS may be private, and dev mode allows every private range and localhost.
 */
function hostOptions (policy: GitlabHostPolicy): Pick<SafeFetchOptions, 'allowHttp' | 'allowlist'> {
  return {
    allowHttp: policy.allowInsecure,
    allowlist: policy.allowInsecure
      ? [...BLOCKED_IPV4_RANGES, ...BLOCKED_IPV6_RANGES, 'localhost', '*.localhost', ...policy.allowedHosts]
      : policy.allowedHosts
  }
}

/** safe-fetch options of every GitLab call for a host policy. */
export function gitlabSafeFetchOptions (policy: GitlabHostPolicy, timeoutMs: number): SafeFetchOptions {
  return { ...hostOptions(policy), timeoutMs, maxRedirects: MAX_REDIRECTS, maxBodyBytes: MAX_BODY_BYTES }
}

/** The normalized host name of a GitLab URL; throws INVALID_URL for anything that is not a URL. */
function gitlabHostname (url: string): string {
  try {
    return normalizeHostname(new URL(url).hostname)
  } catch {
    // The input may hold credentials: never echo it
    throw new SafeFetchError('INVALID_URL', 'Invalid GitLab URL')
  }
}

/** With GITLAB_ALLOWED_HOSTS, throws BLOCKED_HOST for any other GitLab host. */
function assertListed (host: string, policy: GitlabHostPolicy): void {
  if (policy.allowedHosts.length > 0 && !policy.allowedHosts.includes(host)) {
    throw new SafeFetchError('BLOCKED_HOST', `GitLab host ${host} is not allowed`)
  }
}

/**
 * Throws SafeFetchError unless the pod may call the GitLab host of `url`: checked before a host is saved, since the
 * pod calls it with server credentials. Every refusal has the same message, naming the host only: safe-fetch's own
 * name resolved addresses, and telling a blocked address from an unknown host would let the caller probe internal
 * DNS. `lookup` is a test seam.
 */
export async function assertGitlabHostAllowed (
  url: string,
  policy: GitlabHostPolicy,
  lookup?: SafeFetchOptions['lookup']
): Promise<void> {
  const host = gitlabHostname(url)
  assertListed(host, policy)
  const options = { ...hostOptions(policy), lookup }
  try {
    await resolveAndCheck(validateUrl(url, options).hostname, options)
  } catch (err) {
    if (!(err instanceof SafeFetchError)) throw err
    const message = host === '' ? 'Invalid GitLab URL' : `GitLab host ${host} is not allowed`
    throw new SafeFetchError(err.code, message)
  }
}

/**
 * The same error with a message that names the GitLab host only, and without `url`: safe-fetch's messages name
 * resolved addresses and redirect targets, and its `url` may be a signed object-store link. These errors reach the
 * caller's HTTP response and the sync errors members see.
 */
function withoutDetails (err: unknown, host: string): unknown {
  if (!(err instanceof SafeFetchError)) return err
  switch (err.code) {
    case 'INVALID_URL':
    case 'INVALID_PROTOCOL':
    case 'BLOCKED_HOST':
    case 'BLOCKED_ADDRESS':
      return new SafeFetchError(err.code, `GitLab host ${host}, or a host it redirected to, is not allowed`)
    case 'REDIRECT_NOT_ALLOWED':
      return new SafeFetchError(err.code, `GitLab host ${host} answered with a redirect; redirects are not followed`)
    case 'FETCH_FAILED':
      // The network error may name the address the host resolved to
      return new SafeFetchError(err.code, `Request to GitLab host ${host} failed`)
    default:
      // Timeouts, size limits and redirect counts name no address
      return new SafeFetchError(err.code, err.message)
  }
}

/**
 * The FetchFn of every GitLab call. GITLAB_ALLOWED_HOSTS applies to the GitLab host itself; each redirect hop of an
 * upload download (`redirect: 'follow'`, e.g. to an object store) passes safe-fetch's own checks, and the
 * Authorization header is dropped when it leaves GitLab's origin. A request without an explicit redirect mode never
 * follows one.
 */
export function createGitlabFetch (
  policy: GitlabHostPolicy,
  timeoutMs: number,
  // Test seam: a fetch with other safe-fetch options
  safeFetch: FetchFn = createSafeFetch(gitlabSafeFetchOptions(policy, timeoutMs))
): FetchFn {
  return async (input: Parameters<FetchFn>[0], init?: RequestInit): Promise<Response> => {
    const host = gitlabHostname(String(input))
    assertListed(host, policy)
    try {
      return await safeFetch(input, { ...init, redirect: init?.redirect ?? 'error' })
    } catch (err) {
      throw withoutDetails(err, host)
    }
  }
}
