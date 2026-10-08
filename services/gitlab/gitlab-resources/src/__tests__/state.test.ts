// SPDX-License-Identifier: EPL-2.0
import {
  OAuthCallbackTracker,
  applicationLinks,
  isLinkableProject,
  isValidHostInput,
  isOAuthCallbackMessage,
  isOAuthErrorMessage,
  isOAuthResultMessage,
  oauthCallbackMessage,
  oauthErrorMessage,
  oauthResultMessage,
  parseServiceResponse,
  serviceUrl,
  stateFromAuthorizeUrl
} from '../state'

const garbage: unknown[] = [
  undefined,
  null,
  0,
  'gitlab-oauth-callback',
  [],
  {},
  { type: 'other', code: 'c', state: 's' },
  { type: 'gitlab-oauth-callback' },
  { type: 'gitlab-oauth-callback', code: 1, state: 's' },
  { type: 'gitlab-oauth-callback', code: 'c', state: null },
  { type: 'gitlab-oauth-result', state: 's' },
  { type: 'gitlab-oauth-result', state: 's', ok: 'yes' },
  { type: 'gitlab-oauth-result', state: 5, ok: true },
  { type: 'gitlab-oauth-result', state: 's', ok: false, error: 42 },
  { type: 'gitlab-oauth-error', error: 1 }
]

describe('serviceUrl', () => {
  it('joins service url and path without double slashes', () => {
    expect(serviceUrl('http://pod:3600/', 'auth')).toBe('http://pod:3600/api/v1/auth')
    expect(serviceUrl('http://pod:3600', 'repository-enable')).toBe('http://pod:3600/api/v1/repository-enable')
  })
})

describe('oauth broadcast messages', () => {
  it('builds messages that pass their own guard only', () => {
    const callback = oauthCallbackMessage('c', 's')
    const result = oauthResultMessage('s', false, 'boom')
    const error = oauthErrorMessage('access_denied', 'The user denied access')
    expect(callback).toEqual({ type: 'gitlab-oauth-callback', code: 'c', state: 's' })
    expect(result).toEqual({ type: 'gitlab-oauth-result', state: 's', ok: false, error: 'boom' })
    expect(error).toEqual({ type: 'gitlab-oauth-error', error: 'access_denied', description: 'The user denied access' })
    expect(isOAuthCallbackMessage(callback)).toBe(true)
    expect(isOAuthResultMessage(callback)).toBe(false)
    expect(isOAuthResultMessage(result)).toBe(true)
    expect(isOAuthCallbackMessage(result)).toBe(false)
    expect(isOAuthErrorMessage(error)).toBe(true)
    expect(isOAuthCallbackMessage(error)).toBe(false)
  })

  it('omits an undefined error from a successful result', () => {
    expect(oauthResultMessage('s', true)).toEqual({ type: 'gitlab-oauth-result', state: 's', ok: true })
    expect(isOAuthResultMessage(oauthResultMessage('s', true))).toBe(true)
  })

  it('rejects garbage input', () => {
    for (const value of garbage) {
      const callbackOk = isOAuthCallbackMessage(value)
      const resultOk = isOAuthResultMessage(value)
      const errorOk = isOAuthErrorMessage(value)
      expect({ value, callbackOk, resultOk, errorOk }).toEqual({ value, callbackOk: false, resultOk: false, errorOk: false })
    }
  })
})

describe('OAuthCallbackTracker', () => {
  it('accepts an expected state exactly once', () => {
    const tracker = new OAuthCallbackTracker()
    tracker.expect('s1')
    expect(tracker.accept(oauthCallbackMessage('c', 's1'))).toBe(true)
    expect(tracker.accept(oauthCallbackMessage('c', 's1'))).toBe(false)
  })

  it('rejects a state it did not request', () => {
    const tracker = new OAuthCallbackTracker()
    expect(tracker.accept(oauthCallbackMessage('c', 'unknown'))).toBe(false)
    tracker.expect('s1')
    expect(tracker.accept(oauthCallbackMessage('c', 'unknown'))).toBe(false)
    expect(tracker.accept(oauthCallbackMessage('c', 's1'))).toBe(true)
  })

  it('keeps several pending states independent', () => {
    const tracker = new OAuthCallbackTracker()
    tracker.expect('a')
    tracker.expect('b')
    expect(tracker.accept(oauthCallbackMessage('c', 'b'))).toBe(true)
    expect(tracker.accept(oauthCallbackMessage('c', 'a'))).toBe(true)
    expect(tracker.accept(oauthCallbackMessage('c', 'a'))).toBe(false)
  })
})

