//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Doc, Ref } from '@hcengineering/core'
import type { Project } from './index'

// Project webhooks, modelled after GitHub's `projects_v2_item` event. This file has what the settings UI and the
// server share: the stored docs, and the URL rules (the server adds the DNS check, see `isPublicAddress`).

/**
 * What happened to an item; the `action` of GitHub's `projects_v2_item` event (`converted` and `reordered` have no
 * counterpart here).
 * @public
 */
export type WebhookEvent = 'created' | 'edited' | 'archived' | 'restored' | 'deleted'

/** @public */
export const WEBHOOK_EVENTS: readonly WebhookEvent[] = ['created', 'edited', 'archived', 'restored', 'deleted']

/** Webhooks one project can have. @public */
export const MAX_PROJECT_WEBHOOKS = 20

/** Longest URL of a webhook. @public */
export const MAX_WEBHOOK_URL_LENGTH = 2048

/** Longest secret; the secret is any string, GitHub recommends a long random one. @public */
export const MAX_WEBHOOK_SECRET_LENGTH = 256

/**
 * A webhook of a project (`space`). The secret is not part of it: see `ProjectWebhookSecret`.
 * @public
 */
export interface ProjectWebhook extends Doc {
  space: Ref<Project>
  url: string
  enabled: boolean
  // Events that are delivered; an empty list delivers nothing
  events: WebhookEvent[]
  // Whether a secret exists, so that deliveries are signed. The secret itself is never part of this doc.
  hasSecret: boolean
  description?: string
}

/**
 * The secret of a webhook. It is created in the *personal space* of the person who set it, so no other member of the
 * project can read it, and the settings UI never shows it again after it was typed. The server reads it to sign
 * deliveries (the newest one of a webhook counts, so setting a new secret rotates it).
 * @public
 */
export interface ProjectWebhookSecret extends Doc {
  webhook: Ref<ProjectWebhook>
  secret: string
}

/**
 * Keeps the known events once each, in the order of `WEBHOOK_EVENTS`.
 * @public
 */
export function normalizeWebhookEvents (events: unknown): WebhookEvent[] {
  if (!Array.isArray(events)) return []
  return WEBHOOK_EVENTS.filter((e) => events.includes(e))
}

// ---- URL rules ----

/**
 * @public
 */
export type WebhookUrlError = 'empty' | 'tooLong' | 'invalid' | 'protocol' | 'credentials' | 'host' | 'address'

/**
 * @public
 */
export type WebhookUrlResult = { ok: true, url: URL } | { ok: false, error: WebhookUrlError }

/**
 * @public
 */
export interface WebhookUrlOptions {
  // Development: allow http and private / loopback targets
  allowInsecure?: boolean
}

// Names that only make sense inside a network. The DNS check on the server is what decides, this catches the obvious
// ones early (and in the form).
const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.localdomain']

function isInternalHostname (host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return h === 'localhost' || h === '' || !h.includes('.') || INTERNAL_SUFFIXES.some((s) => h.endsWith(s))
}

/**
 * Checks the syntax of a webhook URL: https only (http when `allowInsecure`), no credentials in the URL, a host that
 * is not obviously internal and, for an IP address, one that is public. The names still have to be resolved and
 * checked on the server.
 * @public
 */
export function validateWebhookUrl (raw: string, options: WebhookUrlOptions = {}): WebhookUrlResult {
  const text = raw.trim()
  if (text === '') return { ok: false, error: 'empty' }
  if (text.length > MAX_WEBHOOK_URL_LENGTH) return { ok: false, error: 'tooLong' }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, error: 'invalid' }
  }
  const insecure = options.allowInsecure === true
  if (url.protocol !== 'https:' && !(insecure && url.protocol === 'http:')) return { ok: false, error: 'protocol' }
  if (url.username !== '' || url.password !== '') return { ok: false, error: 'credentials' }
  if (insecure) return { ok: true, url }
  const host = url.hostname
  const ip = parseIp(host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host)
  if (ip !== undefined) return isPublicAddress(host) ? { ok: true, url } : { ok: false, error: 'address' }
  if (isInternalHostname(host)) return { ok: false, error: 'host' }
  return { ok: true, url }
}

// ---- addresses ----

/**
 * @public
 */
export type ParsedIp = { version: 4, bytes: number[] } | { version: 6, groups: number[] }

function parseIpv4 (text: string): number[] | undefined {
  const parts = text.split('.')
  if (parts.length !== 4) return undefined
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return undefined
    const n = Number(part)
    if (n > 255) return undefined
    bytes.push(n)
  }
  return bytes
}

