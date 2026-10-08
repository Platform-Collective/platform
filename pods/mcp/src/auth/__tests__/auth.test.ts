// SPDX-License-Identifier: EPL-2.0

import { resolveAuthMode } from '../../config'
import { fakeEnv } from '../../__tests__/test-doubles'
import { AuthenticationError, toTransactorHttpUrl } from '../authenticator'
import { extractBearerToken } from '../token-extractor'

describe('toTransactorHttpUrl', () => {
  it('maps both websocket schemes to their http twins', () => {
    expect(toTransactorHttpUrl('ws://huly.local:3030')).toBe('http://huly.local:3030')
    expect(toTransactorHttpUrl('wss://huly.example.com')).toBe('https://huly.example.com')
  })

  it('leaves an already-http url alone', () => {
    expect(toTransactorHttpUrl('http://huly.local:3030')).toBe('http://huly.local:3030')
  })
})

describe('extractBearerToken', () => {
  const header = (value: string | undefined): { authorization?: string } => ({ authorization: value })

  it('reads a bearer credential', () => {
    expect(extractBearerToken(header('Bearer abc'))).toBe('abc')
  })

  it('is case-insensitive about the scheme, as RFC 7235 requires', () => {
    expect(extractBearerToken(header('bearer abc'))).toBe('abc')
    expect(extractBearerToken(header('BEARER abc'))).toBe('abc')
  })

  it('tolerates surrounding whitespace', () => {
    expect(extractBearerToken(header('  Bearer   abc  '))).toBe('abc')
  })

  it('rejects a missing, empty or non-bearer credential', () => {
    expect(extractBearerToken(header(undefined))).toBeUndefined()
    expect(extractBearerToken(header('Bearer'))).toBeUndefined()
    expect(extractBearerToken(header('Bearer '))).toBeUndefined()
    expect(extractBearerToken(header('Basic abc'))).toBeUndefined()
  })
})

describe('resolveAuthMode', () => {
  it('defaults to perRequest when no credentials are configured', () => {
    expect(resolveAuthMode(fakeEnv())).toBe('perRequest')
  })

  it('selects configured mode when an API token is present', () => {
    expect(resolveAuthMode(fakeEnv({ HULY_TOKEN: 'abc' }))).toBe('configured')
  })

  it('selects configured mode when both email and password are present', () => {
    expect(resolveAuthMode(fakeEnv({ HULY_EMAIL: 'a@b.c', HULY_PASSWORD: 'pw' }))).toBe('configured')
  })

  it('ignores an email with no password', () => {
    expect(resolveAuthMode(fakeEnv({ HULY_EMAIL: 'a@b.c' }))).toBe('perRequest')
  })

  it('prefers configured mode when both are set', () => {
    expect(resolveAuthMode(fakeEnv({ HULY_TOKEN: 'abc', MCP_ALLOWED_TOKENS: 'x' }))).toBe('configured')
  })
})

describe('AuthenticationError', () => {
  it('carries a machine-readable reason', () => {
    const err = new AuthenticationError('guest', 'nope')
    expect(err.reason).toBe('guest')
    expect(err).toBeInstanceOf(Error)
  })
})