describe('stateFromAuthorizeUrl', () => {
  it('reads the state query parameter', () => {
    expect(stateFromAuthorizeUrl('https://gitlab.com/oauth/authorize?client_id=x&state=abc.def')).toBe('abc.def')
  })

  it('returns undefined without a state or for an invalid url', () => {
    expect(stateFromAuthorizeUrl('https://gitlab.com/oauth/authorize?client_id=x')).toBeUndefined()
    expect(stateFromAuthorizeUrl('https://gitlab.com/oauth/authorize?state=')).toBeUndefined()
    expect(stateFromAuthorizeUrl('not a url')).toBeUndefined()
  })
})

describe('parseServiceResponse', () => {
  it('returns the parsed body of an ok JSON response', () => {
    expect(parseServiceResponse(200, true, '{"url":"https://x"}')).toEqual({ url: 'https://x' })
  })

  it('throws the error field of an error JSON response', () => {
    expect(() => parseServiceResponse(403, false, '{"error":"Forbidden caller"}')).toThrow('Forbidden caller')
  })

  it('throws HTTP <status> for a non-JSON error response', () => {
    expect(() => parseServiceResponse(502, false, '<html><body>Bad Gateway</body></html>')).toThrow('HTTP 502')
  })

  it('handles an empty body', () => {
    expect(() => parseServiceResponse(500, false, '')).toThrow('HTTP 500')
    expect(parseServiceResponse(200, true, '')).toEqual({})
  })

  it('rejects an ok response that is not a JSON object', () => {
    expect(() => parseServiceResponse(200, true, '<html></html>')).toThrow('HTTP 200')
  })
})

describe('applicationLinks', () => {
  it('builds user and admin application pages under a sub-path host', () => {
    expect(applicationLinks('https://git.corp.local/gitlab/')).toEqual({
      user: 'https://git.corp.local/gitlab/-/user_settings/applications',
      admin: 'https://git.corp.local/gitlab/admin/applications',
      groupHint: 'https://git.corp.local/gitlab/groups/<your-group>/-/settings/applications'
    })
  })

  it('builds gitlab.com links', () => {
    expect(applicationLinks('https://gitlab.com').user).toBe('https://gitlab.com/-/user_settings/applications')
  })
})

describe('isValidHostInput', () => {
  it.each([
    ['https://gitlab.com', true],
    ['http://localhost:8929', true],
    ['http://gitlab.com', false],
    ['gitlab.com', false],
    ['', false],
    ['https://git.corp.local/gitlab/', true],
    ['http://git.corp.local', true],
    ['http://127.0.0.1:8080', true],
    ['https://gitlab.com/?x=1', false],
    ['https://gitlab.com/#top', false],
    ['https://user:pass@gitlab.com', false],
    ['ftp://gitlab.com', false]
  ])('%s -> %s', (raw, ok) => {
    expect(isValidHostInput(raw as string)).toBe(ok)
  })
})

describe('isLinkableProject', () => {
  const existing = new Set(['current', 'other'])

  it('accepts a project without the GitLab mixin', () => {
    expect(isLinkableProject(undefined, 'current', existing)).toBe(true)
  })

  it('accepts a project already owned by the same integration', () => {
    expect(isLinkableProject({ integration: 'current', repositories: ['r1'] }, 'current', existing)).toBe(true)
  })

  it('accepts a project pointing at a deleted integration with no repositories (live case)', () => {
    expect(isLinkableProject({ integration: 'gone', repositories: [] }, 'current', existing)).toBe(true)
  })

  it('accepts a project pointing at a deleted integration with dangling repositories', () => {
    expect(isLinkableProject({ integration: 'gone', repositories: ['r1'] }, 'current', existing)).toBe(true)
  })

  it('accepts a project of another existing integration that links no repositories', () => {
    expect(isLinkableProject({ integration: 'other', repositories: [] }, 'current', existing)).toBe(true)
    expect(isLinkableProject({ integration: 'other' }, 'current', existing)).toBe(true)
  })

  it('rejects a project actively linked to another existing integration', () => {
    expect(isLinkableProject({ integration: 'other', repositories: ['r1'] }, 'current', existing)).toBe(false)
  })
})
