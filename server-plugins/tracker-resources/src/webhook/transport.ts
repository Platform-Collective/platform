//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { lookup as dnsLookup, type LookupAddress } from 'dns'
import http from 'http'
import https from 'https'
import { isPublicAddress, parseIp } from '@hcengineering/tracker'

// How a delivery reaches the receiver, and the guard against server side request forgery (SSRF): a webhook URL is
// typed by a project member, so the server must never be made to call its own network.
//
//  - The host is resolved by this module, every address must be public, and the connection is made to the address
//    that was checked (the `lookup` of the socket is replaced), so a name that answers differently the second time
//    (DNS rebinding) gets no chance.
//  - An IP address in the URL is checked directly, since a socket does not resolve it.
//  - A redirect is not followed: the receiver answers or the delivery fails.
//  - The answer body is never read, only the status.

/** What is sent. */
export interface WebhookRequest {
  url: URL
  headers: Record<string, string>
  body: string
  timeoutMs: number
}

/** What comes back. */
export interface WebhookResponse {
  status: number
}

/**
 * Sends one request. It rejects when the request could not be made or timed out; a response with any status resolves.
 */
export type WebhookTransport = (request: WebhookRequest) => Promise<WebhookResponse>

/**
 * The target is not allowed; such a delivery is never retried.
 */
export class WebhookBlockedError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'WebhookBlockedError'
  }
}

/**
 * Development switch (`TRACKER_WEBHOOK_ALLOW_PRIVATE=true`): http, and targets on the local network, are allowed so a
 * receiver can run next to the server. Never set it in production.
 */
export function allowPrivateTargets (env: Record<string, string | undefined> = process.env): boolean {
  return env.TRACKER_WEBHOOK_ALLOW_PRIVATE === 'true'
}

type LookupAll = (hostname: string, options: { all: true }, cb: (err: Error | null, addresses: LookupAddress[]) => void) => void

/**
 * A `lookup` for a socket that only ever answers with public addresses. When any address of the name is not public the
 * lookup fails (a name with one private address among public ones is not trusted).
 */
export function createSafeLookup (
  allowPrivate: boolean,
  resolve: LookupAll = dnsLookup as unknown as LookupAll
): (hostname: string, options: any, callback: (...args: any[]) => void) => void {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true }, (err, addresses) => {
      if (err !== null && err !== undefined) {
        callback(err)
        return
      }
      if (addresses.length === 0) {
        callback(new WebhookBlockedError(`Host ${hostname} did not resolve`))
        return
      }
      if (!allowPrivate) {
        const bad = addresses.find((a) => !isPublicAddress(a.address))
        if (bad !== undefined) {
          callback(new WebhookBlockedError(`Host ${hostname} resolves to a non-public address`))
          return
        }
      }
      if (options?.all === true) callback(null, addresses)
      else callback(null, addresses[0].address, addresses[0].family)
    })
  }
}

/**
 * The transport of the server: Node's http(s) client with the guarded lookup.
 */
export function createNodeTransport (allowPrivate: boolean = allowPrivateTargets()): WebhookTransport {
  const lookup = createSafeLookup(allowPrivate)
  return async (request) =>
    await new Promise<WebhookResponse>((resolve, reject) => {
      const { url } = request
      const secure = url.protocol === 'https:'
      if (!secure && !(allowPrivate && url.protocol === 'http:')) {
        reject(new WebhookBlockedError('Only https targets are allowed'))
        return
      }
      const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
      if (!allowPrivate && parseIp(host) !== undefined && !isPublicAddress(host)) {
        reject(new WebhookBlockedError('The target is not a public address'))
        return
      }
      const module = secure ? https : http
      const req = module.request(
        {
          protocol: url.protocol,
          hostname: host,
          port: url.port !== '' ? Number(url.port) : undefined,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: { ...request.headers, 'Content-Length': String(Buffer.byteLength(request.body, 'utf8')) },
          lookup: lookup as any,
          signal: AbortSignal.timeout(request.timeoutMs)
        },
        (res) => {
          // Only the status counts, the body is dropped
          res.resume()
          resolve({ status: res.statusCode ?? 0 })
        }
      )
      req.on('error', reject)
      req.end(request.body)
    })
}
