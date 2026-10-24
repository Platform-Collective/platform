// SPDX-License-Identifier: EPL-2.0

import { AccountRole, type AccountUuid, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import { decodeToken, generateToken, TokenError } from '@hcengineering/server-token'
import { createAuthCookie } from '../auth-cookie'

const account = '11111111-1111-4111-8111-111111111111' as AccountUuid
const workspace = '22222222-2222-4222-8222-222222222222' as WorkspaceUuid
const ctx = { warn: jest.fn() } as unknown as MeasureContext

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(1700000000123)
})
afterEach(() => {
  jest.useRealTimers()
})

test('cookie retains lifetime and account, drops workspace/sub/grant', () => {
  const exp = 1700000120
  const nbf = 1700000000
  const source = generateToken(account, workspace, { authMethod: 'oidc', admin: 'true' }, undefined, {
    exp,
    nbf,
    sub: account,
    grant: { workspace, role: AccountRole.Guest }
  })
  const cookie = createAuthCookie(ctx, source)
  expect(cookie.maxAge).toBe(119877)
  expect(decodeToken(cookie.token)).toEqual({ account, exp, nbf, extra: { authMethod: 'oidc', admin: 'true' } })
})

test('legacy cookie is byte-identical with the same one-year lifetime', () => {
  const cookie = createAuthCookie(ctx, generateToken(account, workspace, {}))
  expect(cookie.token).toBe(generateToken(account, undefined, {}))
  expect(cookie.maxAge).toBe(31536000000)
})

test('long finite tokens never extend the cookie beyond one year', () => {
  const cookie = createAuthCookie(ctx, generateToken(account, undefined, {}, undefined, { exp: 1800000000 }))
  expect(cookie.maxAge).toBe(31536000000)
})

test.each([1700000000, 1699999999])('expired tokens, including exact expiry, are rejected for HTTP 401: %s', (exp) => {
  jest.setSystemTime(1700000000000)
  expect(() => createAuthCookie(ctx, generateToken(account, undefined, {}, undefined, { exp }))).toThrow(TokenError)
})
