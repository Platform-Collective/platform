// SPDX-License-Identifier: EPL-2.0

const redacted = '[REDACTED]'
// Capture the native accessor; invoke it below with an explicit Error receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const errorStackGetter = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get
const secretKey =
  /authorization|cookie|token|secret|password|passwd|passphrase|apikey|privatekey|accesskey|credential|jwt|bearer|signature|session|storageadapter|(?:otp|auth|verification|reset|login)code|(?:encryption|signing|master|license|client|hmac)key|^(?:auth|pass|pwd|sig|sid|code|state|otp|key|cert|ca)$/i
const errorNames = [
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'PlatformError',
  'NoSuchKey'
]
const errorCodes = ['EADDRINUSE', 'EACCES', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EPIPE']
const errorMessages = [
  'storage unavailable',
  'fetch failed',
  'socket hang up',
  'Invalid API key',
  'database unavailable',
  'permission denied'
]

function scrubFields (text: string): string {
  // Restart only at a key boundary and bound whitespace to avoid quadratic retries.
  const fields = /(?<![\w%-])([\w%-]+)(["']?\s{0,16}[:=]\s{0,16})/g
  let result = ''
  const start = 0
  let match: RegExpExecArray | null
  while ((match = fields.exec(text)) !== null) {
    if (!isSecretKey(match[1])) continue
    result += text.slice(start, match.index) + match[1] + '=' + redacted
    // A credential value may continue across lines, so discard the remaining text.
    return result
  }
  return result + text.slice(start)
}

// Decode before matching: diagnostic strings may contain encoded keys or entire URLs.
function decodeLayer (text: string): string {
  return text.replace(/(?:%[a-f0-9]{2})+/gi, (part) => {
    try {
      return decodeURIComponent(part)
    } catch {
      return redacted
    }
  })
}

function decodeDiagnostic (text: string): string {
  for (let count = 0; count < 3; count++) {
    const decoded = decodeLayer(text)
    if (decoded === text) return text
    text = decoded
  }
  return /%[a-f0-9]{2}/i.test(text) ? redacted : text
}

function isSecretKey (key: string): boolean {
  return secretKey.test(decodeDiagnostic(key).replace(/[^a-z0-9]/gi, ''))
}

/** Redact recognized credentials without invoking application getters, toJSON or custom inspectors. */
export function redactLogValue (value: unknown): unknown {
  const seen = new WeakSet<object>()
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 8) return redacted
    if (typeof item === 'string') {
      if (item.length > 65536) return redacted
      const scrub = (text: string): string => {
        if (/^\s*[[{]/.test(text)) {
          try {
            return JSON.stringify(visit(JSON.parse(text), depth + 1))
          } catch {
            /* Continue with text diagnostics. */
          }
        }
        return (
          scrubFields(text)
            .replace(/\b(Bearer|Basic|Token)\s{1,16}(?![=:])[^\r\n]*/gi, '$1 ' + redacted)
            // Scheme matching is bounded; scan each URL-shaped span once, even without @.
            .replace(/\b[a-z][a-z0-9+.-]{0,31}:\/\/\S*/gi, (url) => {
              const at = url.lastIndexOf('@')
              return at < 0 ? url : url.slice(0, url.indexOf('://') + 3) + redacted + url.slice(at)
            })
            .replace(/([?&#;][^=?&#;\s"']{1,128})=([^\r\n]*)/g, '$1=' + redacted)
            .replace(/\beyJ[A-Za-z0-9_.-]*/g, redacted)
        )
      }
      let text = item
      for (let count = 0; count < 3; count++) {
        // Mask values before decoding can turn encoded credential bytes into delimiters.
        const safe = scrub(text)
        const decoded = decodeLayer(safe)
        if (safe === decoded) return safe
        text = decoded
      }
      return /%[a-f0-9]{2}/i.test(text) ? redacted : scrub(text)
    }
    if (item === null || typeof item === 'number' || typeof item === 'boolean' || item === undefined) return item
    if (typeof item !== 'object') return redacted
    if (seen.has(item) || ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return redacted
    seen.add(item)
    if (item instanceof Error) {
      const diagnostic = (key: string): string | undefined => {
        let current: object | null = item
        for (let count = 0; current !== null && count < 8; count++, current = Object.getPrototypeOf(current)) {
          const descriptor = Object.getOwnPropertyDescriptor(current, key)
          if (descriptor !== undefined) {
            const value =
              key === 'stack' && errorStackGetter !== undefined && descriptor.get === errorStackGetter
                ? errorStackGetter.call(item)
                : descriptor.value
            return typeof value === 'string' ? value : undefined
          }
        }
      }
      const name = diagnostic('name')
      const message = diagnostic('message')
      // V8 can materialize a lazy stack by reading name/message. Skip it for accessors.
      const stack = name !== undefined && message !== undefined ? diagnostic('stack') : undefined
      const code = diagnostic('code')
      // Foreign diagnostics cannot be made safe by recognizing credential syntax alone.
      // Retain only literal categories and numeric frame positions, never foreign text.
      const safeName = name !== undefined && errorNames.includes(name) ? name : 'Error'
      const safeCode = code !== undefined && errorCodes.includes(code) ? code : undefined
      const prefix = errorMessages.find(
        (prefix) =>
          message === prefix ||
          message?.startsWith(prefix + ' ') === true ||
          message?.startsWith(prefix + '\n') === true
      )
      const safeMessage =
        prefix !== undefined
          ? prefix + (message === prefix ? '' : ' ' + redacted)
          : safeCode !== undefined
            ? safeCode + ' ' + redacted
            : redacted
      const frames = stack
        ?.slice(0, 8192)
        .split('\n')
        .slice(1)
        .flatMap((line) => {
          if (!/^\s{1,16}at /.test(line)) return []
          const position = /:(\d{1,7}):(\d{1,7})\)?$/.exec(line)
          const method = /^\s{1,16}at (connect|listen|start|main) \(/.exec(line)?.[1]
          return [
            '    at ' +
              (method ?? redacted) +
              (position === null ? '' : ' (' + redacted + ':' + position[1] + ':' + position[2] + ')')
          ]
        })
        .slice(0, 7)
      return {
        name: safeName,
        message: safeMessage,
        stack:
          stack === undefined
            ? undefined
            : [safeName + ': ' + safeMessage, ...(frames ?? [])].join('\n').slice(0, 2048),
        code: safeCode
      }
    }
    if (Array.isArray(item)) {
      return Array.from({ length: item.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, index)
        // Covers both [name, value] pairs and Node's flat rawHeaders representation.
        const previous = index > 0 ? Object.getOwnPropertyDescriptor(item, index - 1)?.value : undefined
        return descriptor?.get !== undefined || (typeof previous === 'string' && isSecretKey(previous))
          ? redacted
          : visit(descriptor?.value, depth + 1)
      })
    }
    const result: Record<string, unknown> = {}
    const descriptors = Object.getOwnPropertyDescriptors(item)
    const headerName = descriptors.name?.value ?? descriptors.key?.value
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue
      Object.defineProperty(result, key, {
        value:
          isSecretKey(key) ||
          descriptor.get !== undefined ||
          (key === 'value' && typeof headerName === 'string' && isSecretKey(headerName))
            ? redacted
            : visit(descriptor.value, depth + 1),
        enumerable: true
      })
    }
    return result
  }
  return visit(value, 0)
}

/** Only constant route classes: even query-free WebSocket paths can carry JWTs. */
export function safeRequestLog (
  request: { method?: string, url?: string, originalUrl?: string, headers?: unknown },
  status: number,
  metrics?: { duration?: unknown, bytes?: unknown }
): { method: string, route: string, status: number, duration?: number, bytes?: number } {
  const numeric = (value: unknown): number | undefined => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return undefined
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : undefined
  }
  const path = (request.originalUrl ?? request.url ?? '').split(/[?#]/, 1)[0]
  const route = /^\/_transactor(?:\/|$)/.test(path)
    ? 'transactor'
    : /^\/_collaborator(?:\/|$)/.test(path)
      ? 'collaborator'
      : /^\/_accounts(?:\/|$)/.test(path)
        ? 'accounts'
        : /^\/files(?:\/|$)/.test(path)
          ? 'files'
          : /^\/api(?:\/|$)/.test(path)
            ? 'api'
            : /^\/login(?:\/|$)/.test(path)
              ? 'login'
              : path === '/'
                ? 'root'
                : 'other'
  const method = request.method ?? ''
  return {
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE'].includes(method)
      ? method
      : 'OTHER',
    route,
    status,
    duration: numeric(metrics?.duration),
    bytes: numeric(metrics?.bytes)
  }
}
