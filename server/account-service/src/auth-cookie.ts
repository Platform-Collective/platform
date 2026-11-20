// SPDX-License-Identifier: EPL-2.0

import { reissueToken } from '@hcengineering/account'
import { type MeasureContext } from '@hcengineering/core'
import { decodeTokenVerbose, TokenError } from '@hcengineering/server-token'

const COOKIE_LIFETIME_MS = 1000 * 60 * 60 * 24 * 365

/** Removes workspace permissions while retaining the session deadline. */
export function createAuthCookie (ctx: MeasureContext, token: string): { token: string, maxAge: number } {
  const decoded = decodeTokenVerbose(ctx, token)
  const maxAge = Math.min(COOKIE_LIFETIME_MS, (decoded.exp ?? Infinity) * 1000 - Date.now())
  if (maxAge <= 0) throw new TokenError('Token expired')
  return { token: reissueToken(decoded), maxAge }
}
