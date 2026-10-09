// SPDX-License-Identifier: EPL-2.0
import type { IntegrationSecret } from '@hcengineering/account-client'
import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import type { FetchFn } from '../gitlab/api'
import { GitlabUserManager, type GitlabUserRecord, type SecretStore } from '../users'

const cfg = {
  GitlabHost: 'https://gitlab.com',
  ClientID: 'cid',
  ClientSecret: 'cs',
  RedirectURI: 'http://front/gitlab'
}
const person = 'p1' as PersonId
const ws = 'ws1' as WorkspaceUuid

function memoryStore (): SecretStore & { secrets: IntegrationSecret[], integrations: unknown[] } {
  const secrets: IntegrationSecret[] = []
  const integrations: unknown[] = []
  return {
    secrets,
    integrations,
    getIntegration: async (k: any) =>
      (integrations.find((i: any) => i.workspaceUuid === k.workspaceUuid && i.socialId === k.socialId) as any) ?? null,
    createIntegration: async (i: any) => {
      integrations.push(i)
    },
    updateIntegration: async (i: any) => {
      const idx = integrations.findIndex(
        (it: any) => it.workspaceUuid === i.workspaceUuid && it.socialId === i.socialId
      )
      integrations[idx] = i
    },
    // Like the account service: deleting an integration row cascades its secrets.
    deleteIntegration: async (k: any) => {
      const idx = integrations.findIndex(
        (it: any) => it.workspaceUuid === k.workspaceUuid && it.socialId === k.socialId
      )
      if (idx < 0) throw new Error('IntegrationNotFound')
      integrations.splice(idx, 1)
      for (let i = secrets.length - 1; i >= 0; i--) {
        if (secrets[i].workspaceUuid === k.workspaceUuid && secrets[i].socialId === k.socialId) secrets.splice(i, 1)
      }
    },
    getIntegrationSecret: async (k: any) =>
      secrets.find((s) => s.key === k.key && s.socialId === k.socialId && s.workspaceUuid === k.workspaceUuid) ?? null,
    addIntegrationSecret: async (s: any) => {
      secrets.push(s)
    },
    updateIntegrationSecret: async (s: any) => {
      const idx = secrets.findIndex(
        (it) => it.key === s.key && it.socialId === s.socialId && it.workspaceUuid === s.workspaceUuid
      )
      secrets[idx] = { ...secrets[idx], ...s }
    },
    listIntegrationsSecrets: async (q: any) =>
      secrets.filter(
        (s) =>
          (q.socialId === undefined || s.socialId === q.socialId) &&
          (q.key === undefined || s.key === q.key) &&
          (q.workspaceUuid === undefined || s.workspaceUuid === q.workspaceUuid)
      ),
    deleteIntegrationSecret: async (k: any) => {
      const idx = secrets.findIndex(
        (it) => it.key === k.key && it.socialId === k.socialId && it.workspaceUuid === k.workspaceUuid
      )
      if (idx >= 0) secrets.splice(idx, 1)
    }
  } as any
}

const record: GitlabUserRecord = {
  account: person,
  workspace: ws,
  host: 'https://gitlab.com',
  userId: 42,
  login: 'alice',
  token: 'old',
  refreshToken: 'r1',
  expiresAt: 1000,
  scope: 'api read_user'
}

