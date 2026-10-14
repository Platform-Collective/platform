// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import type { LoginInfoByToken } from '@hcengineering/account-client'
import { AccountRole, type PersonId, type WorkspaceUuid } from '@hcengineering/core'
import type { LookupAddress } from 'dns'
import { parseCorsOrigins, weakSecrets } from '../config'
import { hookSecret } from '../hooks'
import { HostGuard, type LookupFn } from '../host-guard'
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

describe('HostGuard.connectLookup', () => {
  function resolves (map: Record<string, string[]>): LookupFn {
    return async (hostname) =>
      (map[hostname] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }

  async function lookup (guard: HostGuard, hostname: string, options: any = {}): Promise<{ err: any, address: any }> {
    return await new Promise((resolve) => {
      guard.connectLookup(hostname, options, (err: any, address: string | LookupAddress[]) => {
        resolve({ err, address })
      })
    })
  }

  it('connects to the checked public address', async () => {
    const guard = new HostGuard({ allowInsecure: false, allowedHosts: [] }, resolves({ 'gitlab.com': ['8.8.8.8'] }))
    expect(await lookup(guard, 'GitLab.com')).toEqual({ err: null, address: '8.8.8.8' })
    expect(await lookup(guard, 'gitlab.com', { all: true })).toEqual({
      err: null,
      address: [{ address: '8.8.8.8', family: 4 }]
    })
  })

  it('refuses a host that resolves to a private address at connection time (DNS rebinding)', async () => {
    let calls = 0
    const rebinding: LookupFn = async () => [{ address: calls++ === 0 ? '8.8.8.8' : '127.0.0.1', family: 4 }]
    const guard = new HostGuard({ allowInsecure: false, allowedHosts: [] }, rebinding)
    await guard.assertAllowed('https://rebind.example')
    const { err } = await lookup(guard, 'rebind.example')
    expect(err?.name).toBe('GitlabHostRefusedError')
  })

  it('lets GITLAB_ALLOWED_HOSTS and dev mode reach private addresses', async () => {
    const map = resolves({ 'git.corp': ['10.0.0.5'] })
    const allowed = new HostGuard({ allowInsecure: false, allowedHosts: ['git.corp'] }, map)
    expect((await lookup(allowed, 'git.corp')).address).toBe('10.0.0.5')
    const dev = new HostGuard({ allowInsecure: true, allowedHosts: [] }, map)
    expect((await lookup(dev, 'git.corp')).address).toBe('10.0.0.5')
  })

  it('answers ENOTFOUND when no address of the asked family is allowed', async () => {
    const guard = new HostGuard({ allowInsecure: false, allowedHosts: [] }, resolves({ 'gitlab.com': ['8.8.8.8'] }))
    const { err } = await lookup(guard, 'gitlab.com', { family: 6 })
    expect(err?.code).toBe('ENOTFOUND')
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
