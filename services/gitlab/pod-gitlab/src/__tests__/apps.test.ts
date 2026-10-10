// SPDX-License-Identifier: EPL-2.0
import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import { GitlabAppStore, normalizeHost, type AppSecretStore } from '../apps'

const ws = 'ws1' as WorkspaceUuid
const owner = 'p1' as PersonId

type MemoryStore = AppSecretStore & { secrets: any[], integrations: any[], failAddFor?: string }

function memoryStore (): MemoryStore {
  const secrets: any[] = []
  const integrations: any[] = []
  const sameIntegration = (a: any, b: any): boolean =>
    a.kind === b.kind && a.socialId === b.socialId && a.workspaceUuid === b.workspaceUuid
  const same = (a: any, b: any): boolean => a.key === b.key && sameIntegration(a, b)
  const matches =
    (q: any) =>
    (s: any): boolean =>
      Object.entries(q).every(([k, v]) => v === undefined || s[k] === v)
  const requireIntegration = (k: any): void => {
    if (!integrations.some((i) => sameIntegration(i, k))) throw new Error('IntegrationNotFound')
  }
  const store: any = {
    secrets,
    integrations,
    listIntegrations: async (q: any) => integrations.filter(matches(q)),
    getIntegration: async (k: any) => integrations.find((i) => sameIntegration(i, k)) ?? null,
    createIntegration: async (i: any) => {
      integrations.push({ ...i })
    },
    updateIntegration: async (i: any) => {
      Object.assign(
        integrations.find((x) => sameIntegration(x, i)),
        i
      )
    },
    deleteIntegration: async (k: any) => {
      integrations.splice(
        integrations.findIndex((i) => sameIntegration(i, k)),
        1
      )
    },
    listIntegrationsSecrets: async (q: any) => secrets.filter(matches(q)),
    getIntegrationSecret: async (k: any) => secrets.find((s) => same(s, k)) ?? null,
    addIntegrationSecret: async (s: any) => {
      if (store.failAddFor !== undefined && s.socialId === store.failAddFor) throw new Error('add failed')
      requireIntegration(s)
      secrets.push({ ...s })
    },
    updateIntegrationSecret: async (s: any) => {
      Object.assign(
        secrets.find((x) => same(x, s)),
        s
      )
    },
    deleteIntegrationSecret: async (k: any) => {
      requireIntegration(k)
      secrets.splice(
        secrets.findIndex((s) => same(s, k)),
        1
      )
    }
  }
  return store
}

const cfg = { host: 'https://gitlab.com', clientId: 'cid', clientSecret: 'shh', updatedOn: 1, updatedBy: owner }

describe('normalizeHost', () => {
  it.each([
    ['https://gitlab.com', 'https://gitlab.com'],
    ['  https://gitlab.com/  ', 'https://gitlab.com'],
    ['https://git.corp.local/gitlab//', 'https://git.corp.local/gitlab'],
    ['http://localhost:8929', 'http://localhost:8929'],
    ['http://127.0.0.1', 'http://127.0.0.1'],
    ['http://gitlab.local', 'http://gitlab.local']
  ])('accepts %s', (raw, expected) => {
    expect(normalizeHost(raw, { allowInsecure: true })).toBe(expected)
  })

  it.each(['http://localhost:8929', 'http://127.0.0.1', 'http://gitlab.local'])(
    'rejects plain http %s by default',
    (raw) => {
      expect(() => normalizeHost(raw)).toThrow('Invalid GitLab URL')
      expect(() => normalizeHost(raw, { allowInsecure: false })).toThrow('Invalid GitLab URL')
    }
  )

  it.each([
    '',
    'gitlab.com',
    'ftp://gitlab.com',
    'http://gitlab.com',
    'https://gitlab.com/?x=1',
    'https://gitlab.com/#a',
    'https://user:pw@gitlab.com',
    'https://gitlab.com?',
    'https://gitlab.com#',
    'http://evil.com.local.attacker.com',
    'http://gitlab.local@evil.com'
  ])('rejects %s', (raw) => {
    expect(() => normalizeHost(raw, { allowInsecure: true })).toThrow('Invalid GitLab URL')
  })

  it('does not echo the raw input (it may hold credentials) in the error', () => {
    expect(() => normalizeHost('ftp://user:pw@git.example.com')).toThrow('Invalid GitLab URL')
    let message = ''
    try {
      normalizeHost('ftp://user:pw@git.example.com')
    } catch (err: unknown) {
      message = (err as Error).message
    }
    expect(message).not.toContain('pw')
  })
})

