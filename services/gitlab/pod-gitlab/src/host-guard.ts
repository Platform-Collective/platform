// SPDX-License-Identifier: EPL-2.0

import { lookup as dnsLookup } from 'dns/promises'
import { BlockList, isIP } from 'net'

/** A GitLab host the pod refuses to call. */
export class GitlabHostRefusedError extends Error {
  constructor (readonly host: string) {
    super(`GitLab host ${host} is not allowed`)
    this.name = 'GitlabHostRefusedError'
  }
}

export interface HostPolicy {
  // Dev only (GITLAB_ALLOW_INSECURE_HOSTS): any host, private addresses included
  allowInsecure: boolean
  // GITLAB_ALLOWED_HOSTS, lower-case host names: when not empty, the only hosts accepted, private ones included
  allowedHosts: string[]
}

export type LookupFn = (hostname: string) => Promise<Array<{ address: string, family: number }>>

const defaultLookup: LookupFn = async (hostname) => await dnsLookup(hostname, { all: true, verbatim: true })

// A resolution is trusted this long; GitLab calls come in bursts
const CACHE_MS = 60 * 1000
const MAX_CACHED_HOSTS = 1000

const BLOCKED = new BlockList()
// IPv4: this network, private, CGNAT, loopback, link-local, IETF protocol, TEST-NETs, benchmarking, multicast, reserved
const IPV4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]
// IPv6: unspecified, loopback, NAT64 (well-known and local-use), discard, unique local, link-local, site-local, multicast
const IPV6_BLOCKED: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8]
]
for (const [network, prefix] of IPV4_BLOCKED) BLOCKED.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of IPV6_BLOCKED) BLOCKED.addSubnet(network, prefix, 'ipv6')

// The eight 16-bit groups of a valid IPv6 address (zone already removed)
function ipv6Groups (address: string): number[] | undefined {
  let text = address.toLowerCase()
  // A trailing dotted IPv4 part becomes two groups
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (dotted !== null) {
    const [a, b, c, d] = dotted.slice(1).map(Number)
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] === '' ? [] : halves[0].split(':')
  const right = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0
  if (fill < 0) return undefined
  const groups = [...left, ...new Array<string>(fill).fill('0'), ...right].map((it) => parseInt(it, 16))
  return groups.length === 8 && groups.every((it) => Number.isInteger(it) && it >= 0 && it <= 0xffff)
    ? groups
    : undefined
}

function ipv4Of (high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

/**
 * The IPv4 address an IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), SIIT IPv4-translated
 * (::ffff:0:a.b.c.d), 6to4 (2002:AABB:CCDD::) or Teredo (2001:0::/32, client address inverted) address carries.
 */
function embeddedIpv4 (groups: number[]): string | undefined {
  if (groups.slice(0, 5).every((it) => it === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    // '::' and '::1' are not IPv4-compatible: BlockList handles them
    if (groups[5] === 0 && groups[6] === 0) return undefined
    return ipv4Of(groups[6], groups[7])
  }
  if (groups.slice(0, 4).every((it) => it === 0) && groups[4] === 0xffff && groups[5] === 0) {
    return ipv4Of(groups[6], groups[7])
  }
  if (groups[0] === 0x2002) return ipv4Of(groups[1], groups[2])
  if (groups[0] === 0x2001 && groups[1] === 0) return ipv4Of(groups[6] ^ 0xffff, groups[7] ^ 0xffff)
  return undefined
}

/**
 * False for loopback, private, link-local and other non-public addresses, IPv4 inside IPv6 included.
 * Independent of any host policy: also usable on its own, e.g. for addresses reached through redirects.
 */
export function isPublicAddress (address: string): boolean {
  const bare = address.split('%')[0]
  const family = isIP(bare)
  if (family === 4) return !BLOCKED.check(bare, 'ipv4')
  if (family !== 6) return false
  const groups = ipv6Groups(bare)
  if (groups === undefined) return false
  const embedded = embeddedIpv4(groups)
  if (embedded !== undefined) return isPublicAddress(embedded)
  return !BLOCKED.check(bare, 'ipv6')
}

/**
 * Decides which GitLab hosts the pod may call: by default, hosts whose every address is public; with
 * GITLAB_ALLOWED_HOSTS, exactly the listed hosts; in dev mode (GITLAB_ALLOW_INSECURE_HOSTS), any host.
 */
export class HostGuard {
  private readonly checked = new Map<string, number>()

  constructor (
    private readonly policy: HostPolicy,
    private readonly lookup: LookupFn = defaultLookup,
    private readonly now: () => number = Date.now
  ) {}

  /** Throws GitlabHostRefusedError unless the pod may call the host of `url`. */
  async assertAllowed (url: string): Promise<void> {
    let hostname: string
    try {
      hostname = new URL(url).hostname.toLowerCase()
    } catch {
      // The input may hold credentials: never echo it
      throw new GitlabHostRefusedError('(invalid URL)')
    }
    if (!(await this.allowed(hostname))) throw new GitlabHostRefusedError(hostname)
  }

  /**
   * Throws GitlabHostRefusedError unless the pod may follow a redirect from GitLab to `url` (an upload's object store):
   * https, and every address public. GITLAB_ALLOWED_HOSTS trusts GitLab hosts only, so it does not apply here; dev
   * mode (GITLAB_ALLOW_INSECURE_HOSTS) skips the address check, never the scheme check: it accepts http and https.
   */
  async assertRedirectAllowed (url: string): Promise<void> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new GitlabHostRefusedError('(invalid URL)')
    }
    const hostname = parsed.hostname.toLowerCase()
    // Dev mode skips the address check, never the scheme: a redirect is fetched, so only http(s) may follow
    if (parsed.protocol !== 'https:' && !(this.policy.allowInsecure && parsed.protocol === 'http:')) {
      throw new GitlabHostRefusedError(hostname === '' ? parsed.protocol : hostname)
    }
    if (this.policy.allowInsecure) return
    if (!(await this.isPublicHost(hostname))) {
      throw new GitlabHostRefusedError(hostname)
    }
  }

  private async allowed (hostname: string): Promise<boolean> {
    if (this.policy.allowedHosts.length > 0) return this.policy.allowedHosts.includes(hostname)
    if (this.policy.allowInsecure) return true
    return await this.isPublicHost(hostname)
  }

  // Cached: an entry always means "every address public"
  private async isPublicHost (hostname: string): Promise<boolean> {
    const now = this.now()
    if ((this.checked.get(hostname) ?? 0) > now) return true
    const allowed = await this.resolvesPublic(hostname)
    if (allowed) {
      if (this.checked.size >= MAX_CACHED_HOSTS) this.checked.clear()
      this.checked.set(hostname, now + CACHE_MS)
    }
    return allowed
  }

  private async resolvesPublic (hostname: string): Promise<boolean> {
    // URL keeps IPv6 literals in brackets
    const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
    if (isIP(literal) !== 0) return isPublicAddress(literal)
    let addresses: Array<{ address: string }>
    try {
      addresses = await this.lookup(literal)
    } catch {
      return false
    }
    return addresses.length > 0 && addresses.every((it) => isPublicAddress(it.address))
  }
}
