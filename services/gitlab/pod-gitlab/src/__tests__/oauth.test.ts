// SPDX-License-Identifier: EPL-2.0
import {
  buildAuthorizeUrl,
  exchangeCode,
  GitlabOAuthError,
  isTokenExpired,
  refreshTokens,
  revokeToken
} from '../gitlab/oauth'
import type { FetchFn } from '../gitlab/api'
import { signState, verifyState } from '../state'
import { createHmac } from 'crypto'

const cfg = {
  GitlabHost: 'https://gitlab.com',
  ClientID: 'cid',
  ClientSecret: 'cs',
  RedirectURI: 'http://front/gitlab'
}

function tokenFetch (status: number, body: unknown): { fn: FetchFn, bodies: string[] } {
  const bodies: string[] = []
  const fn = (async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response(JSON.stringify(body), { status })
  }) as unknown as FetchFn
  return { fn, bodies }
}

describe('oauth', () => {
  it('builds the authorize url', () => {
    const url = new URL(buildAuthorizeUrl(cfg, 'abc'))
    expect(url.origin + url.pathname).toBe('https://gitlab.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('http://front/gitlab')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('api read_user')
    expect(url.searchParams.get('state')).toBe('abc')
  })

  it('exchanges a code and computes expiresAt from created_at', async () => {
    const { fn, bodies } = tokenFetch(200, {
      access_token: 'a',
      token_type: 'Bearer',
      expires_in: 7200,
      refresh_token: 'r',
      created_at: 1000,
      scope: 'api read_user'
    })
    const tokens = await exchangeCode(cfg, 'code1', fn)
    expect(tokens).toEqual({ token: 'a', refreshToken: 'r', expiresAt: 8200, scope: 'api read_user' })
    const sent = new URLSearchParams(bodies[0])
    expect(sent.get('grant_type')).toBe('authorization_code')
    expect(sent.get('code')).toBe('code1')
    expect(sent.get('redirect_uri')).toBe('http://front/gitlab')
  })

  it('revokes a token with the application credentials', async () => {
    const { fn, bodies } = tokenFetch(200, {})
    await revokeToken(cfg, 'tok', fn)
    const sent = new URLSearchParams(bodies[0])
    expect(sent.get('token')).toBe('tok')
    expect(sent.get('client_id')).toBe('cid')
    expect(sent.get('client_secret')).toBe('cs')
  })

  it('reports a refused revocation', async () => {
    const { fn } = tokenFetch(500, {})
    await expect(revokeToken(cfg, 'tok', fn)).rejects.toBeInstanceOf(GitlabOAuthError)
  })

  it('separates the state signature from other uses of the server secret', () => {
    const raw = signState({ workspace: 'ws' as any, account: 'a', accountId: 'p' as any }, 'secret', 1000)
    const [data, signature] = raw.split('.')
    expect(signature).toBe(createHmac('sha256', 'secret').update(`gitlab-oauth-state:v1:${data}`).digest('base64url'))
  })

  it('refreshes with grant_type refresh_token', async () => {
    const { fn, bodies } = tokenFetch(200, {
      access_token: 'b',
      token_type: 'Bearer',
      expires_in: 7200,
      refresh_token: 'r2',
      created_at: 2000,
      scope: 'api'
    })
    const tokens = await refreshTokens(cfg, 'r1', fn)
    expect(tokens.refreshToken).toBe('r2')
    const sent = new URLSearchParams(bodies[0])
    expect(sent.get('grant_type')).toBe('refresh_token')
    expect(sent.get('refresh_token')).toBe('r1')
  })

  it('raises GitlabOAuthError with the provider description', async () => {
    const { fn } = tokenFetch(400, {
      error: 'invalid_grant',
      error_description: 'The provided authorization grant is invalid'
    })
    await expect(exchangeCode(cfg, 'bad', fn)).rejects.toThrow(
      new GitlabOAuthError('The provided authorization grant is invalid')
    )
  })

  it('cuts a long provider description to 200 characters', async () => {
    const { fn } = tokenFetch(400, { error: 'invalid_grant', error_description: 'z'.repeat(1000) })
    const err = (await exchangeCode(cfg, 'bad', fn).catch((e: unknown) => e)) as Error
    expect(err.message).toBe('z'.repeat(200))
  })

  it('isTokenExpired respects skew and null expiry', () => {
    expect(isTokenExpired({ expiresAt: null }, 10_000)).toBe(false)
    expect(isTokenExpired({ expiresAt: 1000 }, 900)).toBe(false)
    expect(isTokenExpired({ expiresAt: 1000 }, 950)).toBe(true)
  })
})

describe('signed OAuth state', () => {
  const payload = { workspace: 'ws1' as any, account: 'acc1', accountId: 'p1' as any }

  it('round-trips and does not contain secrets', () => {
    const raw = signState(payload, 'secret', 1000)
    expect(raw).not.toContain('secret')
    expect(verifyState(raw, 'secret', 2000)).toMatchObject({ ...payload, exp: 1000 + 10 * 60 * 1000 })
  })

  it('produces a fresh nonce each time', () => {
    expect(signState(payload, 'secret', 1000)).not.toBe(signState(payload, 'secret', 1000))
  })

  it('rejects a wrong secret or tampered payload', () => {
    const raw = signState(payload, 'secret', 1000)
    expect(() => verifyState(raw, 'other', 2000)).toThrow('Invalid OAuth state')
    const [data, sig] = raw.split('.')
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64url').toString()), account: 'evil' })
    ).toString('base64url')
    expect(() => verifyState(`${forged}.${sig}`, 'secret', 2000)).toThrow('Invalid OAuth state')
  })

  it('rejects garbage and expired state', () => {
    expect(() => verifyState('%%%', 'secret', 0)).toThrow('Invalid OAuth state')
    expect(() => verifyState('a.b.c', 'secret', 0)).toThrow('Invalid OAuth state')
    const raw = signState(payload, 'secret', 1000)
    expect(() => verifyState(raw, 'secret', 1000 + 10 * 60 * 1000)).toThrow('OAuth state expired')
  })
})

describe('signed OAuth state redirect', () => {
  const payload = { workspace: 'ws1' as any, account: 'acc1', accountId: 'p1' as any }

  it('carries the redirect URI the flow started with', () => {
    const raw = signState({ ...payload, redirectUri: 'https://huly.example.com/gitlab' }, 'secret', 1000)
    expect(verifyState(raw, 'secret', 2000).redirectUri).toBe('https://huly.example.com/gitlab')
  })

  it('rejects a state whose redirect URI is not a string', () => {
    const data = Buffer.from(JSON.stringify({ ...payload, redirectUri: 5, nonce: 'n', exp: 9e15 })).toString(
      'base64url'
    )
    const sig = createHmac('sha256', 'secret').update(data).digest('base64url')
    expect(() => verifyState(`${data}.${sig}`, 'secret', 2000)).toThrow('Invalid OAuth state')
  })
})
