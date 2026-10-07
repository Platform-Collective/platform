// SPDX-License-Identifier: EPL-2.0

import type dns from 'dns'
import type net from 'net'
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici'
import { resolveAndCheck } from './resolve'
import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  type ResolvedAddress,
  SafeFetchError,
  type SafeFetchOptions
} from './safe-fetch-types'
import { normalizeHostname, validateUrl } from './safe-url'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void

/**
 * Returns the only addresses a connection may use for a hostname. Filled by safeFetch right before each
 * request, so the socket cannot be opened to an address that was never checked (DNS rebinding).
 */
class PinnedAddresses {
  private readonly pinned = new Map<string, ResolvedAddress[]>()

  set (hostname: string, addresses: ResolvedAddress[]): void {
    this.pinned.set(normalizeHostname(hostname), addresses)
  }

  readonly lookup: net.LookupFunction = (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    const addresses = this.pinned.get(normalizeHostname(hostname)) ?? []
    const family = typeof options.family === 'number' ? options.family : undefined
    const matching = family === 4 || family === 6 ? addresses.filter((a) => a.family === family) : addresses
    if (matching.length === 0) {
      const err: NodeJS.ErrnoException = new Error(`safe-fetch: no checked address for ${hostname}`)
      err.code = 'ENOTFOUND'
      callback(err, '', 4)
      return
    }
    if (options.all === true) {
      callback(
        null,
        matching.map((a) => ({ address: a.address, family: a.family }))
      )
      return
    }
    callback(null, matching[0].address, matching[0].family)
  }
}

function headersToRecord (init: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (init === undefined) return result
  const entries =
    init instanceof Headers ? Array.from(init.entries()) : Array.isArray(init) ? init : Object.entries(init)
  for (const [key, value] of entries) {
    result[key.toLowerCase()] = value
  }
  return result
}

function limitBody (response: UndiciResponse, maxBytes: number, url: string): UndiciResponse {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) {
    void response.body?.cancel()
    throw new SafeFetchError('BODY_TOO_LARGE', `Response body exceeds ${maxBytes} bytes`, url)
  }
  const source = response.body as unknown as ReadableStream<Uint8Array> | null
  if (source === null) return response

  let total = 0
  const limited = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform (chunk, controller) {
        total += chunk.byteLength
        if (total > maxBytes) {
          controller.error(new SafeFetchError('BODY_TOO_LARGE', `Response body exceeds ${maxBytes} bytes`, url))
          return
        }
        controller.enqueue(chunk)
      }
    })
  )
  // Every reader goes through a throwaway Response over the limited stream, so text(), json() and
  // arrayBuffer() keep their native decoding while status, headers and url stay on the original object.
  const reader = new Response(limited as unknown as ReadableStream<Uint8Array>)
  Object.defineProperties(response, {
    body: { get: () => limited, configurable: true },
    text: { value: async () => await reader.text(), configurable: true },
    json: { value: async () => await reader.json(), configurable: true },
    arrayBuffer: { value: async () => await reader.arrayBuffer(), configurable: true },
    bytes: { value: async () => new Uint8Array(await reader.arrayBuffer()), configurable: true },
    blob: { value: async () => await reader.blob(), configurable: true }
  })
  return response
}

/**
 * Creates a fetch function that only reaches hosts and addresses that pass the SSRF checks.
 * It honours the caller's redirect mode: 'follow' validates each hop, 'manual' returns the 3xx response
 * unchanged, 'error' throws on any redirect.
 */
export function createSafeFetch (opts: SafeFetchOptions = {}): typeof fetch {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const pinned = new PinnedAddresses()
  const agent = new Agent({ connect: { lookup: pinned.lookup, timeout: timeoutMs } })

  const safeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let current = validateUrl(rawUrl, opts)
    const mode = init.redirect ?? 'follow'
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = init.signal != null ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    let method = (init.method ?? 'GET').toUpperCase()
    let body = init.body
    const headers = headersToRecord(init.headers)

    for (let hop = 0; ; hop++) {
      const addresses = await resolveAndCheck(current.hostname, opts)
      pinned.set(current.hostname, addresses)

      let response: UndiciResponse
      try {
        response = await undiciFetch(current.href, {
          method,
          headers,
          body: body as never,
          signal,
          redirect: 'manual',
          dispatcher: agent
        })
      } catch (err) {
        if (timeoutSignal.aborted) {
          throw new SafeFetchError('TIMEOUT', `Request timed out after ${timeoutMs} ms`, current.href)
        }
        if (init.signal?.aborted === true) throw err
        if (err instanceof SafeFetchError) throw err
        const cause = err instanceof Error ? err.message : String(err)
        throw new SafeFetchError('FETCH_FAILED', `Request failed: ${cause}`, current.href)
      }

      if (!REDIRECT_STATUSES.has(response.status) || mode === 'manual') {
        return limitBody(response, maxBodyBytes, current.href) as unknown as Response
      }
      const location = response.headers.get('location')
      void response.body?.cancel()
      if (mode === 'error') {
        throw new SafeFetchError('REDIRECT_NOT_ALLOWED', `Redirect to ${location ?? '?'} not allowed`, current.href)
      }
      if (location === null) {
        return response as unknown as Response
      }
      if (hop >= maxRedirects) {
        throw new SafeFetchError('TOO_MANY_REDIRECTS', `More than ${maxRedirects} redirects`, current.href)
      }

      let next: URL
      try {
        next = new URL(location, current)
      } catch {
        throw new SafeFetchError('INVALID_URL', `Invalid redirect location: ${location}`, current.href)
      }
      next.hash = ''
      if (next.origin !== current.origin) {
        // Never forward credentials to another origin
        delete headers.authorization
        delete headers.cookie
      }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET'
        body = undefined
        delete headers['content-type']
        delete headers['content-length']
      }
      current = validateUrl(next.href, opts)
    }
  }

  return safeFetch as typeof fetch
}
