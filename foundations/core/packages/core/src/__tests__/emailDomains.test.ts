// SPDX-License-Identifier: EPL-2.0

import { normalizeEmailDomain, parseEmailDomains } from '../emailDomains'

describe('emailDomains', () => {
  describe('normalizeEmailDomain', () => {
    test('trims, lowercases and strips a leading @ and a trailing dot', () => {
      expect(normalizeEmailDomain('  Example.COM ')).toBe('example.com')
      expect(normalizeEmailDomain('@example.com')).toBe('example.com')
      expect(normalizeEmailDomain('example.com.')).toBe('example.com')
      expect(normalizeEmailDomain('mail.sub.example.co.uk')).toBe('mail.sub.example.co.uk')
      expect(normalizeEmailDomain('xn--bcher-kva.example')).toBe('xn--bcher-kva.example')
    })

    test.each([
      '',
      'localhost',
      'example',
      '.example.com',
      'example..com',
      '-example.com',
      'example-.com',
      'exa_mple.com',
      '*.example.com',
      '.*@example.com',
      'user@example.com',
      'example.com/path',
      '10.0.0.1',
      'bücher.example',
      'a'.repeat(64) + '.com',
      ('a'.repeat(60) + '.').repeat(5) + 'com'
    ])('rejects invalid domain %p', (value) => {
      expect(normalizeEmailDomain(value)).toBeUndefined()
    })
  })

  describe('parseEmailDomains', () => {
    test('parses comma, semicolon and whitespace separated lists', () => {
      expect(parseEmailDomains('example.com, Example.org;foo.bar  baz.qux')).toEqual({
        domains: ['example.com', 'example.org', 'foo.bar', 'baz.qux'],
        invalid: []
      })
    })

    test('ignores empty entries and removes duplicates', () => {
      expect(parseEmailDomains(' , example.com,,EXAMPLE.com , @example.com ')).toEqual({
        domains: ['example.com'],
        invalid: []
      })
    })

    test('accepts arrays', () => {
      expect(parseEmailDomains(['example.com', ' example.org , foo.bar'])).toEqual({
        domains: ['example.com', 'example.org', 'foo.bar'],
        invalid: []
      })
    })

    test('reports invalid entries', () => {
      expect(parseEmailDomains('example.com, *.evil.com, localhost')).toEqual({
        domains: ['example.com'],
        invalid: ['*.evil.com', 'localhost']
      })
    })

    test('returns no domains for empty input', () => {
      expect(parseEmailDomains(undefined)).toEqual({ domains: [], invalid: [] })
      expect(parseEmailDomains(null)).toEqual({ domains: [], invalid: [] })
      expect(parseEmailDomains('')).toEqual({ domains: [], invalid: [] })
      expect(parseEmailDomains('  ,  ')).toEqual({ domains: [], invalid: [] })
      expect(parseEmailDomains([])).toEqual({ domains: [], invalid: [] })
    })

    test('limits the number of domains', () => {
      const input = Array.from({ length: 101 }, (_, i) => `d${i}.example.com`).join(',')
      const { domains, invalid } = parseEmailDomains(input)
      expect(domains).toHaveLength(100)
      expect(invalid).toEqual(['d100.example.com'])
    })
  })
})
