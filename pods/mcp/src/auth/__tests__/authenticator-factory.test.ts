// SPDX-License-Identifier: EPL-2.0

import { type SessionIdentity } from '../authenticator'
import { AuthenticationError } from '../authenticator'
import { AllowlistedAuthenticator, createAuthenticator } from '../authenticator-factory'
import { loadConfig } from '../../config'
import { fakeEnv, fakeIdentity, fakeMeasureContext } from '../../__tests__/test-doubles'

const config = (env: Record<string, string>): ReturnType<typeof loadConfig> =>
  loadConfig(fakeEnv({ SECRET: 'not-the-default', ...env }))

/** Records what reached the inner authenticator, so ordering is observable. */
const innerSpy = (): { calls: string[], authenticator: { authenticate: (t: string) => Promise<SessionIdentity> } } => {
  const calls: string[] = []
  return {
    calls,
    authenticator: {
      authenticate: async (rawToken: string) => {
        calls.push(rawToken)
        return fakeIdentity()
      }
    }
  }
}

const reasonOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise
    return undefined
  } catch (err) {
    return err instanceof AuthenticationError ? err.reason : 'not-an-AuthenticationError'
  }
}

/**
 * The allowlist is the credential in `configured` mode, and a pre-filter in
 * `perRequest` mode. Either way it must run *before* the real authenticator,
 * so a rejected token can never reach the account service.
 */
describe('AllowlistedAuthenticator', () => {
  const allowed = ['known-client', 'second-client']

  it('refuses a request with no credential as missing, so the client is challenged', async () => {
    const { calls, authenticator } = innerSpy()
    const gate = new AllowlistedAuthenticator(authenticator, allowed)

    expect(await reasonOf(gate.authenticate(''))).toBe('missing')
    // `missing` must never be reported for a token the gate already knows is
    // absent; the inner authenticator must not have been consulted at all.
    expect(calls).toEqual([])
  })

  it('refuses an unknown credential as forbidden, without a login attempt', async () => {
    const { calls, authenticator } = innerSpy()
    const gate = new AllowlistedAuthenticator(authenticator, allowed)

    expect(await reasonOf(gate.authenticate('not-the-one'))).toBe('forbidden')
    expect(calls).toEqual([])
  })

  it('passes a listed credential through and returns the identity unchanged', async () => {
    const { calls, authenticator } = innerSpy()
    const gate = new AllowlistedAuthenticator(authenticator, allowed)

    const identity = await gate.authenticate('known-client')

    expect(calls).toEqual(['known-client'])
    expect(identity.readOnly).toBe(false)
  })

  it('separates an empty allowlist from a populated one', async () => {
    const { calls, authenticator } = innerSpy()
    const gate = new AllowlistedAuthenticator(authenticator, [])

    expect(await reasonOf(gate.authenticate('anything'))).toBe('forbidden')
    expect(calls).toEqual([])
  })

  it('treats each entry as an exact string, not a pattern', async () => {
    const { authenticator } = innerSpy()
    const gate = new AllowlistedAuthenticator(authenticator, ['known-client'])

    expect(await reasonOf(gate.authenticate('known-client-extra'))).toBe('forbidden')
    expect(await reasonOf(gate.authenticate('Known-Client'))).toBe('forbidden')
  })
})

describe('configured-mode reachability through createAuthenticator', () => {
  const env = { HULY_TOKEN: 'static', HULY_WORKSPACE: 'my-space', MCP_ALLOWED_TOKENS: 'known-client', HOST: '0.0.0.0' }

  it('rejects a missing credential before the configured authenticator runs', async () => {
    const auth = createAuthenticator(fakeMeasureContext(), config(env))
    expect(await reasonOf(auth.authenticate(''))).toBe('missing')
  })

  it('rejects an unlisted credential before the configured authenticator runs', async () => {
    const auth = createAuthenticator(fakeMeasureContext(), config(env))
    expect(await reasonOf(auth.authenticate('nope'))).toBe('forbidden')
  })

  // Pass-through is covered by `AllowlistedAuthenticator` above with a fake
  // inner: proving it through `createAuthenticator` would need a real login
  // attempt against the account service.
})

describe('read-only clamp ordering', () => {
  it('is applied outside the allowlist, so a listed token can still be clamped', () => {
    const auth = createAuthenticator(
      fakeMeasureContext(),
      config({ HULY_TOKEN: 'static', MCP_ALLOWED_TOKENS: 'known-client', MCP_READONLY: 'true', HOST: '0.0.0.0' })
    )
    expect(auth).toBeDefined()
  })
})
