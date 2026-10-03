//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { isPublicAddress, normalizeWebhookEvents, parseIp, validateWebhookUrl } from '../webhook'

describe('validateWebhookUrl', () => {
  const ok = (url: string, allowInsecure = false): boolean => validateWebhookUrl(url, { allowInsecure }).ok
  const error = (url: string, allowInsecure = false): string | undefined => {
    const res = validateWebhookUrl(url, { allowInsecure })
    return res.ok === false ? res.error : undefined
  }

  it('accepts a public https URL', () => {
    expect(ok('https://hooks.example.com/huly?x=1')).toBe(true)
    expect(ok('https://93.184.216.34/hook')).toBe(true)
    expect(ok('https://[2606:2800:220:1:248:1893:25c8:1946]/hook')).toBe(true)
    expect(ok('  https://example.com:8443/a  ')).toBe(true)
  })

  it('rejects empty, malformed and over long input', () => {
    expect(error('')).toBe('empty')
    expect(error('   ')).toBe('empty')
    expect(error('not a url')).toBe('invalid')
    expect(error('https://')).toBe('invalid')
    expect(error(`https://example.com/${'a'.repeat(2100)}`)).toBe('tooLong')
  })

  it('allows https only, unless development mode allows http', () => {
    expect(error('http://example.com/hook')).toBe('protocol')
    expect(error('ftp://example.com/hook')).toBe('protocol')
    expect(error('file:///etc/passwd')).toBe('protocol')
    expect(error('javascript:alert(1)')).toBe('protocol')
    expect(ok('http://example.com/hook', true)).toBe(true)
    expect(error('ftp://example.com', true)).toBe('protocol')
  })

  it('rejects credentials in the URL', () => {
    expect(error('https://user:pw@example.com/')).toBe('credentials')
    expect(error('https://user@example.com/')).toBe('credentials')
  })

  it('rejects internal host names', () => {
    for (const url of [
      'https://localhost/hook',
      'https://LOCALHOST./hook',
      'https://app.localhost/hook',
      'https://printer.local/hook',
      'https://db.internal/hook',
      'https://intranet/hook',
      'https://host/hook'
    ]) {
      expect(error(url)).toBe('host')
    }
  })

  it('rejects private and loopback IP literals, also in disguise', () => {
    for (const url of [
      'https://127.0.0.1/',
      'https://10.1.2.3/',
      'https://192.168.1.1/',
      'https://172.16.0.1/',
      'https://169.254.169.254/latest/meta-data',
      'https://0.0.0.0/',
      'https://[::1]/',
      'https://[fe80::1]/',
      'https://[fd00::1]/',
      'https://[::ffff:127.0.0.1]/',
      'https://[::ffff:10.0.0.1]/',
      // The URL parser turns these forms into dotted addresses
      'https://2130706433/',
      'https://0x7f.1/',
      'https://0177.0.0.1/',
      'https://127.1/'
    ]) {
      expect(error(url)).toBe('address')
    }
  })

  it('lets development mode target local servers', () => {
    expect(ok('http://localhost:3000/hook', true)).toBe(true)
    expect(ok('http://127.0.0.1:9000/hook', true)).toBe(true)
  })
})

describe('isPublicAddress', () => {
  it('accepts public IPv4 addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1']) {
      expect(isPublicAddress(ip)).toBe(true)
    }
  })

  it('rejects reserved IPv4 ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '0.1.2.3',
      '10.0.0.0',
      '10.255.255.255',
      '100.64.0.1',
      '100.127.255.255',
      '127.0.0.1',
      '127.255.255.254',
      '169.254.169.254',
      '172.16.0.0',
      '172.31.255.255',
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.0.1',
      '198.18.0.1',
      '198.19.255.255',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '255.255.255.255'
    ]) {
      expect(isPublicAddress(ip)).toBe(false)
    }
  })

  it('accepts global unicast IPv6 addresses, with or without brackets', () => {
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
    expect(isPublicAddress('[2606:4700:4700::1111]')).toBe(true)
    expect(isPublicAddress('2a00:1450:4001:81b::200e')).toBe(true)
  })

  it('rejects reserved IPv6 ranges', () => {
    for (const ip of [
      '::',
      '::1',
      'fe80::1',
      'febf::1',
      'fc00::1',
      'fd12:3456::1',
      'fec0::1',
      'ff02::1',
      '2001:db8::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      '100::1',
      '64:ff9b:1::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:169.254.169.254',
      '::127.0.0.1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::1',
      '2002:a9fe:a9fe::1',
      '4000::1',
      '[::1]'
    ]) {
      expect(isPublicAddress(ip)).toBe(false)
    }
  })

  it('judges embedded IPv4 addresses by the IPv4 part', () => {
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true)
    expect(isPublicAddress('64:ff9b::808:808')).toBe(true)
    expect(isPublicAddress('2002:808:808::1')).toBe(true)
  })

  it('fails closed for anything that is not an address', () => {
    for (const text of ['', 'example.com', 'localhost', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', '1.2.3.4/8', 'fe80::1%eth0', ':::', '1::2::3', 'g::1', '12345::1']) {
      expect(isPublicAddress(text)).toBe(false)
    }
  })
})

describe('parseIp', () => {
  it('parses both versions', () => {
    expect(parseIp('1.2.3.4')).toEqual({ version: 4, bytes: [1, 2, 3, 4] })
    expect(parseIp('::1')).toEqual({ version: 6, groups: [0, 0, 0, 0, 0, 0, 0, 1] })
    expect(parseIp('1:2:3:4:5:6:7:8')).toEqual({ version: 6, groups: [1, 2, 3, 4, 5, 6, 7, 8] })
    expect(parseIp('::ffff:1.2.3.4')).toEqual({ version: 6, groups: [0, 0, 0, 0, 0, 0xffff, 0x102, 0x304] })
    expect(parseIp('nope')).toBeUndefined()
  })
})

describe('normalizeWebhookEvents', () => {
  it('keeps known events once, in a fixed order', () => {
    expect(normalizeWebhookEvents(['deleted', 'created', 'created', 'bogus', 5])).toEqual(['created', 'deleted'])
    expect(normalizeWebhookEvents('created')).toEqual([])
    expect(normalizeWebhookEvents(undefined)).toEqual([])
  })
})
