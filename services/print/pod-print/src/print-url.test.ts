// SPDX-License-Identifier: EPL-2.0

import { getPrintHostnames, isAllowedPrintUrl } from './print-url'

describe('print URL policy', () => {
  it.each(['http://huly.local/', 'https://HULY.LOCAL/page', 'https://huly.local./page'])(
    'allows an exact normalized hostname: %s',
    (url) => {
      expect(isAllowedPrintUrl(url, [' HULY.LOCAL. '])).toBe(true)
    }
  )

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/',
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://[::1]/',
    'http://localhost/',
    'http://huly.local.evil.example/',
    'http://sub.huly.local/',
    'http://huly.local@169.254.169.254/',
    'file:///etc/passwd',
    'ftp://huly.local/file',
    'data:text/html,test',
    'invalid URL'
  ])('denies URLs outside the policy: %s', (url) => {
    expect(isAllowedPrintUrl(url, ['huly.local'])).toBe(false)
  })

  it.each([{ allowedHostnames: [] }, { allowedHostnames: [''] }, { allowedHostnames: [' ', ''] }])(
    'denies every hostname with an empty allowlist: $allowedHostnames',
    ({ allowedHostnames }) => {
      expect(isAllowedPrintUrl('http://huly.local:8087/', allowedHostnames)).toBe(false)
    }
  )
})

describe('print hostnames', () => {
  it('includes the front origin alongside configured hostnames', () => {
    expect(getPrintHostnames([' HULY.LOCAL. ', '', 'other.example'], 'http://front:8080')).toEqual([
      'huly.local',
      'other.example',
      'http://front:8080'
    ])
  })

  it.each([[[]], [['']], [[' ', '']]])('falls back to the FRONT_URL host for %p', (configured) => {
    expect(getPrintHostnames(configured, 'https://Huly.Example.com:8443/path')).toEqual(['https://huly.example.com:8443'])
  })

  it('denies everything when neither the allowlist nor FRONT_URL yields a host', () => {
    expect(getPrintHostnames([], 'not a url')).toEqual([])
  })
})

describe('print origin and port restrictions', () => {
  it.each(['http://huly.local:6379/', 'https://huly.local:9200/', 'https://user:pass@huly.local/'])(
    'does not allow arbitrary ports or credentials: %s', (url) => {
      expect(isAllowedPrintUrl(url, ['huly.local'])).toBe(false)
    }
  )

  it('restricts the fallback to the exact front origin', () => {
    const allowed = getPrintHostnames([], 'http://localhost:8080/app')
    expect(isAllowedPrintUrl('http://localhost:8080/page', allowed)).toBe(true)
    expect(isAllowedPrintUrl('http://localhost:9200/page', allowed)).toBe(false)
    expect(isAllowedPrintUrl('https://localhost:8080/page', allowed)).toBe(false)
  })

  it('matches explicit ports, wildcards and IPv6 hosts', () => {
    expect(isAllowedPrintUrl('http://huly.local:8087/', ['huly.local:8087'])).toBe(true)
    expect(isAllowedPrintUrl('https://team.example.com:8443/', ['*.example.com:8443'])).toBe(true)
    expect(isAllowedPrintUrl('https://example.com:8443/', ['*.example.com:8443'])).toBe(false)
    expect(isAllowedPrintUrl('http://[::1]/', ['::1'])).toBe(true)
    expect(isAllowedPrintUrl('http://[::1]:8087/', ['[::1]:8087'])).toBe(true)
  })

  it.each(['host/path', 'user@host', 'host:bad', '*.com/path', '*', 'https://host/path'])(
    'rejects malformed configuration at startup: %s', (entry) => {
      expect(() => getPrintHostnames([entry], 'https://front.example')).toThrow()
    }
  )
})