describe('GitlabUserManager', () => {
  it('saves and reads back a record keyed by user id', async () => {
    const store = memoryStore()
    const users = new GitlabUserManager(
      store,
      async () => cfg,
      undefined,
      () => 0
    )
    await users.save(record)
    expect(store.secrets[0].key).toBe('42')
    expect(store.integrations).toHaveLength(1)
    expect(await users.getByRef(ws, person)).toEqual(record)
    await users.save({ ...record, token: 'new' })
    expect(store.secrets).toHaveLength(1)
    expect((await users.getByRef(ws, person))?.token).toBe('new')
  })

  it('returns the stored token when not expired', async () => {
    const store = memoryStore()
    const fetchFn = jest.fn() as unknown as FetchFn
    const users = new GitlabUserManager(
      store,
      async () => cfg,
      fetchFn,
      () => 100
    )
    await users.save(record)
    expect((await users.getValidRecord(ws, person))?.token).toBe('old')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refreshes once for concurrent callers and persists the rotated refresh token', async () => {
    const store = memoryStore()
    let calls = 0
    const fetchFn = (async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 10))
      return new Response(
        JSON.stringify({
          access_token: 'fresh',
          token_type: 'Bearer',
          expires_in: 7200,
          refresh_token: 'r2',
          created_at: 2000,
          scope: 'api'
        }),
        { status: 200 }
      )
    }) as unknown as FetchFn
    const users = new GitlabUserManager(
      store,
      async () => cfg,
      fetchFn,
      () => 2000
    )
    await users.save(record)
    const [a, b] = await Promise.all([users.getValidRecord(ws, person), users.getValidRecord(ws, person)])
    expect(calls).toBe(1)
    expect(a?.token).toBe('fresh')
    expect(b?.token).toBe('fresh')
    expect((await users.getByRef(ws, person))?.refreshToken).toBe('r2')
  })

  it('keeps the stored refresh token when the refresh response has none', async () => {
    const store = memoryStore()
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          access_token: 'fresh',
          token_type: 'Bearer',
          expires_in: 7200,
          created_at: 2000,
          scope: 'api'
        }),
        { status: 200 }
      )) as unknown as FetchFn
    const users = new GitlabUserManager(
      store,
      async () => cfg,
      fetchFn,
      () => 2000
    )
    await users.save(record)
    const refreshed = await users.getValidRecord(ws, person)
    expect(refreshed?.token).toBe('fresh')
    expect(refreshed?.refreshToken).toBe('r1')
    expect((await users.getByRef(ws, person))?.refreshToken).toBe('r1')
  })

  it('returns undefined when expired and no refresh token exists', async () => {
    const store = memoryStore()
    const users = new GitlabUserManager(
      store,
      async () => cfg,
      undefined,
      () => 5000
    )
    await users.save({ ...record, refreshToken: null })
    expect(await users.getValidRecord(ws, person)).toBeUndefined()
  })

  it('removes the gitlab-user integration row (and with it the secrets) for a person', async () => {
    const store = memoryStore()
    const users = new GitlabUserManager(
      store,
      async () => cfg,
      undefined,
      () => 0
    )
    await users.save(record)
    const deleteIntegration = jest.spyOn(store, 'deleteIntegration')
    await users.remove(ws, person)
    expect(deleteIntegration).toHaveBeenCalledWith({ kind: 'gitlab-user', workspaceUuid: ws, socialId: person })
    expect(store.integrations).toHaveLength(0)
    expect(store.secrets).toHaveLength(0)
    expect(await users.getByRef(ws, person)).toBeUndefined()
  })

  it('remove is a no-op when the person has no gitlab-user integration', async () => {
    const store = memoryStore()
    const users = new GitlabUserManager(
      store,
      async () => cfg,
      undefined,
      () => 0
    )
    await expect(users.remove(ws, person)).resolves.toBeUndefined()
  })

  it('re-linking a different GitLab account replaces the old identity', async () => {
    const store = memoryStore()
    const users = new GitlabUserManager(
      store,
      async () => cfg,
      undefined,
      () => 0
    )
    await users.save(record)
    await users.save({ ...record, userId: 99, login: 'bob', token: 'bobtok' })
    expect(store.secrets.map((s) => s.key)).toEqual(['99'])
    expect((await users.getByRef(ws, person))?.login).toBe('bob')
    expect((store.integrations[0] as any).data).toEqual({ login: 'bob', userId: 99 })
  })

  it('saving the same identity again keeps a single secret and integration data', async () => {
    const store = memoryStore()
    const users = new GitlabUserManager(
      store,
      async () => cfg,
      undefined,
      () => 0
    )
    await users.save(record)
    await users.save({ ...record, token: 'again' })
    expect(store.secrets).toHaveLength(1)
    expect((store.integrations[0] as any).data).toEqual({ login: 'alice', userId: 42 })
  })

  it('refresh resolves the workspace app at refresh time (renewed secret is used)', async () => {
    const store = memoryStore()
    let secret = 'old'
    const bodies: string[] = []
    const fetchFn = (async (_u: string, init?: RequestInit) => {
      bodies.push(String(init?.body))
      return new Response(
        JSON.stringify({
          access_token: 'fresh',
          token_type: 'Bearer',
          expires_in: 7200,
          refresh_token: 'r2',
          created_at: 2000,
          scope: 'api'
        }),
        { status: 200 }
      )
    }) as unknown as FetchFn
    const users = new GitlabUserManager(
      store,
      async () => ({
        GitlabHost: 'https://gitlab.com',
        ClientID: 'cid',
        ClientSecret: secret,
        RedirectURI: 'http://front/gitlab'
      }),
      fetchFn,
      () => 2000
    )
    await users.save(record)
    secret = 'renewed'
    expect((await users.getValidRecord(ws, person))?.token).toBe('fresh')
    expect(new URLSearchParams(bodies[0]).get('client_secret')).toBe('renewed')
  })

  it('returns undefined when the workspace app was removed', async () => {
    const users = new GitlabUserManager(
      memoryStore(),
      async () => undefined,
      undefined,
      () => 5000
    )
    await users.save(record)
    expect(await users.getValidRecord(ws, person)).toBeUndefined()
  })

  it('tokens are scoped per workspace', async () => {
    const users = new GitlabUserManager(
      memoryStore(),
      async () => cfg,
      undefined,
      () => 0
    )
    await users.save(record)
    expect(await users.getByRef('ws2' as WorkspaceUuid, person)).toBeUndefined()
    expect(await users.getByRef(ws, person)).toBeDefined()
  })

  it("saving a token in another workspace leaves this workspace's record alone", async () => {
    const users = new GitlabUserManager(
      memoryStore(),
      async () => cfg,
      undefined,
      () => 0
    )
    const wsB = 'ws-b' as WorkspaceUuid
    await users.save({ ...record, workspace: ws, token: 'token-a' })
    await users.save({ ...record, workspace: wsB, token: 'token-b' })
    expect((await users.getByRef(ws, record.account))?.token).toBe('token-a')
    expect((await users.getByRef(wsB, record.account))?.token).toBe('token-b')
  })
})

describe('GitlabUserManager workspace guard', () => {
  it.each([undefined, ''])(
    'getByRef, save, getValidRecord and remove throw for workspace %p without calling the store',
    async (workspace) => {
      const fail = jest.fn(async () => {
        throw new Error('store must not be called')
      })
      const store = new Proxy({}, { get: () => fail }) as unknown as SecretStore
      const users = new GitlabUserManager(
        store,
        async () => cfg,
        undefined,
        () => 0
      )
      await expect(users.getByRef(workspace as any, person)).rejects.toThrow('workspace is required')
      await expect(users.save({ ...record, workspace: workspace as any })).rejects.toThrow('workspace is required')
      await expect(users.getValidRecord(workspace as any, person)).rejects.toThrow('workspace is required')
      await expect(users.remove(workspace as any, person)).rejects.toThrow('workspace is required')
      expect(fail).not.toHaveBeenCalled()
    }
  )
})
