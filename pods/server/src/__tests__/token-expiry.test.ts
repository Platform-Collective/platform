// SPDX-License-Identifier: EPL-2.0

import { type AccountUuid } from '@hcengineering/core'
import { decodeToken, generateToken } from '@hcengineering/server-token'
import { isExpiredOidcTokenError } from '../token-expiry'

const account = '11111111-1111-4111-8111-111111111111' as AccountUuid

function failsWithTermination (token: string): boolean {
  try {
    decodeToken(token)
    return false
  } catch (err) {
    return isExpiredOidcTokenError(err, token)
  }
}

test('only an expired, signed OIDC session gets a terminating handshake', () => {
  const exp = Math.floor(Date.now() / 1000) - 1
  expect(failsWithTermination(generateToken(account, undefined, { authMethod: 'oidc' }, undefined, { exp }))).toBe(true)
  const badSignature = generateToken(account, undefined, { authMethod: 'oidc' }, 'wrong-secret', { exp })
  expect(failsWithTermination(badSignature)).toBe(false)
  expect(failsWithTermination(generateToken(account, undefined, { apiTokenId: 'api' }, undefined, { exp }))).toBe(false)
  expect(failsWithTermination(generateToken(account, undefined, { authMethod: 'oidc' }))).toBe(false)
  const future = generateToken(account, undefined, { authMethod: 'oidc' }, undefined, { exp: exp + 120 })
  expect(failsWithTermination(future)).toBe(false)
  expect(failsWithTermination('malformed')).toBe(false)
})