function parseIpv6 (input: string): number[] | undefined {
  let text = input
  // The zone id (`fe80::1%eth0`) is never part of a public address
  if (text.includes('%')) return undefined
  // An embedded IPv4 tail takes the place of the last two groups
  const lastColon = text.lastIndexOf(':')
  if (lastColon !== -1 && text.includes('.', lastColon)) {
    const v4 = parseIpv4(text.slice(lastColon + 1))
    if (v4 === undefined) return undefined
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return undefined
  const toGroups = (part: string): number[] | undefined => {
    if (part === '') return []
    const groups: number[] = []
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return undefined
      groups.push(parseInt(g, 16))
    }
    return groups
  }
  const head = toGroups(halves[0])
  if (head === undefined) return undefined
  if (halves.length === 1) return head.length === 8 ? head : undefined
  const tail = toGroups(halves[1])
  if (tail === undefined) return undefined
  const missing = 8 - head.length - tail.length
  if (missing < 1) return undefined
  return [...head, ...new Array<number>(missing).fill(0), ...tail]
}

/**
 * Parses an IPv4 (dotted decimal, no shortcuts) or IPv6 address (brackets not included); undefined for anything else.
 * @public
 */
export function parseIp (text: string): ParsedIp | undefined {
  const v4 = parseIpv4(text)
  if (v4 !== undefined) return { version: 4, bytes: v4 }
  if (!text.includes(':')) return undefined
  const v6 = parseIpv6(text)
  return v6 !== undefined ? { version: 6, groups: v6 } : undefined
}

function isPublicIpv4 (b: readonly number[]): boolean {
  const [a, c, d] = b
  if (a === 0 || a === 10 || a === 127) return false // this network, private, loopback
  if (a === 100 && c >= 64 && c <= 127) return false // carrier grade NAT
  if (a === 169 && c === 254) return false // link local, cloud metadata
  if (a === 172 && c >= 16 && c <= 31) return false // private
  if (a === 192 && c === 0 && (d === 0 || d === 2)) return false // protocol assignments, documentation
  if (a === 192 && c === 88 && d === 99) return false // 6to4 relay
  if (a === 192 && c === 168) return false // private
  if (a === 198 && (c === 18 || c === 19)) return false // benchmarking
  if (a === 198 && c === 51 && d === 100) return false // documentation
  if (a === 203 && c === 0 && d === 113) return false // documentation
  if (a >= 224) return false // multicast, reserved, broadcast
  return true
}

function ipv4FromGroups (hi: number, lo: number): number[] {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255]
}

function isPublicIpv6 (g: readonly number[]): boolean {
  const allZeroUntil = (n: number): boolean => g.slice(0, n).every((x) => x === 0)
  if (allZeroUntil(7) && (g[7] === 0 || g[7] === 1)) return false // :: and ::1
  // IPv4 mapped (::ffff:a.b.c.d) and the deprecated IPv4 compatible (::a.b.c.d) addresses are judged by the IPv4 part
  if (allZeroUntil(5) && (g[5] === 0xffff || g[5] === 0)) return isPublicIpv4(ipv4FromGroups(g[6], g[7]))
  // NAT64 well-known prefix 64:ff9b::/96 and the local-use prefix 64:ff9b:1::/48
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return false
    if (g.slice(2, 6).every((x) => x === 0)) return isPublicIpv4(ipv4FromGroups(g[6], g[7]))
  }
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false // discard prefix
  if (g[0] === 0x2001 && g[1] === 0) return false // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false // documentation
  if (g[0] === 0x2002) return isPublicIpv4(ipv4FromGroups(g[1], g[2])) // 6to4: judged by the embedded IPv4
  if ((g[0] & 0xfe00) === 0xfc00) return false // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false // link local
  if ((g[0] & 0xffc0) === 0xfec0) return false // site local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false // multicast
  // Only global unicast 2000::/3 is assigned to the internet
  return (g[0] & 0xe000) === 0x2000
}

/**
 * Whether an address may be the target of a webhook: a public unicast address. Loopback, private, link local (the
 * cloud metadata address 169.254.169.254 among them), carrier grade NAT, documentation, multicast and reserved
 * ranges are not, and neither is anything that is not an IP address (fail closed). IPv6 addresses that embed an
 * IPv4 address (mapped, NAT64, 6to4) are judged by it. A host written with brackets (`[::1]`) is accepted.
 * @public
 */
export function isPublicAddress (address: string): boolean {
  const text = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
  const ip = parseIp(text)
  if (ip === undefined) return false
  return ip.version === 4 ? isPublicIpv4(ip.bytes) : isPublicIpv6(ip.groups)
}
