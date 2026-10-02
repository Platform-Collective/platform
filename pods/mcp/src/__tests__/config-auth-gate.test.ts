// SPDX-License-Identifier: EPL-2.0

import { isLoopbackHost, loadConfig } from '../config'
import { fakeEnv } from './test-doubles'

/**
 * The reachability gate for `configured` mode.
 *
 * In that mode the pod holds a real Huly credential and the caller supplies
 * none, so the endpoint's only protection is who can open a socket to it. A
 * listener on a routable interface with no shared secret would hand that
 * credential to anyone who found the port.
 */
const configured = (env: Record<string, string> = {}): NodeJS.ProcessEnv =>
  fakeEnv({ SECRET: 'not-the-default', HULY_TOKEN: 'static-huly-token', ...env })

describe('configured-mode reachability gate', () => {
  it('refuses to start on a routable host with no shared secret', () => {
    expect(() => loadConfig(configured({ HOST: '0.0.0.0' }))).toThrow(/MCP_ALLOWED_TOKENS/)
  })

  it('names the two ways out of the failure so it is actionable', () => {
    expect(() => loadConfig(configured({ HOST: '0.0.0.0' }))).toThrow(/MCP_ALLOWED_TOKENS[\s\S]*127\.0\.0\.1/)
  })

  it('starts when an allowlist supplies the shared secret', () => {
    const config = loadConfig(configured({ HOST: '0.0.0.0', MCP_ALLOWED_TOKENS: 'client-secret' }))
    expect(config.AllowedTokens).toEqual(['client-secret'])
  })

  it.each(['127.0.0.1', 'localhost', '::1', '[::1]'])('starts on loopback host %s without an allowlist', (host) => {
    expect(loadConfig(configured({ HOST: host })).Host).toBe(host)
  })

  it('still requires the secret when an allowlist is present', () => {
    expect(() => loadConfig(fakeEnv({ HULY_TOKEN: 'x', MCP_ALLOWED_TOKENS: 'y', HOST: '0.0.0.0' }))).toThrow(
      /SECRET must be set/
    )
  })

  it('does not apply to perRequest mode, where every caller brings its own token', () => {
    const config = loadConfig(fakeEnv({ SECRET: 'not-the-default', HOST: '0.0.0.0' }))
    expect(config.AuthMode).toBe('perRequest')
    expect(config.AllowedTokens).toEqual([])
  })
})

describe('isLoopbackHost', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.0.0.53', false],
    ['localhost', true],
    ['LOCALHOST', true],
    ['::1', true],
    ['[::1]', true],
    ['0.0.0.0', false],
    ['::', false],
    ['192.168.1.10', false],
    ['example.internal', false],
    ['', false]
  ])('classifies %s as loopback=%s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected)
  })
})
