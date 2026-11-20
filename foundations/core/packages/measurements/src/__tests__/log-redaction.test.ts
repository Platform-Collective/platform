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

import {
  logReplacer,
  redactUrl,
  safeHttpLogFormat,
  safeLogStringify,
  sanitizeForLog,
  sanitizeLogFields
} from '../log-redaction'

const SECRET = 'Bearer SECRET-VALUE'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'

interface HttpClientError extends Error {
  config?: { headers: Record<string, string> }
  response?: { status: number, data: string }
  code?: string
}

describe('logReplacer', () => {
  it.each([
    'token',
    'Authorization',
    'cookie',
    'set-cookie',
    'password',
    'idToken',
    'id_token',
    'refreshToken',
    'clientSecret',
    'client_secret',
    'x-api-key',
    'xApiKey',
    'apiKey',
    'privateKey',
    'jwt',
    'sessionToken',
    'workspaceToken',
    'credentials'
  ])('masks value of %s', (key) => {
    expect(logReplacer(key, 'value')).toBe('[REDACTED]')
  })

  it.each(['tokenCount', 'maxTokens', 'workspace', 'email', 'secretKind'])('keeps value of %s', (key) => {
    expect(logReplacer(key, 'value')).toBe('value')
  })

  it('keeps empty values and boolean flags', () => {
    expect(logReplacer('token', '')).toBe('')
    expect(logReplacer('token', undefined)).toBeUndefined()
    expect(logReplacer('hasPassword', true)).toBe(true)
  })

  it('does not mask the root value', () => {
    expect(logReplacer('', 'value')).toBe('value')
  })

  it('drops request and response details from HTTP client errors', () => {
    const err: HttpClientError = new Error('Request failed')
    err.config = { headers: { authorization: SECRET } }
    err.response = { status: 401, data: SECRET }
    err.code = 'ERR_BAD_REQUEST'

    const printed = JSON.stringify(logReplacer('', err), logReplacer)
    expect(printed).not.toContain('SECRET-VALUE')
    expect(JSON.parse(printed)).toMatchObject({
      message: 'Request failed',
      code: 'ERR_BAD_REQUEST',
      responseStatus: 401
    })
  })
})

describe('safeLogStringify', () => {
  it('masks nested sensitive keys', () => {
    const printed = safeLogStringify({ user: 'u1', headers: { Authorization: SECRET } })
    expect(printed).not.toContain('SECRET-VALUE')
    expect(printed).toContain('u1')
  })

  it('masks value by its field key', () => {
    expect(safeLogStringify(SECRET, 'token')).toBe('"[REDACTED]"')
  })

  it('replaces circular references without exposing secrets', () => {
    const req: Record<string, unknown> = { headers: { authorization: SECRET } }
    req.self = req
    const printed = safeLogStringify({ req })
    expect(printed).not.toContain('SECRET-VALUE')
    expect(printed).toContain('[Circular]')
  })

  it('keeps repeated non-circular references', () => {
    const shared = { id: 'shared' }
    expect(JSON.parse(safeLogStringify({ a: shared, b: shared }) ?? '')).toEqual({ a: shared, b: shared })
  })

  it('converts BigInt to string', () => {
    expect(JSON.parse(safeLogStringify({ n: BigInt(10), password: 'p' }) ?? '')).toEqual({
      n: '10',
      password: '[REDACTED]'
    })
  })

  it('does not throw on values that fail to serialize', () => {
    const broken = {
      get value (): string {
        throw new Error('getter failed')
      }
    }
    expect(safeLogStringify(broken)).toBe('"[UNSERIALIZABLE]"')
  })
})

describe('sanitizeForLog', () => {
  it('returns primitives as is', () => {
    expect(sanitizeForLog('value')).toBe('value')
    expect(sanitizeForLog(42)).toBe(42)
    expect(sanitizeForLog(undefined)).toBeUndefined()
  })

  it('never returns the original circular object', () => {
    const req: Record<string, unknown> = { headers: { authorization: SECRET } }
    req.self = req
    const sanitized = sanitizeForLog(req)
    expect(sanitized).not.toBe(req)
    expect(JSON.stringify(sanitized)).not.toContain('SECRET-VALUE')
  })
})

describe('sanitizeLogFields', () => {
  it('sanitizes every field by its key', () => {
    expect(sanitizeLogFields({ token: SECRET, nested: { secret: SECRET }, count: 1 })).toEqual({
      token: '[REDACTED]',
      nested: { secret: '[REDACTED]' },
      count: 1
    })
  })

  it('returns an empty object for undefined fields', () => {
    expect(sanitizeLogFields(undefined)).toEqual({})
  })
})

describe('redactUrl', () => {
  it('masks sensitive query parameters regardless of case and encoding', () => {
    expect(redactUrl('/api?Token=abc&workspace=w&invite%49d=123&code=c')).toBe(
      '/api?Token=[REDACTED]&workspace=w&invite%49d=[REDACTED]&code=[REDACTED]'
    )
  })

  it('masks JWT-like query values and path segments', () => {
    expect(redactUrl(`/api?t=${JWT}`)).toBe('/api?t=[REDACTED]')
    expect(redactUrl(`/files/${JWT}/blob?x=1`)).toBe('/files/[REDACTED]/blob?x=1')
  })

  it('keeps URLs without credentials unchanged', () => {
    expect(redactUrl('/files/blob-id?workspace=w')).toBe('/files/blob-id?workspace=w')
    expect(redactUrl(undefined)).toBe('')
  })
})

describe('safeHttpLogFormat', () => {
  it('formats like morgan short with redacted url', () => {
    const tokens = {
      'remote-addr': () => '127.0.0.1',
      'remote-user': () => undefined,
      method: () => 'GET',
      'http-version': () => '1.1',
      status: () => '200',
      res: (_req: unknown, _res: unknown, field?: string) => (field === 'content-length' ? '12' : undefined),
      'response-time': () => '3.1'
    }
    expect(safeHttpLogFormat(tokens, { originalUrl: '/a?token=abc' }, {})).toBe(
      '127.0.0.1 - GET /a?token=[REDACTED] HTTP/1.1 200 12 - 3.1 ms'
    )
  })
})
