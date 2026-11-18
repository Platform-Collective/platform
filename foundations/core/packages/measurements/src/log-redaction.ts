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

const errorPrinter = ({ message, stack, ...rest }: Error): object => {
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest)) {
    if (SENSITIVE_ERROR_FIELDS.has(k)) continue
    safe[k] = v
  }
  const status = (rest as { response?: { status?: unknown } }).response?.status
  if (status !== undefined) safe.responseStatus = status
  return { message, stack, ...safe }
}

/**
 * JSON replacer used for log output: expands errors without request/response details
 * and masks values of sensitive keys (matched by normalized suffix, e.g. `idToken`, `x-api-key`).
 * Boolean flags (e.g. `hasPassword`) are kept as is.
 * @public
 */
export function logReplacer (key: string, value: any): any {
  if (value != null && value !== '' && typeof value !== 'boolean' && isSensitiveKey(key)) {
    return REDACTED
  }
  return value instanceof Error ? errorPrinter(value) : value
}

type SafeReplacer = (this: unknown, key: string, value: unknown) => unknown

/**
 * Creates a replacer that applies `logReplacer`, replaces circular references and converts BigInt to string,
 * so serialization never fails on these values.
 */
function createSafeReplacer (): SafeReplacer {
  const ancestors: unknown[] = []
  return function (this: unknown, key: string, value: unknown): unknown {
    const replaced = logReplacer(key, value)
    if (typeof replaced === 'bigint') return replaced.toString()
    if (replaced === null || typeof replaced !== 'object') return replaced
    // `this` is the object holding `key`; drop ancestors which are not on the current path
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop()
    }
    if (ancestors.includes(replaced)) return CIRCULAR
    ancestors.push(replaced)
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
    const replacer = createSafeReplacer()
    return JSON.stringify(replacer.call({ [key]: value }, key, value), replacer)
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
  'otp'
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

/**
 * Removes credentials from URL before logging: sensitive query parameters (tokens, invite ids, OAuth codes)
 * and JWT-like values in query parameters or path segments.
 * @public
 */
export function redactUrl (url: string | undefined): string {
  if (url === undefined) return ''
  const qIdx = url.indexOf('?')
  if (qIdx === -1) return redactPath(url)
  const parts = url
    .slice(qIdx + 1)
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq === -1) return part
      const key = part.slice(0, eq)
      const value = safeDecode(part.slice(eq + 1))
      if (SENSITIVE_QUERY_PARAMS.has(safeDecode(key).toLowerCase()) || JWT_PATTERN.test(value)) {
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
