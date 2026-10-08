// SPDX-License-Identifier: EPL-2.0

import type dns from 'dns'
import type net from 'net'
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici'
import { validateOptions } from './ranges'
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
// Statuses that never carry a body, see RFC 9110 section 6.4.1
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void

interface PinnedEntry {
  addresses: ResolvedAddress[]
  refs: number
}

/**
 * Holds the only addresses a connection may use for a hostname while a request to it is in flight.
 * safeFetch acquires an entry right before each request and releases it when the request finishes,
 * so the socket cannot be opened to an address that was never checked (DNS rebinding) and the map
 * does not grow with the number of distinct hosts contacted.
 */
export class PinnedAddresses {
  private readonly pinned = new Map<string, PinnedEntry>()

  get size (): number {
    return this.pinned.size
  }

  /** Pins the addresses for a hostname and returns the function that releases the pin. */
  acquire (hostname: string, addresses: ResolvedAddress[]): () => void {
    const host = normalizeHostname(hostname)
    const entry = this.pinned.get(host)
    if (entry !== undefined) {
      entry.addresses = addresses
      entry.refs++
    } else {
      this.pinned.set(host, { addresses, refs: 1 })
    }
    let released = false
    return () => {
      if (released) return
      released = true
      const current = this.pinned.get(host)
      if (current === undefined) return
      current.refs--
      if (current.refs <= 0) this.pinned.delete(host)
    }
  }

  readonly lookup: net.LookupFunction = (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    const addresses = this.pinned.get(normalizeHostname(hostname))?.addresses ?? []
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

interface RequestParts {
  url: string
  method: string
  headers: Record<string, string>
  body: BodyInit | null | undefined
  signal: AbortSignal | null | undefined
  redirect: RequestRedirect
}

/** Merges a Request object with init the way fetch does: init wins, the Request supplies the rest. */
async function toRequestParts (input: string | URL | Request, init: RequestInit): Promise<RequestParts> {
  if (!(input instanceof Request)) {
    return {
      url: typeof input === 'string' ? input : input.href,
      method: init.method ?? 'GET',
      headers: headersToRecord(init.headers),
      body: init.body,
      signal: init.signal,
      redirect: init.redirect ?? 'follow'
    }
  }
  let body: BodyInit | null | undefined = init.body
  if (body === undefined && input.body !== null) {
    // The Request body is a stream; buffer it so it can be re-sent after a redirect.
    body = await input.arrayBuffer()
  }
  return {
    url: input.url,
    method: init.method ?? input.method,
    headers: init.headers !== undefined ? headersToRecord(init.headers) : headersToRecord(input.headers),
    body,
    signal: init.signal ?? input.signal,
    redirect: init.redirect ?? input.redirect
  }
}

/**
 * Wraps a body stream so that reading past maxBytes fails with BODY_TOO_LARGE and a timeout that fires
 * while the body is still arriving surfaces as TIMEOUT rather than the runtime's own abort error.
 */
function limitStream (
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  url: string,
  timeoutSignal: AbortSignal
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let total = 0
  return new ReadableStream<Uint8Array>({
    async pull (controller) {
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch (err) {
        if (timeoutSignal.aborted) {
          throw new SafeFetchError('TIMEOUT', 'Request timed out while reading the response body', url)
        }
        throw err
      }
      if (result.done) {
        controller.close()
        return
      }
      total += result.value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new SafeFetchError('BODY_TOO_LARGE', `Response body exceeds ${maxBytes} bytes`, url)
      }
      controller.enqueue(result.value)
    },
    async cancel (reason) {
      await reader.cancel(reason).catch(() => undefined)
    }
  })
}

/**
 * Returns a Response whose body is size-limited. Responses that cannot carry a body (HEAD, 204, 205, 304)
 * are returned as they are, whatever Content-Length says. The result is a native Response built over the
 * limited stream, so text(), json(), formData() and clone() all behave normally; url and redirected are
 * carried over from the original.
 */
function wrapResponse (
  response: UndiciResponse,
  method: string,
  maxBytes: number,
  url: string,
  redirected: boolean,
  timeoutSignal: AbortSignal
): Response {
  const hasBody = method !== 'HEAD' && !NULL_BODY_STATUSES.has(response.status) && response.body !== null
  if (!hasBody) {
    return response as unknown as Response
  }
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) {
    void response.body?.cancel()
    throw new SafeFetchError('BODY_TOO_LARGE', `Response body exceeds ${maxBytes} bytes`, url)
  }
  const limited = limitStream(response.body as unknown as ReadableStream<Uint8Array>, maxBytes, url, timeoutSignal)
  const wrapped = new Response(limited, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers as unknown as HeadersInit
  })
  Object.defineProperties(wrapped, {
    url: { value: response.url, configurable: true },
    redirected: { value: redirected, configurable: true }
  })
  return wrapped
}

/**
 * Creates a fetch function that only reaches hosts and addresses that pass the SSRF checks.
 * It honours the caller's redirect mode: 'follow' validates each hop, 'manual' returns the 3xx response
 * unchanged, 'error' throws on any redirect. Invalid allowlist or blockedRanges entries fail here,
 * not on the first request.
 */
export function createSafeFetch (opts: SafeFetchOptions = {}): typeof fetch {
  validateOptions(opts)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const pinned = new PinnedAddresses()
  const agent = new Agent({ connect: { lookup: pinned.lookup, timeout: timeoutMs } })

  const safeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const parts = await toRequestParts(input, init)
    let current = validateUrl(parts.url, opts)
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = parts.signal != null ? AbortSignal.any([parts.signal, timeoutSignal]) : timeoutSignal
    let method = parts.method.toUpperCase()
    let body = parts.body
    const headers = parts.headers

    for (let hop = 0; ; hop++) {
      const addresses = await resolveAndCheck(current.hostname, opts)
      const release = pinned.acquire(current.hostname, addresses)

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
        if (parts.signal?.aborted === true) throw err
        if (err instanceof SafeFetchError) throw err
        const cause = err instanceof Error ? err.message : String(err)
        throw new SafeFetchError('FETCH_FAILED', `Request failed: ${cause}`, current.href)
      } finally {
        // The connection is established once the headers have arrived, so the pin is no longer needed.
        release()
      }

      const location = response.headers.get('location')
      const isRedirect = REDIRECT_STATUSES.has(response.status)
      if (!isRedirect || parts.redirect === 'manual' || location === null) {
        return wrapResponse(response, method, maxBodyBytes, current.href, hop > 0, timeoutSignal)
      }
      void response.body?.cancel()
      if (parts.redirect === 'error') {
        throw new SafeFetchError('REDIRECT_NOT_ALLOWED', `Redirect to ${location} not allowed`, current.href)
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
        delete headers['proxy-authorization']
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

  return safeFetch
}
