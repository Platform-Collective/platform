// SPDX-License-Identifier: EPL-2.0
import { redactLogValue, safeRequestLog } from '../logging'

const canary = 'synthetic-credential-never-emit'
const absent = (value: unknown): boolean => !JSON.stringify(value).includes(canary)

it('redacts nested credentials, authorization, URL credentials and query tokens without mutation', () => {
  const value = {
    authorization: 'Bearer ' + canary,
    DeepgramApiKey: canary,
    nested: { secretKey: canary, passphrase: canary, key: canary, cookies: canary },
    url: 'https://user:' + canary + '@example.invalid/login?%74oken=' + canary + '&code=' + canary,
    message: 'Authorization: Bearer ' + canary,
    list: [{ PlatformToken: canary }],
    port: 8080
  }
  const result = redactLogValue(value) as typeof value
  expect(absent(result)).toBe(true)
  expect(value.nested.secretKey === canary).toBe(true)
  expect(result.port).toBe(8080)
})

it('handles cycles, getters, buffers and error objects without exposing their contents', () => {
  // Synthetic credential fixture for the redactor; the raw error is never logged.
  const value: any = {
    error: Object.assign(new Error(canary), { config: { token: canary } }),
    bytes: new Uint8Array(Array.from(canary, (character) => character.charCodeAt(0)))
  }
  value.self = value
  Object.defineProperty(value, 'getter', {
    enumerable: true,
    get: () => {
      throw new Error(canary)
    }
  })
  const result = redactLogValue(value) as { bytes: unknown }
  expect(absent(result)).toBe(true)
  expect(result.bytes === '[REDACTED]').toBe(true)
  const array = [canary]
  Object.defineProperty(array, 0, {
    get: () => {
      throw new Error('getter must not run')
    }
  })
  expect(absent(redactLogValue(array))).toBe(true)
})

it.each(['/login/auth', '/files', '/api/v1/statistics', '/_transactor/' + canary, '/' + canary])(
  'logs method, constant route and status without URL or headers',
  (path) => {
    const record = safeRequestLog(
      { method: 'GET', url: path + '?token=' + canary, headers: { authorization: canary } },
      401
    )
    expect(absent(record)).toBe(true)
    expect(record.method).toBe('GET')
    expect(record.status).toBe(401)
    expect(typeof record.route).toBe('string')
  }
)

