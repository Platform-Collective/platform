// SPDX-License-Identifier: EPL-2.0

import net from 'net'
import { isBlockedAddress } from './ranges'
import { SafeFetchError, type SafeFetchOptions } from './safe-fetch-types'

/** Lower-cases a hostname, strips IPv6 brackets and a trailing dot. */
export function normalizeHostname (hostname: string): string {
  let host = hostname.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host.endsWith('.')) host = host.slice(0, -1)
  return host
}

/** True when the allowlist names this hostname exactly or through a `*.suffix` wildcard. */
export function isAllowlistedHost (hostname: string, allowlist: string[] | undefined): boolean {
  if (allowlist === undefined || allowlist.length === 0) return false
  const host = normalizeHostname(hostname)
  for (const entry of allowlist) {
    const item = normalizeHostname(entry)
    if (item === '' || item.includes('/')) continue
    if (item.startsWith('*.')) {
      const suffix = item.slice(1)
      if (host.endsWith(suffix) && host.length > suffix.length) return true
      continue
    }
    if (item === host) return true
  }
  return false
}

/**
 * Parses and checks a URL before any network activity.
 * Rejects unsupported protocols, embedded credentials, localhost names and blocked IP literals.
 */
export function validateUrl (input: string | URL, opts: SafeFetchOptions = {}): URL {
  let url: URL
  try {
    url = new URL(typeof input === 'string' ? input : input.href)
  } catch {
    throw new SafeFetchError('INVALID_URL', `Invalid URL: ${String(input)}`)
  }
  const allowedProtocols = opts.allowHttp === true ? ['https:', 'http:'] : ['https:']
  if (!allowedProtocols.includes(url.protocol)) {
    throw new SafeFetchError('INVALID_PROTOCOL', `Protocol not allowed: ${url.protocol}`, url.href)
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError('INVALID_URL', 'Credentials in the URL are not allowed', url.href)
  }
  const host = normalizeHostname(url.hostname)
  if (host === '') {
    throw new SafeFetchError('INVALID_URL', 'URL has no host', url.href)
  }
  if (isAllowlistedHost(host, opts.allowlist)) {
    return url
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SafeFetchError('BLOCKED_HOST', `Host not allowed: ${host}`, url.href)
  }
  if (net.isIP(host) !== 0 && isBlockedAddress(host, opts)) {
    throw new SafeFetchError('BLOCKED_ADDRESS', `Address not allowed: ${host}`, url.href)
  }
  return url
}
