// SPDX-License-Identifier: EPL-2.0

import type { OAuthConfig } from '../config'
import { MAX_ERROR_SUMMARY, type FetchFn } from './api'
import type { GitlabTokenResponse } from './types'

export const GITLAB_SCOPES = 'api read_user'

export interface TokenSet {
  token: string
  refreshToken: string | null
  // Epoch seconds
  expiresAt: number | null
  scope: string
}

export class GitlabOAuthError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'GitlabOAuthError'
  }
}

export function buildAuthorizeUrl (cfg: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.ClientID,
    redirect_uri: cfg.RedirectURI,
    response_type: 'code',
    scope: GITLAB_SCOPES,
    state
  })
  return `${cfg.GitlabHost}/oauth/authorize?${params.toString()}`
}

export function isTokenExpired (tokens: Pick<TokenSet, 'expiresAt'>, nowSec: number, skewSec = 60): boolean {
  return tokens.expiresAt !== null && tokens.expiresAt - skewSec <= nowSec
}

function toTokenSet (resp: GitlabTokenResponse): TokenSet {
  return {
    token: resp.access_token,
    refreshToken: resp.refresh_token ?? null,
    expiresAt: resp.expires_in != null ? resp.created_at + resp.expires_in : null,
    scope: resp.scope
  }
}

async function postToken (cfg: OAuthConfig, params: Record<string, string>, fetchFn: FetchFn): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: cfg.ClientID,
    client_secret: cfg.ClientSecret,
    redirect_uri: cfg.RedirectURI,
    ...params
  })
  const res = await fetchFn(`${cfg.GitlabHost}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  })
  let json: Partial<GitlabTokenResponse> & { error?: string, error_description?: string }
  try {
    json = await res.json()
  } catch {
    throw new GitlabOAuthError(`GitLab token endpoint returned HTTP ${res.status}`)
  }
  if (!res.ok || json.error !== undefined || json.access_token === undefined) {
    // Shown to the user: GitLab's own short text only
    const text = json.error_description ?? json.error
    throw new GitlabOAuthError(
      typeof text === 'string' && text !== '' ? text.slice(0, MAX_ERROR_SUMMARY) : `HTTP ${res.status}`
    )
  }
  return toTokenSet(json as GitlabTokenResponse)
}

export async function exchangeCode (cfg: OAuthConfig, code: string, fetchFn: FetchFn): Promise<TokenSet> {
  return await postToken(cfg, { code, grant_type: 'authorization_code' }, fetchFn)
}

export async function refreshTokens (cfg: OAuthConfig, refreshToken: string, fetchFn: FetchFn): Promise<TokenSet> {
  return await postToken(cfg, { refresh_token: refreshToken, grant_type: 'refresh_token' }, fetchFn)
}

/** Revokes a token at GitLab (RFC 7009); the whole grant goes, its refresh token included. */
export async function revokeToken (
  cfg: Pick<OAuthConfig, 'GitlabHost' | 'ClientID' | 'ClientSecret'>,
  token: string,
  fetchFn: FetchFn
): Promise<void> {
  const res = await fetchFn(`${cfg.GitlabHost}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: cfg.ClientID, client_secret: cfg.ClientSecret, token })
  })
  await res.body?.cancel().catch(() => {})
  if (!res.ok) throw new GitlabOAuthError(`GitLab token revocation returned HTTP ${res.status}`)
}
