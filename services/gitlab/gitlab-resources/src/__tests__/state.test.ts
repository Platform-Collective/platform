// SPDX-License-Identifier: EPL-2.0
import {
  OAuthCallbackTracker,
  isOAuthCallbackMessage,
  isOAuthErrorMessage,
  isOAuthResultMessage,
  oauthCallbackMessage,
  oauthErrorMessage,
  oauthResultMessage,
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
      expect({ value, callbackOk, resultOk, errorOk }).toEqual({
        value,
        callbackOk: false,
        resultOk: false,
        errorOk: false
      })
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
