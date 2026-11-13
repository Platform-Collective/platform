// SPDX-License-Identifier: EPL-2.0

import { AccountRole, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import platform, { PlatformError, Severity, Status, setMetadata } from '@hcengineering/platform'
import {
  getEmailDomain,
  hasDomainRestriction,
  isEmailAllowedByDomains,
  isStrictSingleEmail,
  serializeAllowedDomains
} from '../inviteDomains'
import { type WorkspaceInvite } from '../types'
import { checkInvite } from '../utils'
import { accountPlugin } from '../plugin'

describe('inviteDomains', () => {
  describe('serializeAllowedDomains', () => {
    test('joins domains or returns undefined for no restriction', () => {
      expect(serializeAllowedDomains(['example.com', 'example.org'])).toBe('example.com,example.org')
      expect(serializeAllowedDomains([])).toBeUndefined()
    })
  })

  describe('isStrictSingleEmail', () => {
    test.each([
      'user@example.com',
      'first.last+tag@sub.example.co.uk',
      "o'brien@example.org",
      'a_b-c@xn--bcher-kva.example'
    ])('accepts %p', (value) => {
      expect(isStrictSingleEmail(value)).toBe(true)
    })

    test.each([
      '',
      'user',
      'user@',
      '@example.com',
      'other@evil.test,employee@example.com',
      'other@evil.test;employee@example.com',
      'other@evil.test employee@example.com',
      'other@evil.test, employee@example.com',
      'other@evil.test\nemployee@example.com',
      'Other <other@evil.test>, employee@example.com',
      '<employee@example.com>',
      'Employee <employee@example.com>',
      '"other@evil.test"@example.com',
      '"a,b"@example.com',
      'user@evil.test@example.com',
      'user@example.com.',
      'user@[127.0.0.1]',
      'user@127.0.0.1',
      'user@localhost',
      '.user@example.com',
      'user.@example.com',
      'us..er@example.com',
      ' user@example.com',
      'user@example.com ',
      'a'.repeat(65) + '@example.com',
      'user@' + ('a'.repeat(60) + '.').repeat(5) + 'com'
    ])('rejects %p', (value) => {
      expect(isStrictSingleEmail(value)).toBe(false)
    })
  })

  describe('getEmailDomain', () => {
    test('returns the lowercased domain of a single trimmed address', () => {
      expect(getEmailDomain('User@Example.COM')).toBe('example.com')
      expect(getEmailDomain(' user@example.com ')).toBe('example.com')
    })

    test('returns undefined for quoted local parts, address lists and FQDN dots', () => {
      expect(getEmailDomain('"a@b"@example.com')).toBeUndefined()
      expect(getEmailDomain('other@evil.test,employee@example.com')).toBeUndefined()
      expect(getEmailDomain('user@example.com.')).toBeUndefined()
    })

    test('returns undefined for addresses without a domain', () => {
      expect(getEmailDomain('')).toBeUndefined()
      expect(getEmailDomain('user')).toBeUndefined()
      expect(getEmailDomain('user@')).toBeUndefined()
      expect(getEmailDomain('@example.com')).toBeUndefined()
      expect(getEmailDomain(undefined)).toBeUndefined()
      expect(getEmailDomain(null)).toBeUndefined()
    })
  })

  describe('hasDomainRestriction', () => {
    test('detects a stored restriction', () => {
      expect(hasDomainRestriction('example.com')).toBe(true)
      expect(hasDomainRestriction('')).toBe(false)
      expect(hasDomainRestriction('  ')).toBe(false)
      expect(hasDomainRestriction(undefined)).toBe(false)
      expect(hasDomainRestriction(null)).toBe(false)
    })
  })

  describe('isEmailAllowedByDomains', () => {
    const allowed = 'example.com,example.org'

    test('allows everything without a restriction', () => {
      expect(isEmailAllowedByDomains('user@anything.test', undefined)).toBe(true)
      expect(isEmailAllowedByDomains('user@anything.test', null)).toBe(true)
      expect(isEmailAllowedByDomains('user@anything.test', '')).toBe(true)
      expect(isEmailAllowedByDomains('', undefined)).toBe(true)
    })

    test('allows exact domain matches case-insensitively', () => {
      expect(isEmailAllowedByDomains('user@example.com', allowed)).toBe(true)
      expect(isEmailAllowedByDomains('User@EXAMPLE.ORG', allowed)).toBe(true)
      expect(isEmailAllowedByDomains(' user@example.com ', allowed)).toBe(true)
      expect(isEmailAllowedByDomains('user@example.com', 'EXAMPLE.COM')).toBe(true)
    })

    test('does not match subdomains, parent domains or look-alikes', () => {
      expect(isEmailAllowedByDomains('user@sub.example.com', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('user@evilexample.com', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('user@example.com.evil.test', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('user@com', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('user@example.net', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('user@example.com', 'sub.example.com')).toBe(false)
    })

    test('rejects addresses with several @', () => {
      expect(isEmailAllowedByDomains('user@example.com@evil.test', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('user@evil.test@example.com', allowed)).toBe(false)
    })

    test('rejects recipient lists that end with an allowed domain (regression)', () => {
      expect(isEmailAllowedByDomains('other@evil.test,employee@example.com', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('other@evil.test;employee@example.com', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('other@evil.test employee@example.com', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('Other <other@evil.test>, employee@example.com', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('"other@evil.test,x"@example.com', allowed)).toBe(false)
    })

    test('rejects missing or malformed emails when restricted', () => {
      expect(isEmailAllowedByDomains('', allowed)).toBe(false)
      expect(isEmailAllowedByDomains(undefined, allowed)).toBe(false)
      expect(isEmailAllowedByDomains(null, allowed)).toBe(false)
      expect(isEmailAllowedByDomains('example.com', allowed)).toBe(false)
      expect(isEmailAllowedByDomains('user@', allowed)).toBe(false)
    })

    test('fails closed if the stored restriction contains no valid domain', () => {
      expect(isEmailAllowedByDomains('user@example.com', '*')).toBe(false)
      expect(isEmailAllowedByDomains('user@example.com', '.*')).toBe(false)
    })
  })
})

describe('checkInvite with allowed domains', () => {
  const ctx = {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  } as unknown as MeasureContext
  const workspaceUuid = 'ws-uuid' as WorkspaceUuid

  beforeEach(() => {
    setMetadata(accountPlugin.metadata.MAIL_URL, 'http://mail.test')
  })

  afterAll(() => {
    setMetadata(accountPlugin.metadata.MAIL_URL, '')
  })

  function makeInvite (extra: Partial<WorkspaceInvite> = {}): WorkspaceInvite {
    return {
      id: '1',
      workspaceUuid,
      expiresOn: -1,
      remainingUses: 5,
      role: AccountRole.User,
      ...extra
    }
  }

  test('accepts any email when the invite has no domain restriction', async () => {
    await expect(checkInvite(ctx, makeInvite(), 'user@anything.test')).resolves.toBe(workspaceUuid)
  })

  test('ignores the legacy emailPattern (kept unenforced for existing invites)', async () => {
    const invite = makeInvite({ emailPattern: '.*@corp\\.test' })
    await expect(checkInvite(ctx, invite, 'user@anything.test')).resolves.toBe(workspaceUuid)
  })

  test('accepts emails from an allowed domain', async () => {
    const invite = makeInvite({ allowedDomains: 'example.com,example.org' })
    await expect(checkInvite(ctx, invite, 'user@example.org')).resolves.toBe(workspaceUuid)
  })

  test('rejects emails from other domains and subdomains', async () => {
    const invite = makeInvite({ allowedDomains: 'example.com' })
    await expect(checkInvite(ctx, invite, 'user@evil.test')).rejects.toThrow()
    await expect(checkInvite(ctx, invite, 'user@sub.example.com')).rejects.toThrow()
  })

  test('rejects a recipient list ending with an allowed domain (regression)', async () => {
    const invite = makeInvite({ allowedDomains: 'example.com' })
    await expect(checkInvite(ctx, invite, 'other@evil.test,employee@example.com')).rejects.toThrow()
  })

  test('rejects an empty email when restricted (e.g. provider without verified email)', async () => {
    const invite = makeInvite({ allowedDomains: 'example.com' })
    await expect(checkInvite(ctx, invite, '')).rejects.toThrow()
  })

  describe('without a mail service', () => {
    beforeEach(() => {
      setMetadata(accountPlugin.metadata.MAIL_URL, '')
    })

    test('refuses a domain restricted invite even for an allowed address', async () => {
      const invite = makeInvite({ allowedDomains: 'example.com' })
      await expect(checkInvite(ctx, invite, 'user@example.com')).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.EmailVerificationUnavailable, {}))
      )
    })

    test('keeps accepting invites without a domain restriction', async () => {
      await expect(checkInvite(ctx, makeInvite(), 'user@anything.test')).resolves.toBe(workspaceUuid)
    })
  })
})
