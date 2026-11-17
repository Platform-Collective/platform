//
// Copyright © 2024 Hardcore Engineering, Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
import { AccountDB, joinWithProvider, LoginInfo, loginOrSignUpWithProvider } from '@hcengineering/account'
import {
  BrandingMap,
  concatLink,
  getBranding,
  MeasureContext,
  normalizeExternalAvatarUrl,
  SocialKey
} from '@hcengineering/core'
import { randomUUID } from 'crypto'
import { IncomingHttpHeaders } from 'http'
import qs from 'querystringify'

const AUTH_STATE_TOKEN_COOKIE = 'auth_state_token'
const AUTH_STATE_TOKEN_MAX_AGE_MS = 10 * 60 * 1000

export type AuthStateRejectReason = 'missing_cookie' | 'missing_nonce' | 'mismatch'

export interface AuthStateTokenValidation {
  valid: boolean
  reason?: AuthStateRejectReason
}

export function getHost (headers: IncomingHttpHeaders): string | undefined {
  let host: string | undefined
  const origin = headers.origin ?? headers.referer
  if (origin !== undefined) {
    host = new URL(origin).host
  }

  return host
}

export interface AuthState {
  inviteId?: string
  branding?: string
  autoJoin?: boolean
  navigateUrl?: string
  nonce?: string
}

export function safeParseAuthState (rawState: string | undefined): AuthState {
  if (rawState == null) {
    return {}
  }

  try {
    return JSON.parse(decodeURIComponent(rawState))
  } catch {
    return {}
  }
}

export function createAuthStateNonce (): string {
  return randomUUID()
}

export function encodeState (ctx: any, brandings: BrandingMap, nonce?: string): string {
  const host = getHost(ctx.request.headers)
  const branding = host !== undefined ? (brandings[host]?.key ?? undefined) : undefined
  const state: AuthState = {
    inviteId: ctx.query?.inviteId,
    branding,
    autoJoin: ctx.query?.autoJoin !== undefined,
    navigateUrl: ctx.query?.navigateUrl,
    nonce
  }

  return encodeURIComponent(JSON.stringify(state))
}

/**
 * Picks the avatar URL from a provider profile: the OIDC `picture` claim, or the first
 * entry of the passport `photos` list (Google, GitHub). Only http(s) URLs are returned.
 */
export function getProviderAvatarUrl (user: any): string | undefined {
  if (user == null || typeof user !== 'object') return undefined
  const candidates = [user.picture, Array.isArray(user.photos) ? user.photos[0]?.value : undefined]
  for (const candidate of candidates) {
    const url = normalizeExternalAvatarUrl(candidate)
    if (url !== undefined) return url
  }
  return undefined
}

function parseSessionCookieSecure (value: string | undefined): boolean | undefined {
  switch (value?.trim().toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
      return true
    case 'false':
    case '0':
    case 'no':
      return false
    default:
      return undefined
  }
}

export function shouldUseSecureAuthStateCookie (
  accountsUrl: string,
  sessionCookieSecure: string | undefined = process.env.SESSION_COOKIE_SECURE
): boolean {
  const configuredValue = parseSessionCookieSecure(sessionCookieSecure)
  if (configuredValue !== undefined) return configuredValue

  try {
    return new URL(accountsUrl).protocol === 'https:'
  } catch {
    return false
  }
}

function authStateTokenCookieOptions (
  secure: boolean,
  maxAge?: number
): {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  signed: true
  maxAge?: number
} {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    signed: true,
    ...(maxAge !== undefined ? { maxAge } : {})
  }
}

function setAuthStateTokenCookieValue (ctx: any, value: string | null, secure: boolean, maxAge?: number): void {
  const setCookie = (): void => {
    ctx.cookies.set(AUTH_STATE_TOKEN_COOKIE, value, authStateTokenCookieOptions(secure, maxAge))
  }

  if (!secure || ctx.cookies.secure === true) {
    setCookie()
    return
  }

  const currentSecure = ctx.cookies.secure
  ctx.cookies.secure = true
  try {
    setCookie()
  } finally {
    ctx.cookies.secure = currentSecure
  }
}

export function setAuthStateTokenCookie (ctx: any, nonce: string, secure: boolean): void {
  setAuthStateTokenCookieValue(ctx, nonce, secure, AUTH_STATE_TOKEN_MAX_AGE_MS)
}

export function validateAuthStateTokenCookie (
  ctx: any,
  expectedNonce: string | undefined,
  secure: boolean
): AuthStateTokenValidation {
  const nonce = ctx.cookies.get(AUTH_STATE_TOKEN_COOKIE, { signed: true })
  setAuthStateTokenCookieValue(ctx, null, secure)

  if (expectedNonce === undefined) return { valid: false, reason: 'missing_nonce' }
  if (nonce === undefined) return { valid: false, reason: 'missing_cookie' }
  if (nonce !== expectedNonce) return { valid: false, reason: 'mismatch' }
  return { valid: true }
}

export async function handleProviderAuth (
  measureCtx: MeasureContext,
  db: AccountDB,
  brandings: BrandingMap,
  frontUrl: string,
  providerType: string,
  rawState: string | undefined,
  user: any,
  email: string | undefined,
  first: string,
  last: string,
  socialKey: SocialKey,
  signUpDisabled: boolean | undefined
): Promise<string> {
  try {
    measureCtx.info('Provider auth handler', { email, type: providerType })
    let loginInfo: LoginInfo | null
    const state = safeParseAuthState(rawState)
    const branding = getBranding(brandings, state?.branding)
    const avatarUrl = getProviderAvatarUrl(user)

    if (state.inviteId != null && state.inviteId !== '' && state.autoJoin !== true) {
      loginInfo = await joinWithProvider(
        measureCtx,
        db,
        null,
        email,
        first,
        last,
        state.inviteId,
        socialKey,
        signUpDisabled,
        avatarUrl
      )
    } else {
      loginInfo = await loginOrSignUpWithProvider(
        measureCtx,
        db,
        null,
        email,
        first,
        last,
        socialKey,
        signUpDisabled === true || state.autoJoin === true,
        avatarUrl
      )
    }

    if (loginInfo === null) {
      measureCtx.info('Failed to auth: no associated account found', {
        email,
        type: providerType,
        user
      })
      return concatLink(branding?.front ?? frontUrl, '/login')
    } else {
      const origin = concatLink(branding?.front ?? frontUrl, '/login/auth')
      const queryObj: any = { token: loginInfo.token }
      if (state.autoJoin === true) {
        queryObj.autoJoin = state.autoJoin
        queryObj.inviteId = state.inviteId
        queryObj.navigateUrl = state.navigateUrl
      }

      const query = encodeURIComponent(qs.stringify(queryObj))

      // Successful authentication, redirect to your application
      measureCtx.info('Success auth, redirect', { email, type: providerType, target: origin })
      return `${origin}?${query}`
    }
  } catch (err: any) {
    measureCtx.error('failed to auth', { err, type: providerType, user })
    return ''
  }
}
