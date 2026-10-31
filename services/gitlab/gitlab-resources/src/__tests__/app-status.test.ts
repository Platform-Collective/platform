// SPDX-License-Identifier: EPL-2.0
import { appConfigArgs, appStatusOf, setupFormOf } from '../app-status'

describe('appStatusOf', () => {
  it('reads a configured application', () => {
    expect(
      appStatusOf({
        configured: true,
        host: 'https://git.corp.local',
        clientId: 'id',
        redirectUri: 'https://huly/gitlab',
        scopes: 'api read_user'
      })
    ).toEqual({
      configured: true,
      host: 'https://git.corp.local',
      clientId: 'id',
      redirectUri: 'https://huly/gitlab',
      scopes: 'api read_user'
    })
  })

  it('defaults fields the service did not send or sent with another type', () => {
    expect(appStatusOf({ configured: 'yes', host: 3 })).toEqual({
      configured: false,
      host: undefined,
      clientId: undefined,
      redirectUri: '',
      scopes: ''
    })
  })
})

describe('setupFormOf', () => {
  it('treats gitlab.com and an unconfigured app as not self-managed', () => {
    const status = { configured: true, host: 'https://gitlab.com', clientId: 'id', redirectUri: '', scopes: '' }
    expect(setupFormOf(status)).toEqual({ selfManaged: false, host: '', clientId: 'id', clientSecret: '' })
    expect(setupFormOf(undefined)).toEqual({ selfManaged: false, host: '', clientId: '', clientSecret: '' })
  })

  it('keeps a self-managed host', () => {
    const status = { configured: true, host: 'https://git.corp.local', clientId: 'id', redirectUri: '', scopes: '' }
    expect(setupFormOf(status).host).toBe('https://git.corp.local')
    expect(setupFormOf(status).selfManaged).toBe(true)
  })
})

describe('appConfigArgs', () => {
  it('sends no host for gitlab.com and no secret when it is left empty', () => {
    expect(appConfigArgs({ selfManaged: false, host: 'ignored', clientId: ' id ', clientSecret: '  ' })).toEqual({
      clientId: 'id'
    })
  })

  it('sends the trimmed host and secret when given', () => {
    expect(
      appConfigArgs({ selfManaged: true, host: ' https://git.corp.local ', clientId: 'id', clientSecret: ' s ' })
    ).toEqual({ clientId: 'id', host: 'https://git.corp.local', clientSecret: 's' })
  })
})
