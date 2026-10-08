// SPDX-License-Identifier: EPL-2.0

import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

export const STATE_TTL_MS = 10 * 60 * 1000

export interface OAuthStatePayload {
  workspace: WorkspaceUuid
  // Huly account uuid of the user who started the authorization
  account: string
  // Primary social id of that user
  accountId: PersonId
  // OAuth callback the flow started with; the code exchange must send the same one
  redirectUri?: string
}

export interface OAuthState extends OAuthStatePayload {
  nonce: string
  // Expiry, epoch milliseconds
  exp: number
}

function sign (data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function signState (payload: OAuthStatePayload, secret: string, nowMs: number): string {
  const state: OAuthState = { ...payload, nonce: randomBytes(16).toString('base64url'), exp: nowMs + STATE_TTL_MS }
  const data = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${data}.${sign(data, secret)}`
}

export function verifyState (raw: string, secret: string, nowMs: number): OAuthState {
  const [data, signature, extra] = raw.split('.')
  if (data === undefined || signature === undefined || extra !== undefined) {
    throw new Error('Invalid OAuth state')
  }
  const expected = Buffer.from(sign(data, secret))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('Invalid OAuth state')
  }
  let parsed: Partial<OAuthState> | null
  try {
    parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Invalid OAuth state')
  }
  if (
    typeof parsed?.workspace !== 'string' ||
    typeof parsed?.account !== 'string' ||
    typeof parsed?.accountId !== 'string' ||
    typeof parsed?.exp !== 'number' ||
    (parsed.redirectUri !== undefined && typeof parsed.redirectUri !== 'string')
  ) {
    throw new Error('Invalid OAuth state')
  }
  if (parsed.exp <= nowMs) {
    throw new Error('OAuth state expired')
  }
  return parsed as OAuthState
}
