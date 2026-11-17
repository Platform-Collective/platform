//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// SPDX-License-Identifier: EPL-2.0
//

import {
  createAuthStateNonce,
  encodeState,
  safeParseAuthState,
  setAuthStateTokenCookie,
  shouldUseSecureAuthStateCookie,
  validateAuthStateTokenCookie
} from '../utils'

describe('authentication state token', () => {
  test('adds a cryptographic nonce to the state passed to the identity provider', () => {
    const nonce = createAuthStateNonce()
    const state = safeParseAuthState(encodeState({ query: {}, request: { headers: {} } }, {}, nonce))

    expect(nonce).toMatch(/^[0-9a-f-]{36}$/)
    expect(state.nonce).toBe(nonce)
  })

  test('uses a signed, httpOnly Lax cookie and forces Secure only for this cookie writer', () => {
    const cookies = { set: jest.fn() }
    setAuthStateTokenCookie({ cookies }, 'nonce', true)

    expect(cookies.set).toHaveBeenCalledWith('auth_state_token', 'nonce', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      signed: true,
      maxAge: 10 * 60 * 1000
    })
  })

  test('rejects a state mismatch, missing cookie, and replay after consuming the cookie', () => {
    const cookies = { get: jest.fn().mockReturnValueOnce('nonce').mockReturnValue(undefined), set: jest.fn() }
    const ctx = { cookies }

    expect(validateAuthStateTokenCookie(ctx, 'nonce', false)).toEqual({ valid: true })
    expect(validateAuthStateTokenCookie(ctx, 'nonce', false)).toEqual({ valid: false, reason: 'missing_cookie' })
    expect(
      validateAuthStateTokenCookie(
        { cookies: { get: jest.fn().mockReturnValue('other-nonce'), set: jest.fn() } },
        'nonce',
        false
      )
    ).toEqual({ valid: false, reason: 'mismatch' })
    expect(validateAuthStateTokenCookie({ cookies: { get: jest.fn(), set: jest.fn() } }, undefined, false)).toEqual({
      valid: false,
      reason: 'missing_nonce'
    })
    expect(cookies.get).toHaveBeenCalledWith('auth_state_token', { signed: true })
    expect(cookies.set).toHaveBeenNthCalledWith(
      1,
      'auth_state_token',
      null,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', signed: true, secure: false })
    )
  })

  test.each([
    ['https://accounts.example.com', undefined, true],
    ['http://accounts.example.com', undefined, false],
    ['http://accounts.example.com', 'true', true],
    ['https://accounts.example.com', 'false', false]
  ])(
    'derives Secure from the public accounts URL unless SESSION_COOKIE_SECURE=%p',
    (accountsUrl, envValue, expected) => {
      expect(shouldUseSecureAuthStateCookie(accountsUrl, envValue)).toBe(expected)
    }
  )
})
