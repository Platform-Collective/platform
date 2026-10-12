// SPDX-License-Identifier: EPL-2.0

import { SafeFetchError } from '../safe-fetch-types'
import { isAllowlistedHost, normalizeHostname, validateUrl } from '../safe-url'

function codeOf (fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code
    throw err
  }
  return undefined
}

describe('normalizeHostname', () => {
  it('lower-cases, strips brackets and trailing dots', () => {
    expect(normalizeHostname('CalDAV.Example.COM.')).toBe('caldav.example.com')
    expect(normalizeHostname('[::1]')).toBe('::1')
  })
})

describe('isAllowlistedHost', () => {
  it('matches exact names and wildcards, ignores CIDRs', () => {
    const list = ['caldav.example', '*.internal.test', '10.0.0.0/8']
    expect(isAllowlistedHost('CALDAV.EXAMPLE', list)).toBe(true)
    expect(isAllowlistedHost('a.internal.test', list)).toBe(true)
    expect(isAllowlistedHost('internal.test', list)).toBe(false)
    expect(isAllowlistedHost('10.0.0.1', list)).toBe(false)
    expect(isAllowlistedHost('other.example', list)).toBe(false)
    expect(isAllowlistedHost('other.example', undefined)).toBe(false)
  })
})

describe('validateUrl', () => {
  it('accepts https to a public host', () => {
    expect(validateUrl('https://caldav.example/dav/').href).toBe('https://caldav.example/dav/')
  })

  it('rejects http unless allowed', () => {
    expect(codeOf(() => validateUrl('http://caldav.example/'))).toBe('INVALID_PROTOCOL')
    expect(validateUrl('http://caldav.example/', { allowHttp: true }).protocol).toBe('http:')
  })

  it('rejects other protocols, malformed input and embedded credentials', () => {
    expect(codeOf(() => validateUrl('ftp://caldav.example/'))).toBe('INVALID_PROTOCOL')
    expect(codeOf(() => validateUrl('file:///etc/passwd'))).toBe('INVALID_PROTOCOL')
    expect(codeOf(() => validateUrl('not a url'))).toBe('INVALID_URL')
    expect(codeOf(() => validateUrl('https://user:pw@caldav.example/'))).toBe('INVALID_URL')
  })

  it('rejects localhost names and blocked IP literals', () => {
    expect(codeOf(() => validateUrl('https://localhost/'))).toBe('BLOCKED_HOST')
    expect(codeOf(() => validateUrl('https://LOCALHOST./'))).toBe('BLOCKED_HOST')
    expect(codeOf(() => validateUrl('https://foo.localhost/'))).toBe('BLOCKED_HOST')
    expect(codeOf(() => validateUrl('https://127.0.0.1/'))).toBe('BLOCKED_ADDRESS')
    expect(codeOf(() => validateUrl('https://[::1]/'))).toBe('BLOCKED_ADDRESS')
    expect(codeOf(() => validateUrl('https://169.254.169.254/latest/meta-data/'))).toBe('BLOCKED_ADDRESS')
    expect(codeOf(() => validateUrl('https://[::ffff:10.0.0.1]/'))).toBe('BLOCKED_ADDRESS')
  })

  it('lets the allowlist admit a private literal or a local name', () => {
    expect(validateUrl('https://192.168.1.10/', { allowlist: ['192.168.1.0/24'] }).hostname).toBe('192.168.1.10')
    expect(validateUrl('https://radicale.localhost/', { allowlist: ['radicale.localhost'] }).hostname).toBe(
      'radicale.localhost'
    )
  })

  it('does not resolve hostnames at this stage', () => {
    expect(validateUrl('https://minio/').hostname).toBe('minio')
  })
})
