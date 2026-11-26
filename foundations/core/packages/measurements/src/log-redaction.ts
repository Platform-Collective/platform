//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

// Normalized key suffixes (lowercase, without `-`, `_`, `.`) whose values are always masked.
// Suffix matching covers variants like `idToken`, `client_secret`, `x-api-key`, `sessionToken`.
const SENSITIVE_KEY_SUFFIXES = [
  'token',
  'secret',
  'password',
  'passwd',
  'authorization',
  'cookie',
  'apikey',
  'privatekey',
  'secretkey',
  'accesskey',
  'credential',
  'credentials',
  'jwt'
]

const REDACTED = '[REDACTED]'
const CIRCULAR = '[Circular]'
const UNSERIALIZABLE = '[UNSERIALIZABLE]'

function isSensitiveKey (key: string): boolean {
  if (key === '') return false
  const normalized = key.toLowerCase().replace(/[-_.]/g, '')
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

// Fields of HTTP client errors (axios/gaxios/fetch wrappers) that carry request headers or response bodies
const SENSITIVE_ERROR_FIELDS = new Set(['config', 'request', 'response', 'headers', 'options'])

// Key suffixes (lowercase) whose string values are treated as URLs and passed through `redactUrl`
const URL_KEY_SUFFIXES = ['url', 'uri', 'href']

function isUrlKey (key: string): boolean {
  const lower = key.toLowerCase()
  return URL_KEY_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

const errorPrinter = (err: Error): object => {
  const { message, stack, ...rest } = err
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest)) {
    if (SENSITIVE_ERROR_FIELDS.has(k)) continue
    safe[k] = v
  }
  const status = (rest as { response?: { status?: unknown } }).response?.status
  if (status !== undefined) safe.responseStatus = status
  // `cause` is non-enumerable, so it is not part of `rest`; the replacer sanitizes it recursively
  const cause = (err as { cause?: unknown }).cause
  if (cause !== undefined) safe.cause = cause
  return { message, stack, ...safe }
}

/**
 * JSON replacer used for log output: expands errors without request/response details
 * and masks values of sensitive keys (matched by normalized suffix, e.g. `idToken`, `x-api-key`).
 * String values of URL-like keys (`url`, `redirectUri`, `href`, ...) are passed through `redactUrl`.
 * Boolean flags (e.g. `hasPassword`) are kept as is.
 * @public
 */
export function logReplacer (key: string, value: any): any {
  if (value != null && value !== '' && typeof value !== 'boolean' && isSensitiveKey(key)) {
    return REDACTED
  }
  if (typeof value === 'string' && isUrlKey(key)) {
    return redactUrl(value)
  }
  return value instanceof Error ? errorPrinter(value) : value
}

type SafeReplacer = (this: unknown, key: string, value: unknown) => unknown

/**
 * Creates a replacer that applies `logReplacer`, replaces circular references, converts BigInt to string
 * and replaces binary values with a short placeholder, so serialization never fails on these values.
 */
function createSafeReplacer (rootKey: string): SafeReplacer {
  // Objects on the current path as serialized (`replaced`) and as they were before `logReplacer` (`originals`).
  // Errors are replaced by a new object on every visit, so cycles through errors are detected by the originals.
  const ancestors: unknown[] = []
  const originals: unknown[] = []
  let isRoot = true
  return function (this: unknown, key: string, value: unknown): unknown {
    // The first call is for the root value (key ''); it is masked by the field name it is logged under
    const replaced = logReplacer(isRoot ? rootKey : key, value)
    isRoot = false
    if (typeof replaced === 'bigint') return replaced.toString()
    if (replaced === null || typeof replaced !== 'object') return replaced
    // `toJSON` runs before the replacer, so a Buffer arrives here as `{ type, data: [...] }`;
    // the holder (`this`) still keeps the raw value
    const raw = this !== null && typeof this === 'object' ? (this as Record<string, unknown>)[key] : undefined
    if (ArrayBuffer.isView(raw)) return `[binary ${raw.byteLength} bytes]`
    // `this` is the object holding `key`; drop ancestors which are not on the current path
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop()
      originals.pop()
    }
    if (ancestors.includes(replaced) || originals.includes(value)) return CIRCULAR
    ancestors.push(replaced)
    originals.push(value)
    return replaced
  }
}

