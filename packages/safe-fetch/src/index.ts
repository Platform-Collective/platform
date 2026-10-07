// SPDX-License-Identifier: EPL-2.0

export { createSafeFetch } from './fetch'
export { BLOCKED_IPV4_RANGES, BLOCKED_IPV6_RANGES, isAllowlistedAddress, isBlockedAddress } from './ranges'
export { defaultLookup, resolveAndCheck } from './resolve'
export {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  type Lookup,
  type ResolvedAddress,
  SafeFetchError,
  type SafeFetchErrorCode,
  type SafeFetchOptions
} from './safe-fetch-types'
export { isAllowlistedHost, normalizeHostname, validateUrl } from './safe-url'