const keys = [
  'secret',
  'token',
  'password',
  'pass',
  'pwd',
  'jwt',
  'code',
  'state',
  'apiKey',
  'privateKey',
  'signature',
  'session',
  'sid',
  'auth',
  'otpCode',
  'verificationCode',
  'encryptionKey',
  'signingKey',
  'masterKey',
  'licenseKey',
  'bearer',
  'sig',
  'otp',
  'passwd',
  'accessKey',
  'credential',
  'storageAdapter',
  'key',
  'cert',
  'ca',
  'passphrase',
  'sessionId',
  'clientSecret',
  'refresh_token',
  'accessKeyId',
  'secretAccessKey',
  'credentials',
  'webhookSecret',
  'SERVER_SECRET'
]
const headers = [
  'Authorization',
  'aUtHoRiZaTiOn',
  'Cookie',
  'sEt-CoOkIe',
  'X-Service-Token',
  'x-api-key',
  'Proxy-Authorization',
  'x-amz-security-token'
]
const cases: Array<[string, unknown]> = []
for (const key of [...keys, ...headers]) {
  for (const name of [key, key.toUpperCase(), Array.from(key, (c) => '%' + c.charCodeAt(0).toString(16)).join('')]) {
    cases.push(
      ['object field', { [name]: canary }],
      ['serialized field', JSON.stringify({ [name]: canary })],
      ['header pair', { headers: [[name, canary]] }],
      ['named header', { headers: [{ name, value: canary }] }],
      ['keyed header', { headers: [{ key: name, value: canary }] }],
      ['raw header list', { rawHeaders: [name, canary] }],
      ['unaligned header list', ['safe', name, canary]],
      ['raw header text', name + ': ' + canary],
      ['form field', name + '=' + canary + '&safe=1'],
      ['query field', 'https://example.invalid/?' + name + '=' + canary],
      ['fragment field', 'https://example.invalid/#' + name + '=' + canary]
    )
  }
}
for (const scheme of ['Bearer', 'Basic', 'Token', 'Digest', 'AWS4-HMAC-SHA256', 'Custom', 'NTLM', 'Negotiate']) {
  const value = scheme + ' ' + canary + ', credential="' + canary + '"'
  cases.push(['auth scheme', 'Authorization: ' + value], ['auth pair', [['Authorization', value]]])
}
for (const value of [
  'Bearer ' + canary,
  'Basic ' + canary,
  'Token ' + canary,
  'Authorization: "Bearer safe", credential="' + canary + '"',
  'Cookie: "safe=value"; session=' + canary,
  'pass="prefix\\"' + canary + '"',
  'password=prefix ' + canary,
  'failed pass=' + canary,
  'https://user:p/a@' + canary + '@example.invalid/',
  'https://example.invalid/#access_token=' + canary,
  'token=' + canary + '&x=1'
]) {
  cases.push(
    ['text', value],
    ['encoded text', encodeURIComponent(value)],
    ['double encoded text', encodeURIComponent(encodeURIComponent(value))]
  )
}
for (const key of keys) {
  const encoded = Array.from(canary, (c) => '%' + c.charCodeAt(0).toString(16)).join('')
  cases.push(['encoded value', key + '=' + encoded], ['serialized encoded value', JSON.stringify({ [key]: encoded })])
}
for (const separator of ['%26', '%23', '%3B', '%0A', '%22', '%27']) {
  for (const text of [
    'token=prefix' + separator + canary,
    'https://example.invalid/?token=prefix' + separator + canary,
    'https://example.invalid/#token=prefix' + separator + canary,
    'Authorization: Bearer prefix' + separator + canary
  ]) {
    cases.push(
      ['encoded credential delimiter', text],
      ['encoded credential delimiter in encoded text', encodeURIComponent(text)]
    )
  }
}
for (const separator of [',', ';', '#', '}', '&']) {
  for (const key of ['password', 'pass', 'token']) {
    const text = key + '=prefix' + separator + canary + '&safe=1'
    const error = new Error(text)
    error.stack = 'Error: ' + text + '\n    at ' + canary + ' (/source/' + canary + ':1:2)'
    cases.push(
      ['raw form delimiter', text],
      ['encoded raw form delimiter', encodeURIComponent(text)],
      ['error form delimiter', error]
    )
  }
}
for (const text of ['Bearer "' + canary + '"', "Bearer '" + canary + "'", 'token => ' + canary]) {
  cases.push(['quoted scheme or arrow', text])
}
it.each(cases.map(([label, input], index) => [label + ' ' + index, input] as const))('redacts %s', (_label, input) => {
  const result = JSON.stringify(redactLogValue(input))
  expect(result.includes(canary)).toBe(false)
  expect(result.includes(Array.from(canary, (c) => '%' + c.charCodeAt(0).toString(16)).join(''))).toBe(false)
})

it('retains useful error diagnostics with redacted and bounded message and stack', () => {
  const error = new TypeError('storage unavailable token=' + canary)
  error.stack =
    'TypeError: token=' +
    canary +
    '\n' +
    ('    at connect (https://example.invalid/?token=' + canary + ':1:2)\n').repeat(100)
  const result = redactLogValue(error) as { name: string, message: string, stack: string }
  expect(absent(result)).toBe(true)
  expect(result.name).toBe('TypeError')
  expect(result.message.includes('storage unavailable')).toBe(true)
  expect(result.stack.includes('at connect')).toBe(true)
  expect(result.stack.length <= 2048).toBe(true)
  expect(result.stack.split('\n').length <= 8).toBe(true)
})