/**
 * Serializes a value for log output with `logReplacer` applied at every level.
 * Never throws and never falls back to the raw value: circular references become `[Circular]`,
 * values that still fail to serialize become `[UNSERIALIZABLE]`.
 * `key` is the field name the value is logged under, if any.
 * @public
 */
export function safeLogStringify (value: any, key: string = ''): string | undefined {
  try {
    return JSON.stringify(value, createSafeReplacer(key))
  } catch {
    return JSON.stringify(UNSERIALIZABLE)
  }
}

/**
 * Returns a copy of value that is safe to pass to a logger which does not use `logReplacer` itself
 * (util.inspect / prettyPrint / OTLP attributes). `key` is the field name the value is logged under, if any.
 * @public
 */
export function sanitizeForLog (value: any, key: string = ''): any {
  const replaced = logReplacer(key, value)
  if (typeof replaced === 'bigint') return replaced.toString()
  if (replaced === null || typeof replaced !== 'object') return replaced
  const serialized = safeLogStringify(value, key)
  return serialized === undefined ? undefined : JSON.parse(serialized)
}

/**
 * Applies `sanitizeForLog` to every field of a structured log record.
 * @public
 */
export function sanitizeLogFields<T extends Record<string, unknown>> (fields: T | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (fields === undefined) return result
  for (const [key, value] of Object.entries(fields)) {
    result[key] = sanitizeForLog(value, key)
  }
  return result
}

const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'inviteid',
  'access_token',
  'refresh_token',
  'id_token',
  'apikey',
  'api_key',
  'secret',
  'password',
  'code',
  'otp',
  'signature',
  'sig',
  'x-amz-signature'
])

// JWT-like values: three base64url segments, header starts with `eyJ`
const JWT_PATTERN = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/

function safeDecode (value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function redactPath (path: string): string {
  if (!path.includes('eyJ')) return path
  return path
    .split('/')
    .map((segment) => (JWT_PATTERN.test(safeDecode(segment)) ? REDACTED : segment))
    .join('/')
}

// User info of an absolute URL (`scheme://user:password@host`). Anchored; the authority part ends at the first
// `/`, `?` or `#`, and the last `@` before it is taken, so passwords with an unencoded `@` are masked entirely.
const URL_USER_INFO_PATTERN = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i

/**
 * Removes credentials from URL before logging: user info (`user:password@`), sensitive query parameters
 * (tokens, invite ids, OAuth codes, signatures) and JWT-like values in query parameters or path segments.
 * @public
 */
export function redactUrl (url: string | undefined): string {
  if (url === undefined) return ''
  url = url.replace(URL_USER_INFO_PATTERN, `$1${REDACTED}@`)
  const qIdx = url.indexOf('?')
  if (qIdx === -1) return redactPath(url)
  const parts = url
    .slice(qIdx + 1)
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq === -1) return part
      const key = part.slice(0, eq)
      const decodedKey = safeDecode(key)
      const value = safeDecode(part.slice(eq + 1))
      if (
        SENSITIVE_QUERY_PARAMS.has(decodedKey.toLowerCase()) ||
        isSensitiveKey(decodedKey) ||
        JWT_PATTERN.test(value)
      ) {
        return `${key}=${REDACTED}`
      }
      return part
    })
  return `${redactPath(url.slice(0, qIdx))}?${parts.join('&')}`
}

type HttpLogToken = (req: any, res: any, arg?: string) => string | undefined

/**
 * Access log format function for `morgan`: same output as morgan `short` format, but URL is passed through `redactUrl`.
 * Usage: `app.use(morgan(safeHttpLogFormat, { stream }))`
 * @public
 */
export function safeHttpLogFormat (tokens: Record<string, HttpLogToken>, req: any, res: any): string {
  const t = (name: string, arg?: string): string => tokens[name]?.(req, res, arg) ?? '-'
  const url = redactUrl(req.originalUrl ?? req.url)
  return `${t('remote-addr')} ${t('remote-user')} ${t('method')} ${url} HTTP/${t('http-version')} ${t('status')} ${t('res', 'content-length')} - ${t('response-time')} ms`
}
