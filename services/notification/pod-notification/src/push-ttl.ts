// SPDX-License-Identifier: EPL-2.0

/**
 * How long (in seconds) the push service keeps an undelivered notification.
 * Without an explicit TTL web-push uses four weeks, so a device that was offline for a while
 * receives every stale notification at once when it comes back online.
 */
export const DEFAULT_PUSH_TTL_SECONDS = 5 * 60

export function parsePushTtl (value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PUSH_TTL_SECONDS
  const ttl = Number(value)
  if (Number.isInteger(ttl) && ttl >= 0) return ttl

  console.warn('Invalid PUSH_TTL; using default TTL', { value, defaultTtl: DEFAULT_PUSH_TTL_SECONDS })
  return DEFAULT_PUSH_TTL_SECONDS
}
