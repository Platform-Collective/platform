// SPDX-License-Identifier: EPL-2.0

import { decodeToken, TokenError } from '@hcengineering/server-token'

/** Only configured OIDC sessions opt into immediate logout on an expired handshake. */
export function isExpiredOidcTokenError (err: unknown, token: string): boolean {
  if (!(err instanceof TokenError) || err.message !== 'Token expired') return false
  // The verified decode failed on expiry, after checking the signature. The
  // unverified payload is used only to choose the error response, never for access.
  try {
    return decodeToken(token, false).extra?.authMethod === 'oidc'
  } catch {
    return false
  }
}
