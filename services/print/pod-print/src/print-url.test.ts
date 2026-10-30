// SPDX-License-Identifier: EPL-2.0

import { getPrintHostnames, isAllowedPrintUrl } from './print-url'

describe('print URL policy', () => {
  it.each(['http://huly.local:8087/', 'https://HULY.LOCAL/page', 'https://huly.local./page'])(
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
  it('uses the configured hostnames when present', () => {
    expect(getPrintHostnames([' HULY.LOCAL. ', '', 'other.example'], 'http://front:8080')).toEqual([
      'huly.local',
      'other.example'
    ])
  })

  it.each([[[]], [['']], [[' ', '']]])('falls back to the FRONT_URL host for %p', (configured) => {
    expect(getPrintHostnames(configured, 'https://Huly.Example.com:8443/path')).toEqual(['huly.example.com'])
  })

  it('denies everything when neither the allowlist nor FRONT_URL yields a host', () => {
    expect(getPrintHostnames([], 'not a url')).toEqual([])
  })
})
