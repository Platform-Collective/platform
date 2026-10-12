// SPDX-License-Identifier: EPL-2.0

import { isAllowlistedAddress, isBlockedAddress, validateOptions } from '../ranges'

describe('isBlockedAddress', () => {
  const blocked = [
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.254',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.1.2.3',
    '::10.0.0.1',
    '64:ff9b::10.0.0.1',
    '64:ff9b::8.8.8.8',
    '64:ff9b:1::a00:1',
    '64:ff9b:1:ffff::808:808',
    '::ffff:0:a00:1',
    '2002:0a00:0001::',
    '2002:0808:0808::',
    '2001::1',
    '2001:0:53aa:64c:0:fffe:ac10:1',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'fe80::1%en0',
    'fec0::1',
    'ff02::1',
    '[::1]'
  ]
  const allowed = [
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.0.1.1',
    '192.167.255.255',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2a00:1450:4001:80e::200e',
    '::ffff:8.8.8.8',
    '::ffff:0:808:808',
    '::8.8.8.8',
    '[2606:4700:4700::1001]'
  ]

  it.each(blocked)('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each(allowed)('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })

  it('treats unparseable input as blocked', () => {
    expect(isBlockedAddress('')).toBe(true)
    expect(isBlockedAddress('not-an-ip')).toBe(true)
    expect(isBlockedAddress('999.1.1.1')).toBe(true)
  })

  it('honours extra blocked ranges', () => {
    expect(isBlockedAddress('8.8.8.8', { blockedRanges: ['8.8.0.0/16'] })).toBe(true)
    expect(isBlockedAddress('8.9.0.1', { blockedRanges: ['8.8.0.0/16'] })).toBe(false)
  })

  it('lets the allowlist override a blocked range by CIDR or literal', () => {
    expect(isBlockedAddress('10.20.30.40', { allowlist: ['10.20.0.0/16'] })).toBe(false)
    expect(isBlockedAddress('10.21.0.1', { allowlist: ['10.20.0.0/16'] })).toBe(true)
    expect(isBlockedAddress('192.168.1.5', { allowlist: ['192.168.1.5'] })).toBe(false)
    expect(isBlockedAddress('192.168.1.6', { allowlist: ['192.168.1.5'] })).toBe(true)
    expect(isBlockedAddress('fd00::5', { allowlist: ['fd00::/64'] })).toBe(false)
  })
})

describe('isAllowlistedAddress', () => {
  it('ignores hostnames and malformed entries', () => {
    expect(isAllowlistedAddress('10.0.0.1', ['caldav.example', 'bad/entry', ''])).toBe(false)
  })

  it('does not match across address families', () => {
    expect(isAllowlistedAddress('::ffff:10.0.0.1', ['10.0.0.0/8'])).toBe(false)
  })
})

describe('validateOptions', () => {
  it('accepts valid entries', () => {
    expect(() => {
      validateOptions({ allowlist: ['caldav.example', '*.internal.test', '10.0.0.0/8', '::1'] })
    }).not.toThrow()
    expect(() => {
      validateOptions({ blockedRanges: ['8.8.0.0/16', 'fd00::/8'] })
    }).not.toThrow()
    expect(() => {
      validateOptions({})
    }).not.toThrow()
  })

  it('rejects malformed CIDRs and empty allowlist entries up front', () => {
    expect(() => {
      validateOptions({ blockedRanges: ['8.8.0.0'] })
    }).toThrow(/blockedRanges/)
    expect(() => {
      validateOptions({ blockedRanges: ['10.0.0.0/33'] })
    }).toThrow(/blockedRanges/)
    expect(() => {
      validateOptions({ allowlist: ['10.0.0.0/8/'] })
    }).toThrow(/allowlist CIDR/)
    expect(() => {
      validateOptions({ allowlist: [' '] })
    }).toThrow(/empty allowlist/)
  })
})