describe('GitlabAppStore', () => {
  it('returns undefined when nothing is saved', async () => {
    expect(await new GitlabAppStore(memoryStore()).get(ws)).toBeUndefined()
  })

  it('saves, reads back and overwrites a single secret per workspace', async () => {
    const store = memoryStore()
    const apps = new GitlabAppStore(store)
    await apps.save(ws, cfg)
    await apps.save(ws, { ...cfg, clientSecret: 'new', updatedBy: 'p2' as PersonId })
    expect(store.secrets).toHaveLength(1)
    expect(store.secrets[0]).toMatchObject({ kind: 'gitlab-app', key: 'app', workspaceUuid: ws })
    expect(await apps.get(ws)).toEqual({ ...cfg, clientSecret: 'new', updatedBy: 'p2' })
  })

  it('keeps workspaces separate', async () => {
    const apps = new GitlabAppStore(memoryStore())
    await apps.save(ws, cfg)
    expect(await apps.get('ws2' as WorkspaceUuid)).toBeUndefined()
  })

  it('remove deletes the workspace secret', async () => {
    const store = memoryStore()
    const apps = new GitlabAppStore(store)
    await apps.save(ws, cfg)
    await apps.remove(ws)
    expect(await apps.get(ws)).toBeUndefined()
    expect(store.secrets).toHaveLength(0)
    expect(store.integrations).toHaveLength(0)
  })

  it('creates an integration row without the secret in its data', async () => {
    const store = memoryStore()
    await new GitlabAppStore(store).save(ws, cfg)
    expect(store.integrations).toEqual([
      { kind: 'gitlab-app', workspaceUuid: ws, socialId: owner, data: { host: cfg.host, clientId: cfg.clientId } }
    ])
  })

  it('save by a second owner replaces the first owner secret and integration row', async () => {
    const store = memoryStore()
    const apps = new GitlabAppStore(store)
    await apps.save(ws, cfg)
    await apps.save(ws, { ...cfg, updatedBy: 'p2' as PersonId, updatedOn: 2 })
    expect(store.secrets).toHaveLength(1)
    expect(store.integrations).toHaveLength(1)
    expect(store.secrets[0].socialId).toBe('p2')
    expect(store.integrations[0].socialId).toBe('p2')
  })

  it('a failing add leaves the previous config intact', async () => {
    const store = memoryStore()
    const apps = new GitlabAppStore(store)
    await apps.save(ws, cfg)
    store.failAddFor = 'p2'
    await expect(apps.save(ws, { ...cfg, updatedBy: 'p2' as PersonId, updatedOn: 2 })).rejects.toThrow('add failed')
    expect(await apps.get(ws)).toEqual(cfg)
  })

  it('serialises concurrent saves by different owners', async () => {
    const store = memoryStore()
    const apps = new GitlabAppStore(store)
    await Promise.all([apps.save(ws, cfg), apps.save(ws, { ...cfg, updatedBy: 'p2' as PersonId, updatedOn: 2 })])
    expect(store.secrets).toHaveLength(1)
    expect(store.integrations).toHaveLength(1)
  })

  it('get returns the newest config when several secrets exist', async () => {
    const store = memoryStore()
    for (const [who, on] of [
      ['p1', 5],
      ['p2', 9],
      ['p3', 7]
    ] as const) {
      store.integrations.push({ kind: 'gitlab-app', workspaceUuid: ws, socialId: who })
      store.secrets.push({
        kind: 'gitlab-app',
        workspaceUuid: ws,
        socialId: who,
        key: 'app',
        secret: JSON.stringify({ ...cfg, updatedOn: on, updatedBy: who })
      })
    }
    expect((await new GitlabAppStore(store).get(ws))?.updatedBy).toBe('p2')
  })

  it('get skips malformed secrets', async () => {
    const store = memoryStore()
    store.secrets.push({ kind: 'gitlab-app', workspaceUuid: ws, socialId: 'p1', key: 'app', secret: '{nope' })
    store.secrets.push({
      kind: 'gitlab-app',
      workspaceUuid: ws,
      socialId: 'p2',
      key: 'app',
      secret: JSON.stringify({ host: 1 })
    })
    expect(await new GitlabAppStore(store).get(ws)).toBeUndefined()
  })

  it('remove also deletes orphan integration rows', async () => {
    const store = memoryStore()
    store.integrations.push({ kind: 'gitlab-app', workspaceUuid: ws, socialId: 'p9' })
    await new GitlabAppStore(store).remove(ws)
    expect(store.integrations).toHaveLength(0)
  })
})

describe('GitlabAppStore workspace guard', () => {
  function spyStore (): AppSecretStore {
    const fail = jest.fn(async () => {
      throw new Error('store must not be called')
    })
    return {
      listIntegrations: fail,
      getIntegration: fail,
      createIntegration: fail,
      updateIntegration: fail,
      deleteIntegration: fail,
      listIntegrationsSecrets: fail,
      getIntegrationSecret: fail,
      addIntegrationSecret: fail,
      updateIntegrationSecret: fail,
      deleteIntegrationSecret: fail
    }
  }

  it.each([undefined, ''])(
    'get, save and remove throw for workspace %p without calling the store',
    async (workspace) => {
      const store = spyStore()
      const apps = new GitlabAppStore(store)
      await expect(apps.get(workspace as any)).rejects.toThrow('workspace is required')
      await expect(apps.save(workspace as any, cfg)).rejects.toThrow('workspace is required')
      await expect(apps.remove(workspace as any)).rejects.toThrow('workspace is required')
      for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled()
    }
  )
})
