// SPDX-License-Identifier: EPL-2.0

import ipaddr from 'ipaddr.js'
import { type SafeFetchOptions } from './safe-fetch-types'

type Address = ipaddr.IPv4 | ipaddr.IPv6
type Range = [Address, number]

/** IPv4 ranges that are never reachable from user-supplied URLs unless allowlisted. */
export const BLOCKED_IPV4_RANGES: readonly string[] = [
  '0.0.0.0/8', // "this" network
  '10.0.0.0/8', // private
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, cloud metadata endpoints
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // documentation
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // documentation
  '203.0.113.0/24', // documentation
  '224.0.0.0/4', // multicast
  '240.0.0.0/4' // reserved, includes broadcast
]

/** IPv6 ranges that are never reachable from user-supplied URLs unless allowlisted. */
export const BLOCKED_IPV6_RANGES: readonly string[] = [
  '::/128', // unspecified
  '::1/128', // loopback
  '64:ff9b::/96', // NAT64 well-known prefix, blocked as a whole
  '64:ff9b:1::/48', // NAT64 local-use prefix (RFC 8215), blocked as a whole
  '2001::/32', // Teredo, blocked as a whole
  '2002::/16', // 6to4, blocked as a whole
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  'fec0::/10', // site-local (deprecated)
  'ff00::/8' // multicast
]

const builtinRanges: Range[] = [...BLOCKED_IPV4_RANGES, ...BLOCKED_IPV6_RANGES].map((cidr) => ipaddr.parseCIDR(cidr))

const extraRangeCache = new WeakMap<string[], Range[]>()

function parseRanges (cidrs: string[] | undefined): Range[] {
  if (cidrs === undefined || cidrs.length === 0) return []
  const cached = extraRangeCache.get(cidrs)
  if (cached !== undefined) return cached
  const parsed: Range[] = []
  for (const cidr of cidrs) {
    parsed.push(ipaddr.parseCIDR(cidr.trim()))
  }
  extraRangeCache.set(cidrs, parsed)
  return parsed
}

function matchesAny (addr: Address, ranges: Range[]): boolean {
  for (const range of ranges) {
    if (range[0].kind() === addr.kind() && addr.match(range)) return true
  }
  return false
}

function ipv4FromParts (hi: number, lo: number): ipaddr.IPv4 {
  return new ipaddr.IPv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff])
}

/**
 * Returns the IPv4 address embedded in the deprecated IPv4-compatible form ::a.b.c.d or in the
 * IPv4-translated form ::ffff:0:a.b.c.d (RFC 2765), if any. The IPv4-mapped form ::ffff:a.b.c.d is
 * handled by ipaddr.js itself. NAT64, 6to4 and Teredo prefixes are blocked wholesale instead, see
 * BLOCKED_IPV6_RANGES.
 */
function embeddedIpv4 (addr: ipaddr.IPv6): ipaddr.IPv4 | undefined {
  const parts = addr.parts
  const fourZero = parts[0] === 0 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0
  if (fourZero && parts[4] === 0 && parts[5] === 0 && (parts[6] !== 0 || parts[7] > 1)) {
    return ipv4FromParts(parts[6], parts[7])
  }
  if (fourZero && parts[4] === 0xffff && parts[5] === 0) {
    return ipv4FromParts(parts[6], parts[7])
  }
  return undefined
}

function isBlocked (addr: Address, extra: Range[]): boolean {
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6
    if (v6.isIPv4MappedAddress()) return isBlocked(v6.toIPv4Address(), extra)
    const embedded = embeddedIpv4(v6)
    if (embedded !== undefined && isBlocked(embedded, extra)) return true
  }
  return matchesAny(addr, builtinRanges) || matchesAny(addr, extra)
}

function parseAddress (address: string): Address | undefined {
  let value = address.trim()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  // Strip an IPv6 zone index such as %en0
  const zone = value.indexOf('%')
  if (zone !== -1) value = value.slice(0, zone)
  try {
    return ipaddr.parse(value)
  } catch {
    return undefined
  }
}

/** True when the allowlist names this address, either as a literal or through a CIDR range. */
export function isAllowlistedAddress (address: string, allowlist: string[] | undefined): boolean {
  if (allowlist === undefined || allowlist.length === 0) return false
  const addr = parseAddress(address)
  if (addr === undefined) return false
  for (const entry of allowlist) {
    const item = entry.trim()
    if (item.includes('/')) {
      try {
        const range = ipaddr.parseCIDR(item)
        if (range[0].kind() === addr.kind() && addr.match(range)) return true
      } catch {
        // Not a CIDR, fall through to hostname handling elsewhere
      }
      continue
    }
    const literal = parseAddress(item)
    if (literal !== undefined && literal.kind() === addr.kind() && literal.toString() === addr.toString()) return true
  }
  return false
}

/**
 * Checks allowlist and blockedRanges entries once, so an operator's typo fails at start-up rather than
 * on the first request. Allowlist entries may be hostnames, `*.suffix` wildcards, IP literals or CIDRs;
 * blockedRanges entries must be CIDRs.
 */
export function validateOptions (opts: SafeFetchOptions): void {
  for (const entry of opts.blockedRanges ?? []) {
    try {
      ipaddr.parseCIDR(entry.trim())
    } catch {
      throw new Error(`safe-fetch: invalid blockedRanges entry '${entry}', expected a CIDR such as 10.0.0.0/8`)
    }
  }
  for (const entry of opts.allowlist ?? []) {
    const item = entry.trim()
    if (item === '') {
      throw new Error('safe-fetch: empty allowlist entry')
    }
    if (item.includes('/')) {
      try {
        ipaddr.parseCIDR(item)
      } catch {
        throw new Error(`safe-fetch: invalid allowlist CIDR '${entry}'`)
      }
    }
  }
  // Warm the parse cache so the per-request path never parses user input again.
  parseRanges(opts.blockedRanges)
}

/**
 * True when the address must not be contacted. Unparseable input is treated as blocked.
 * Allowlisted addresses are never blocked.
 */
export function isBlockedAddress (address: string, opts: SafeFetchOptions = {}): boolean {
  const addr = parseAddress(address)
  if (addr === undefined) return true
  if (isAllowlistedAddress(address, opts.allowlist)) return false
  return isBlocked(addr, parseRanges(opts.blockedRanges))
}
