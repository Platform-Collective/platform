// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import type { LoginInfoByToken } from '@hcengineering/account-client'
import { AccountRole, type PersonId, type WorkspaceUuid } from '@hcengineering/core'
import { parseCorsOrigins, weakSecrets } from '../config'
import { hookSecret } from '../hooks'
import { HttpError } from '../http-error'
import { refreshRoute, type RefreshRouteDeps } from '../routes'
import { signState, UsedStates, verifyState } from '../state'
import { isIntegrationToken, type GitlabUserRecord } from '../users'
import { authorizeHook, scopedResolver } from '../webhook'
import { ctx } from './helpers/provider'

const ws = '11111111-1111-4111-8111-111111111111' as WorkspaceUuid
const person = 'p1' as PersonId

describe('isIntegrationToken', () => {
  const record = { host: 'https://gitlab.com', userId: 7 } as unknown as GitlabUserRecord

  it('accepts the record the integration was connected with', () => {
    expect(isIntegrationToken(record, { host: 'https://gitlab.com', gitlabUserId: 7 })).toBe(true)
  })

  it('refuses an integration that names another host or GitLab user', () => {
    expect(isIntegrationToken(record, { host: 'https://attacker.example', gitlabUserId: 7 })).toBe(false)
    expect(isIntegrationToken(record, { host: 'https://gitlab.com', gitlabUserId: 8 })).toBe(false)
  })

  it('refuses a missing record', () => {
    expect(isIntegrationToken(undefined, { host: 'https://gitlab.com', gitlabUserId: 7 })).toBe(false)
  })
})

describe('refreshRoute', () => {
  function deps (role: AccountRole): RefreshRouteDeps & { service: { refresh: jest.Mock } } {
    return {
      verify: async () => ({ workspace: ws, account: 'acc', accountId: person }),
      loginInfo: async () => ({ workspace: ws, role }) as unknown as LoginInfoByToken,
      service: { refresh: jest.fn(async () => {}) }
    }
  }

  it('refreshes for a maintainer', async () => {
    const d = deps(AccountRole.Maintainer)
    await refreshRoute(ctx, {}, d)
    expect(d.service.refresh).toHaveBeenCalledWith(ctx, ws, person)
  })

  it('refuses a regular member with 403', async () => {
    const d = deps(AccountRole.User)
    await expect(refreshRoute(ctx, {}, d)).rejects.toMatchObject({ status: 403 })
    await expect(refreshRoute(ctx, {}, d)).rejects.toBeInstanceOf(HttpError)
    expect(d.service.refresh).not.toHaveBeenCalled()
  })
})

describe('authorizeHook', () => {
  const resolve = scopedResolver('master')
  const params = { workspace: ws, integration: 'int1' }
  const secret = hookSecret('master', { workspace: ws, integration: 'int1' as any })

  it('accepts the scoped secret from headers and route parameters alone', () => {
    const header = (name: string): string | undefined => (name === 'x-gitlab-token' ? secret : undefined)
    expect(authorizeHook(resolve, { header, params })).toEqual({ target: { workspace: ws, integration: 'int1' } })
  })

  it('refuses a wrong or missing token', () => {
    expect(authorizeHook(resolve, { header: () => 'wrong', params })).toBeUndefined()
    expect(authorizeHook(resolve, { header: () => undefined, params })).toBeUndefined()
  })
})

describe('OAuth state', () => {
  const payload = { workspace: ws, account: 'acc', accountId: person }

  it('is good for one authorization only', () => {
    const used = new UsedStates()
    const state = verifyState(signState(payload, 'secret', 1000), 'secret', 1000)
    used.consume(state, 1000)
    expect(() => {
      used.consume(state, 2000)
    }).toThrow('OAuth state already used')
    // Another state of the same user is fine
    used.consume(verifyState(signState(payload, 'secret', 1000), 'secret', 1000), 2000)
  })

  it('forgets used states once they expire', () => {
    const used = new UsedStates()
    const state = verifyState(signState(payload, 'secret', 0), 'secret', 0)
    used.consume(state, 0)
    // Past its expiry verifyState refuses it anyway; the record is pruned
    used.consume(state, state.exp + 1)
  })
})

describe('parseCorsOrigins', () => {
  it('allows the FRONT_URL origin and the listed ones', () => {
    expect(parseCorsOrigins('https://huly.example/app', ' https://other.example/ ,https://huly.example')).toEqual([
      'https://huly.example',
      'https://other.example'
    ])
  })

  it('refuses an invalid origin', () => {
    expect(() => parseCorsOrigins('https://huly.example', 'not a url')).toThrow('GITLAB_CORS_ORIGINS')
  })
})

describe('weakSecrets', () => {
  const strong = 'a'.repeat(32)

  it('names short and placeholder secrets', () => {
    expect(weakSecrets({ ServerSecret: 'secret', WebhookSecret: 'short', AllowInsecureHosts: false })).toEqual([
      'SERVER_SECRET',
      'WEBHOOK_SECRET'
    ])
    expect(weakSecrets({ ServerSecret: strong, WebhookSecret: strong, AllowInsecureHosts: false })).toEqual([])
  })

  it('stays quiet in dev mode', () => {
    expect(weakSecrets({ ServerSecret: 'secret', WebhookSecret: 'secret', AllowInsecureHosts: true })).toEqual([])
  })
})
