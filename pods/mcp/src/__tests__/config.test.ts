// SPDX-License-Identifier: EPL-2.0

import { loadConfig } from '../config'
import { fakeEnv } from './test-doubles'

describe('loadConfig secret handling', () => {
  it('refuses to start without a secret', () => {
    expect(() => loadConfig(fakeEnv())).toThrow(/SECRET must be set/)
  })

  it('refuses the well-known default secret', () => {
    expect(() => loadConfig(fakeEnv({ SECRET: 'secret' }))).toThrow(/well-known default/)
  })

  it('accepts the default secret only when a dev stack opts in explicitly', () => {
    const config = loadConfig(fakeEnv({ SECRET: 'secret', MCP_ALLOW_DEFAULT_SECRET: 'true' }))
    expect(config.Secret).toBe('secret')
  })

  it('accepts a real secret and reads the collaborator url', () => {
    const config = loadConfig(fakeEnv({ SECRET: 'a-real-one', COLLABORATOR_URL: 'http://collab:3078' }))
    expect(config.CollaboratorUrl).toBe('http://collab:3078')
    expect(config.AllowDefaultSecret).toBe(false)
  })
})

describe('loadConfig allowed origins', () => {
  it('defaults to an empty allowlist, which fails closed for browsers', () => {
    expect(loadConfig(fakeEnv({ SECRET: 'a-real-one' })).AllowedOrigins).toEqual([])
  })

  it('splits a comma separated list and trims whitespace', () => {
    const config = loadConfig(
      fakeEnv({ SECRET: 'a-real-one', MCP_ALLOWED_ORIGINS: 'http://localhost:5173, https://huly.example.com,' })
    )
    expect(config.AllowedOrigins).toEqual(['http://localhost:5173', 'https://huly.example.com'])
  })
})
