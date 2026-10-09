// SPDX-License-Identifier: EPL-2.0

// OAuth state is signed by pod-gitlab (POST /api/v1/authorize-url); the front never builds it.
export function serviceUrl (base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/api/v1/${path}`
}

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

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/** Parses a pod response; throws with the pod's `error` field, or `HTTP <status>` when the body is not a JSON object. */
export function parseServiceResponse (status: number, ok: boolean, text: string): Record<string, unknown> {
  let body: unknown
  if (text.trim() === '') {
    body = {}
  } else {
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
  }
  if (!ok) {
    const error = isRecord(body) ? body.error : undefined
    throw new Error(typeof error === 'string' && error !== '' ? error : `HTTP ${status}`)
  }
  if (!isRecord(body)) {
    throw new Error(`HTTP ${status}`)
  }
  return body
}

export const GITLAB_COM = 'https://gitlab.com'

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|.+\.local)$/

function trimTrailingSlashes (value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Client-side mirror of the pod's GitLab URL rules, for inline feedback only (the pod stays authoritative):
 * `https://…`, or `http://` for localhost, 127.0.0.1 and `*.local`; a sub-path is allowed; no query, fragment or credentials.
 */
export function isValidHostInput (raw: string): boolean {
  const value = trimTrailingSlashes(raw.trim())
  if (value === '' || value.includes('?') || value.includes('#')) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const httpAllowed = url.protocol === 'http:' && LOCAL_HOST.test(url.hostname)
  return (url.protocol === 'https:' || httpAllowed) && url.username === '' && url.password === ''
}

export interface ApplicationLinks {
  user: string
  admin: string
  groupHint: string
}

/** GitLab pages where an OAuth application can be registered, under the given (possibly sub-path) host. */
export function applicationLinks (host: string): ApplicationLinks {
  const base = trimTrailingSlashes(host.trim())
  return {
    user: `${base}/-/user_settings/applications`,
    admin: `${base}/admin/applications`,
    groupHint: `${base}/groups/<your-group>/-/settings/applications`
  }
}

/** A project can be linked to `integrationId` unless it actively belongs to another existing GitLab integration. */
export function isLinkableProject (
  mixin: { integration?: string, repositories?: string[] } | undefined,
  integrationId: string,
  existingIntegrationIds: ReadonlySet<string>
): boolean {
  if (mixin?.integration === undefined || mixin.integration === integrationId) return true
  // A dangling owner (deleted integration) or an owner that links no repositories does not block linking.
  return !existingIntegrationIds.has(mixin.integration) || (mixin.repositories ?? []).length === 0
}
