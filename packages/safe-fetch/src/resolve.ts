// SPDX-License-Identifier: EPL-2.0

import dns from 'dns'
import net from 'net'
import { isBlockedAddress } from './ranges'
import { type Lookup, type ResolvedAddress, SafeFetchError, type SafeFetchOptions } from './safe-fetch-types'
import { isAllowlistedHost, normalizeHostname } from './safe-url'

/** Default resolver: every A and AAAA record in the order the resolver returns them. */
export const defaultLookup: Lookup = async (hostname) => {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true })
  return records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }))
}

/**
 * Resolves a hostname and checks every address against the blocked ranges.
 * Throws when any address is blocked, so a name that mixes public and private records is rejected.
 * The returned addresses are the only ones a connection may use.
 */
export async function resolveAndCheck (hostname: string, opts: SafeFetchOptions = {}): Promise<ResolvedAddress[]> {
  const host = normalizeHostname(hostname)
  const literal = net.isIP(host)
  if (literal !== 0) {
    if (isBlockedAddress(host, opts)) {
      throw new SafeFetchError('BLOCKED_ADDRESS', `Address not allowed: ${host}`)
    }
    return [{ address: host, family: literal === 6 ? 6 : 4 }]
  }

  const lookup = opts.lookup ?? defaultLookup
  let addresses: ResolvedAddress[]
  try {
    addresses = await lookup(host)
  } catch (err) {
    throw new SafeFetchError(
      'FETCH_FAILED',
      `Cannot resolve ${host}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (addresses.length === 0) {
    throw new SafeFetchError('FETCH_FAILED', `Cannot resolve ${host}: no addresses`)
  }
  if (isAllowlistedHost(host, opts.allowlist)) {
    return addresses
  }
  for (const a of addresses) {
    if (isBlockedAddress(a.address, opts)) {
      throw new SafeFetchError('BLOCKED_ADDRESS', `${host} resolves to a blocked address ${a.address}`)
    }
  }
  return addresses
}
