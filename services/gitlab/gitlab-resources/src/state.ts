// SPDX-License-Identifier: EPL-2.0

import { isRecord } from './service'

// OAuth state is signed by pod-gitlab (POST /api/v1/authorize-url); the front never builds it.

/**
 * The OAuth landing tab (/gitlab) has no Huly session, so it never calls the pod itself.
 * It hands the callback to the opener (Connect dialog) over this same-origin channel;
 * nothing secret is stored or broadcast (the code is single-use and bound to the signed state).
 */
export const OAUTH_CHANNEL = 'gitlab-oauth'
export const OAUTH_RESULT_TIMEOUT_MS = 30 * 1000

export interface OAuthCallbackMessage {
  type: 'gitlab-oauth-callback'
  code: string
  state: string
}

export interface OAuthErrorMessage {
  type: 'gitlab-oauth-error'
  error: string
  description?: string
}

export interface OAuthResultMessage {
  type: 'gitlab-oauth-result'
  state: string
  ok: boolean
  error?: string
}

export function oauthCallbackMessage (code: string, state: string): OAuthCallbackMessage {
  return { type: 'gitlab-oauth-callback', code, state }
}

export function oauthErrorMessage (error: string, description?: string): OAuthErrorMessage {
  return description === undefined
    ? { type: 'gitlab-oauth-error', error }
    : { type: 'gitlab-oauth-error', error, description }
}

export function oauthResultMessage (state: string, ok: boolean, error?: string): OAuthResultMessage {
  return error === undefined
    ? { type: 'gitlab-oauth-result', state, ok }
    : { type: 'gitlab-oauth-result', state, ok, error }
}

function isOptionalString (value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

export function isOAuthCallbackMessage (value: unknown): value is OAuthCallbackMessage {
  return (
    isRecord(value) &&
    value.type === 'gitlab-oauth-callback' &&
    typeof value.code === 'string' &&
    typeof value.state === 'string'
  )
}

export function isOAuthErrorMessage (value: unknown): value is OAuthErrorMessage {
  return (
    isRecord(value) &&
    value.type === 'gitlab-oauth-error' &&
    typeof value.error === 'string' &&
    isOptionalString(value.description)
  )
}

export function isOAuthResultMessage (value: unknown): value is OAuthResultMessage {
  return (
    isRecord(value) &&
    value.type === 'gitlab-oauth-result' &&
    typeof value.state === 'string' &&
    typeof value.ok === 'boolean' &&
    isOptionalString(value.error)
  )
}

/** Remembers the states this dialog requested; each one is accepted once, unknown states never. */
export class OAuthCallbackTracker {
  private readonly pending = new Set<string>()

  expect (state: string): void {
    this.pending.add(state)
  }

  accept (msg: Pick<OAuthCallbackMessage, 'state'>): boolean {
    return this.pending.delete(msg.state)
  }
}

export function stateFromAuthorizeUrl (url: string): string | undefined {
  try {
    const state = new URL(url).searchParams.get('state')
    return state === null || state === '' ? undefined : state
  } catch {
    return undefined
  }
}