it('does not invoke diagnostic getters on errors', () => {
  const error = new Error('safe message')
  for (const key of ['name', 'message', 'stack', 'code']) {
    Object.defineProperty(error, key, {
      get: () => {
        throw new Error('getter must not run')
      }
    })
  }
  expect(() => redactLogValue(error)).not.toThrow()
})

it.each(['opaque', 'provider', 'name', 'stack', 'multiline'])('restricts arbitrary error diagnostics: %s', (kind) => {
  const error = new Error(kind === 'provider' ? 'Invalid API key ' + canary : canary)
  if (kind === 'name') error.name = canary
  if (kind === 'stack') error.stack = 'Error: safe\n    at ' + canary + ' (/source/' + canary + ':12:34)\n' + canary
  if (kind === 'multiline') error.message = 'storage unavailable\n' + canary
  const result = redactLogValue(error) as { name: string, message: string, stack: string }
  expect(absent(result)).toBe(true)
  expect(typeof result.name === 'string' && typeof result.message === 'string').toBe(true)
  expect(result.stack.length <= 2048 && result.stack.split('\n').length <= 8).toBe(true)
})

it.each(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'])('keeps an allowed error cause: %s', (code) => {
  const error = Object.assign(new Error('connect ' + code + ' ' + canary), { code })
  const result = redactLogValue(error) as { code: string, message: string }
  expect(absent(result)).toBe(true)
  expect(result.code === code).toBe(true)
  expect(result.message.includes(code)).toBe(true)
})

it('preserves unrelated statusCode and objectKey fields', () => {
  const result = redactLogValue({ statusCode: 503, objectKey: 'document' }) as { statusCode: number, objectKey: string }
  expect(result.statusCode === 503 && result.objectKey === 'document').toBe(true)
})

it.each([129, 200, 4096])('redacts credential fields with long keys of length %s', (length) => {
  for (const suffix of ['token', '_password']) {
    const text = 'a'.repeat(length) + suffix + '=' + canary
    expect(absent(redactLogValue(text))).toBe(true)
    expect(absent(redactLogValue(encodeURIComponent(text)))).toBe(true)
  }
})

it.each(['letters', 'hyphens', 'urls', 'queries', 'jwt prefixes', 'error'])(
  'scrubs 64 KiB adversarial %s within 250 ms',
  (kind) => {
    const text = (
      kind === 'hyphens'
        ? 'a-'
        : kind === 'urls'
          ? 'http://'
          : kind === 'queries'
            ? '?'
            : kind === 'jwt prefixes'
              ? 'eyJ-'
              : 'a'
    )
      .repeat(65536)
      .slice(0, 65536)
    const input = kind === 'error' ? new Error(text) : text
    // Warm up the same path, then measure each call independently; output is never printed.
    redactLogValue(input)
    let slowest = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = performance.now()
      redactLogValue(input)
      slowest = Math.max(slowest, performance.now() - start)
    }
    // The former quadratic regression took seconds; allow ample shared-runner headroom.
    expect(slowest < 250).toBe(true)
  }
)

it('keeps safe numeric request duration and response size', () => {
  const log = safeRequestLog as (
    request: { method: string },
    status: number,
    metrics: { duration: unknown, bytes: unknown }
  ) => { duration?: number, bytes?: number }
  const result = log({ method: 'GET' }, 200, { duration: '12.345', bytes: '4096' })
  expect(result.duration).toBe(12.345)
  expect(result.bytes).toBe(4096)
  for (const value of [canary, '-1', 'Infinity', '12ms', '', undefined]) {
    const invalid = log({ method: 'GET' }, 200, { duration: value, bytes: value })
    expect(invalid.duration === undefined && invalid.bytes === undefined).toBe(true)
  }
})

it.each(['\n', '\r\n', '\r'])('does not retain multiline credential continuations (%j)', (separator) => {
  expect(absent(redactLogValue('passphrase="first-line' + separator + canary + '"'))).toBe(true)
})
