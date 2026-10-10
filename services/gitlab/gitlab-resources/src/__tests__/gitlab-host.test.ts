// SPDX-License-Identifier: EPL-2.0
import { applicationLinks, isValidHostInput, trimTrailingSlashes } from '../gitlab-host'

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
    expect(isValidHostInput(raw)).toBe(ok)
  })
})

describe('trimTrailingSlashes', () => {
  it('drops every trailing slash and nothing else', () => {
    expect(trimTrailingSlashes('https://x.example//')).toBe('https://x.example')
    expect(trimTrailingSlashes('https://x.example/a')).toBe('https://x.example/a')
  })
})
