// SPDX-License-Identifier: EPL-2.0

/** One address a hostname resolved to. */
export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

/** Resolves a hostname to all of its addresses. Injectable so tests never touch real DNS. */
export type Lookup = (hostname: string) => Promise<ResolvedAddress[]>

export interface SafeFetchOptions {
  /** Allow plain http: URLs. Default false. */
  allowHttp?: boolean
  /**
   * Hostnames, IP literals or CIDR ranges that may be contacted even when they fall in a blocked range.
   * Hostnames match exactly or as a `*.suffix` wildcard. Intended for operator configuration only.
   */
  allowlist?: string[]
  /** Extra CIDR ranges to block in addition to the built-in list. */
  blockedRanges?: string[]
  /** Timeout for the whole request including redirects, in milliseconds. Default 30000. */
  timeoutMs?: number
  /** Maximum number of redirects followed when the caller uses redirect: 'follow'. Default 5. */
  maxRedirects?: number
  /** Maximum response body size in bytes. Default 10 MiB. */
  maxBodyBytes?: number
  /** DNS resolver override. Default uses dns.promises.lookup with all addresses. */
  lookup?: Lookup
}

export type SafeFetchErrorCode =
  | 'INVALID_URL'
  | 'INVALID_PROTOCOL'
  | 'BLOCKED_HOST'
  | 'BLOCKED_ADDRESS'
  | 'REDIRECT_NOT_ALLOWED'
  | 'TOO_MANY_REDIRECTS'
  | 'TIMEOUT'
  | 'BODY_TOO_LARGE'
  | 'FETCH_FAILED'

export class SafeFetchError extends Error {
  constructor (
    readonly code: SafeFetchErrorCode,
    message: string,
    readonly url?: string
  ) {
    super(message)
    this.name = 'SafeFetchError'
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_REDIRECTS = 5
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024
