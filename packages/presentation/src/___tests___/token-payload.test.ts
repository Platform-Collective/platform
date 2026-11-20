// SPDX-License-Identifier: EPL-2.0

import { decodeTokenPayload } from '../utils'

jest.mock('@hcengineering/ui', () => ({ getRawCurrentLocation: () => ({ path: [] }), workspaceId: undefined }))
jest.mock('svelte/store', () => jest.requireActual('../__mocks__/svelte-store'))

describe('token payload decoding for session logout', () => {
  const payload = { account: 'account', exp: 123, extra: { authMethod: 'oidc', label: '>>>???' } }

  test('retains OIDC expiry metadata in an unpadded base64url payload', () => {
    const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(encoded).toContain('-')
    expect(encoded).toContain('_')
    expect(decodeTokenPayload(`header.${encoded}.signature`)).toEqual(payload)
  })

  test('continues to accept standard base64 payloads', () => {
    expect(decodeTokenPayload(`header.${btoa(JSON.stringify(payload))}.signature`)).toEqual(payload)
  })
})
