// SPDX-License-Identifier: EPL-2.0
import { loadConfig, redirectUriFor, trimSlash } from '../config'

const base = {
  ACCOUNTS_URL: 'http://account:3000',
  SERVER_SECRET: 'secret',
  FRONT_URL: 'http://huly.local:8087/',
  WEBHOOK_BASE_URL: 'https://hooks.example.com/',
  WEBHOOK_SECRET: 'whsecret',
  COLLABORATOR_URL: 'ws://huly.local:3078'
}

describe('loadConfig', () => {
  it('reads the workspace inactivity interval in days (default 3)', () => {
    expect(loadConfig(base).WorkspaceInactivityDays).toBe(3)
    expect(loadConfig({ ...base, WORKSPACE_INACTIVITY_INTERVAL: '0' }).WorkspaceInactivityDays).toBe(0)
    expect(() => loadConfig({ ...base, WORKSPACE_INACTIVITY_INTERVAL: 'soon' })).toThrow('WORKSPACE_INACTIVITY_INTERVAL must be a number')
  })

  it('applies defaults for gitlab.com', () => {
    const cfg = loadConfig(base)
    expect(cfg.Port).toBe(3600)
    expect(cfg.ServiceID).toBe('gitlab-service')
    expect(cfg.FrontURL).toBe('http://huly.local:8087')
    expect(cfg.RedirectURI).toBe('http://huly.local:8087/gitlab')
    expect(cfg.WebhookBaseURL).toBe('https://hooks.example.com')
  })

  it('disallows insecure GitLab hosts unless GITLAB_ALLOW_INSECURE_HOSTS=true', () => {
    expect(loadConfig(base).AllowInsecureHosts).toBe(false)
    expect(loadConfig({ ...base, GITLAB_ALLOW_INSECURE_HOSTS: 'false' }).AllowInsecureHosts).toBe(false)
    expect(loadConfig({ ...base, GITLAB_ALLOW_INSECURE_HOSTS: 'yes' }).AllowInsecureHosts).toBe(false)
    expect(loadConfig({ ...base, GITLAB_ALLOW_INSECURE_HOSTS: 'true' }).AllowInsecureHosts).toBe(true)
  })

  it('reads the collaborator url', () => {
    expect(loadConfig(base).CollaboratorURL).toBe('ws://huly.local:3078')
  })

  it('honours an explicit redirect uri', () => {
    const cfg = loadConfig({ ...base, GITLAB_REDIRECT_URI: 'https://app.example.com/gitlab' })
    expect(cfg.RedirectURI).toBe('https://app.example.com/gitlab')
  })

  it('treats an empty redirect uri as unset', () => {
    const cfg = loadConfig({ ...base, GITLAB_REDIRECT_URI: '' })
    expect(cfg.RedirectURI).toBe('http://huly.local:8087/gitlab')
  })

  it('lists every missing variable', () => {
    expect(() => loadConfig({})).toThrow(
      'Missing env variables: ACCOUNTS_URL, SERVER_SECRET, FRONT_URL, WEBHOOK_BASE_URL, WEBHOOK_SECRET, COLLABORATOR_URL'
    )
  })

  it('treats empty strings as missing', () => {
    expect(() => loadConfig({ ...base, WEBHOOK_SECRET: '' })).toThrow('Missing env variables: WEBHOOK_SECRET')
  })

  it('rejects a non-numeric port', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow('PORT must be a number')
  })

  it('reads the optional blob storage configuration', () => {
    expect(loadConfig(base).StorageConfig).toBeUndefined()
    expect(loadConfig({ ...base, STORAGE_CONFIG: '' }).StorageConfig).toBeUndefined()
    expect(loadConfig({ ...base, STORAGE_CONFIG: 'minio|minio?accessKey=a&secretKey=b' }).StorageConfig).toBe('minio|minio?accessKey=a&secretKey=b')
  })
})

describe('trimSlash', () => {
  it('removes all trailing slashes only', () => {
    expect(trimSlash('https://a.b/c///')).toBe('https://a.b/c')
    expect(trimSlash('https://a.b')).toBe('https://a.b')
  })
})

describe('redirectUriFor', () => {
  it("uses the browser's origin", () => {
    expect(redirectUriFor('https://huly.example.com', 'http://front/gitlab')).toBe('https://huly.example.com/gitlab')
    expect(redirectUriFor('http://huly.local:8087', 'http://front/gitlab')).toBe('http://huly.local:8087/gitlab')
  })

  it.each([undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://huly.example', 'https://huly.example/path', 'https://user:pw@huly.example'])(
    'falls back to the configured redirect for %p',
    (origin) => {
      expect(redirectUriFor(origin, 'http://front/gitlab')).toBe('http://front/gitlab')
    }
  )
})
