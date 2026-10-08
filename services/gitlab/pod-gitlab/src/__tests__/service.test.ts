// SPDX-License-Identifier: EPL-2.0
import { MeasureMetricsContext, type PersonId, type WorkspaceUuid } from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import tracker from '@hcengineering/tracker'
import type { GitlabAppConfig } from '../apps'
import type { FetchFn } from '../gitlab/api'
import { GitlabService } from '../service'
import { signState } from '../state'

const ctx = new MeasureMetricsContext('test', {})
const ws = 'ws1' as WorkspaceUuid
const person = 'p1' as PersonId
const caller = { workspace: ws, account: 'acc1' }
const config = {
  AccountsURL: '', ServerSecret: 'srv-secret', ServiceID: 's', FrontURL: 'http://front', Port: 0,
  RedirectURI: 'http://front/gitlab',
  WebhookBaseURL: 'https://hooks.example.com', WebhookSecret: 'whs', CollaboratorURL: ''
}

function memoryClient (): any {
  const docs: any[] = []
  let n = 0
  const match = (d: any, q: any): boolean => Object.entries(q).every(([k, v]) => d[k] === v)
  return {
    docs,
    // Mixin docs keep their attributes under doc[mixinId]; a mixin query returns the merged view (like the real client).
    findAll: async (_class: string, q: any) => {
      const mixinMatch = (d: any): boolean => Object.entries(q).every(([k, v]) => {
        const value = d[_class][k]
        return Array.isArray(value) ? value.includes(v) : value === v
      })
      const mixed = docs.filter((d) => d[_class] !== undefined && mixinMatch(d)).map((d) => ({ ...d, ...d[_class] }))
      return mixed.concat(docs.filter((d) => d._class === _class && match(d, q)))
    },
    findOne: async (_class: string, q: any) => docs.find((d) => d._class === _class && match(d, q)),
    createDoc: async (_class: string, space: string, data: any) => { const _id = `d${++n}`; docs.push({ _id, _class, space, ...data }); return _id },
    addCollection: async (_class: string, space: string, attachedTo: string, _ac: string, collection: string, data: any) => {
      const _id = `d${++n}`; docs.push({ _id, _class, space, attachedTo, collection, ...data }); return _id
    },
    update: async (doc: any, upd: any) => { Object.assign(docs.find((d) => d._id === doc._id), upd) },
    updateMixin: async (_id: string, _cls: string, _space: string, mixin: string, upd: any) => {
      Object.assign(docs.find((d) => d._id === _id)[mixin], upd)
    },
    remove: async (doc: any) => { docs.splice(docs.findIndex((d) => d._id === doc._id), 1) }
  }
}

function gitlabFetch (routes: Record<string, unknown>): { fn: FetchFn, calls: string[], requests: Array<{ key: string, auth?: string, body?: string }> } {
  const calls: string[] = []
  const requests: Array<{ key: string, auth?: string, body?: string }> = []
  const fn = (async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`
    calls.push(key)
    requests.push({ key, auth: (init?.headers as Record<string, string> | undefined)?.Authorization, body: init?.body?.toString() })
    if (!(key in routes)) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(routes[key]), { status: 200 })
  }) as unknown as FetchFn
  return { fn, calls, requests }
}

const project = {
  id: 5, name: 'p', path_with_namespace: 'g/p', web_url: 'https://gitlab.com/g/p', description: null,
  visibility: 'private', archived: false, default_branch: 'main', star_count: 0, forks_count: 0,
  last_activity_at: '2026-10-01T00:00:00Z', namespace: { id: 1, name: 'g', path: 'g', kind: 'group', full_path: 'g' }
}

function setup (
  routes: Record<string, unknown>,
  opts: { apps?: false, host?: string, allowInsecure?: boolean, linkIdentity?: jest.Mock, onWorkspaceChanged?: jest.Mock } = {}
): any {
  const client = memoryClient()
  // Synchronous Map for assertions; the service gets the async wrapper below.
  const apps = new Map<string, GitlabAppConfig>()
  if (opts.apps !== false) {
    apps.set(ws, { host: opts.host ?? 'https://gitlab.com', clientId: 'cid', clientSecret: 'cs', updatedOn: 0, updatedBy: person })
  }
  const appStore = {
    get: async (workspace: WorkspaceUuid) => apps.get(workspace),
    save: async (workspace: WorkspaceUuid, app: GitlabAppConfig) => { apps.set(workspace, app) },
    remove: async (workspace: WorkspaceUuid) => { apps.delete(workspace) }
  }
  const saved: any[] = []
  const users = {
    save: jest.fn(async (r: any) => { saved.push(r) }),
    getValidRecord: jest.fn(async (_workspace: WorkspaceUuid, _socialId: PersonId) => saved[saved.length - 1]),
    remove: jest.fn(async () => {})
  }
  const accounts = {
    getIntegration: jest.fn(async () => null),
    createIntegration: jest.fn(async () => {}),
    updateIntegration: jest.fn(async () => {}),
    deleteIntegration: jest.fn(async () => {})
  }
  const { fn, calls, requests } = gitlabFetch(routes)
  const service = new GitlabService({
    config: { ...config, AllowInsecureHosts: opts.allowInsecure === true },
    users: users as any,
    accounts,
    apps: appStore,
    openSession: async () => ({ client, close: async () => {} }),
    linkIdentity: opts.linkIdentity,
    onWorkspaceChanged: opts.onWorkspaceChanged,
    fetchFn: fn,
    now: () => 1000
  })
  return { service, client, users, accounts, apps, calls, requests, routes }
}

// now() in the service is 1000 ms; the state is signed at 1000 and valid for 10 minutes.
const state = signState({ ...caller, accountId: person }, config.ServerSecret, 1000)

describe('GitlabService', () => {
  const routes = {
    'POST https://gitlab.com/oauth/token': { access_token: 'tok', token_type: 'Bearer', expires_in: 7200, refresh_token: 'r', created_at: 1000, scope: 'api read_user' },
    'GET https://gitlab.com/api/v4/user': { id: 42, username: 'alice', name: 'Alice', avatar_url: null, web_url: 'https://gitlab.com/alice' },
    'GET https://gitlab.com/api/v4/projects': [project]
  }

  it("authorize links the GitLab identity to the caller's person and notifies the platform", async () => {
    const linkIdentity = jest.fn(async () => {})
    const onWorkspaceChanged = jest.fn()
    const { service, client } = setup(routes, { linkIdentity, onWorkspaceChanged })
    await service.authorize(ctx, { code: 'c', state, caller })
    expect(linkIdentity).toHaveBeenCalledWith(client, 'acc1', 'https://gitlab.com', expect.objectContaining({ id: 42, username: 'alice' }))
    expect(onWorkspaceChanged).toHaveBeenCalledWith(ws)
  })

  it('a failing identity link does not fail authorization', async () => {
    const linkIdentity = jest.fn(async () => { throw new Error('account service down') })
    const { service, client } = setup(routes, { linkIdentity })
    await expect(service.authorize(ctx, { code: 'c', state, caller })).resolves.toBeUndefined()
    expect(client.docs.find((d: any) => d._class === gitlab.class.GitlabIntegration)).toBeDefined()
  })

  it('refresh continues with the next integration when one fails', async () => {
    const { service, client, users } = setup({
      'GET https://gitlab.com/api/v4/projects': [project]
    })
    client.docs.push({ _id: 'i1', _class: gitlab.class.GitlabIntegration, connectedBy: 'p-bad', host: 'https://gitlab.com', alive: true })
    client.docs.push({ _id: 'i2', _class: gitlab.class.GitlabIntegration, connectedBy: 'p-good', host: 'https://gitlab.com', alive: true })
    users.getValidRecord.mockImplementation(async (_w: WorkspaceUuid, socialId: PersonId) => {
      if (socialId === 'p-bad') throw new Error('invalid_grant')
      return { token: 'tok' }
    })
    await service.refresh(ctx, ws, person)
    expect(client.docs.filter((d: any) => d._class === gitlab.class.GitlabIntegrationRepository && d.attachedTo === 'i2')).toHaveLength(1)
  })

  it('authorize stores token, auth preference, integration and repositories', async () => {
    const { service, client, users, accounts } = setup(routes)
    await service.authorize(ctx, { code: 'c', state, caller })
    expect(users.save).toHaveBeenCalledWith(expect.objectContaining({ account: person, workspace: ws, host: 'https://gitlab.com', userId: 42, login: 'alice', token: 'tok' }))
    expect(users.save.mock.calls[0][0]).not.toHaveProperty('accounts')
    expect(client.docs.find((d: any) => d._class === gitlab.class.GitlabAuthentication)).toMatchObject({ attachedTo: person, login: 'alice', error: null })
    expect(client.docs.find((d: any) => d._class === gitlab.class.GitlabIntegration)).toMatchObject({ gitlabUserId: 42, host: 'https://gitlab.com', connectedBy: person, alive: true })
    expect(client.docs.filter((d: any) => d._class === gitlab.class.GitlabIntegrationRepository)).toHaveLength(1)
    expect(accounts.createIntegration).toHaveBeenCalledWith({ kind: 'gitlab', workspaceUuid: ws, socialId: person, data: { gitlabUserId: 42, login: 'alice' } })
  })

  it('re-authorizing does not duplicate the integration', async () => {
    const { service, client } = setup(routes)
    await service.authorize(ctx, { code: 'c', state, caller })
    await service.authorize(ctx, { code: 'c', state, caller })
    expect(client.docs.filter((d: any) => d._class === gitlab.class.GitlabIntegration)).toHaveLength(1)
    expect(client.docs.filter((d: any) => d._class === gitlab.class.GitlabIntegrationRepository)).toHaveLength(1)
  })

  it('re-linking another GitLab identity removes the old integration, its repositories and hooks', async () => {
    const { service, client, users, requests, routes: live } = setup({
      ...routes,
      'GET https://gitlab.com/api/v4/projects/5/hooks': [],
      'POST https://gitlab.com/api/v4/projects/5/hooks': { id: 77, url: 'https://hooks.example.com/api/webhook' },
      'DELETE https://gitlab.com/api/v4/projects/5/hooks/77': {}
    })
    await service.authorize(ctx, { code: 'c', state, caller })
    const aliceIntegration = client.docs.find((d: any) => d._class === gitlab.class.GitlabIntegration)._id
    const aliceRepo = client.docs.find((d: any) => d._class === gitlab.class.GitlabIntegrationRepository)
    await service.enableRepository(ctx, ws, aliceRepo._id)
    expect(aliceRepo.hookId).toBe(77)

    // The same Huly person now authorizes as bob (99) with a different project set.
    Object.assign(live, {
      'POST https://gitlab.com/oauth/token': { access_token: 'bobtok', token_type: 'Bearer', expires_in: 7200, refresh_token: 'r', created_at: 1000, scope: 'api read_user' },
      'GET https://gitlab.com/api/v4/user': { id: 99, username: 'bob', name: 'Bob', avatar_url: null, web_url: 'https://gitlab.com/bob' },
      'GET https://gitlab.com/api/v4/projects': [{ ...project, id: 6, path_with_namespace: 'g/b', web_url: 'https://gitlab.com/g/b' }]
    })
    // Snapshot, at bob's token save, whether alice's hook was already deleted.
    const originalSave = users.save.getMockImplementation()
    let deletedBeforeSave: boolean | undefined
    users.save.mockImplementationOnce(async (r: any) => {
      deletedBeforeSave = requests.some((it: any) => it.key === 'DELETE https://gitlab.com/api/v4/projects/5/hooks/77')
      await originalSave(r)
    })
    await service.authorize(ctx, { code: 'c', state, caller })

    const integrations = client.docs.filter((d: any) => d._class === gitlab.class.GitlabIntegration)
    expect(integrations).toHaveLength(1)
    expect(integrations[0]).toMatchObject({ gitlabUserId: 99, login: 'bob', connectedBy: person })
    expect(client.docs.map((d: any) => d._id)).not.toContain(aliceIntegration)
    expect(client.docs.filter((d: any) => d.attachedTo === aliceIntegration)).toEqual([])
    const hookDelete = requests.find((r: any) => r.key === 'DELETE https://gitlab.com/api/v4/projects/5/hooks/77')
    expect(hookDelete?.auth).toBe('Bearer tok')
    // The old hook is deleted before bob's token replaces alice's.
    expect(deletedBeforeSave).toBe(true)
  })

  it('re-linking skips hook deletion when the stored token belongs to another GitLab user', async () => {
    const { service, client, users, requests, routes: live } = setup({
      ...routes,
      'GET https://gitlab.com/api/v4/projects/5/hooks': [],
      'POST https://gitlab.com/api/v4/projects/5/hooks': { id: 77, url: 'https://hooks.example.com/api/webhook' },
      'DELETE https://gitlab.com/api/v4/projects/5/hooks/77': {}
    })
    await service.authorize(ctx, { code: 'c', state, caller })
    const aliceRepo = client.docs.find((d: any) => d._class === gitlab.class.GitlabIntegrationRepository)
    await service.enableRepository(ctx, ws, aliceRepo._id)
    users.getValidRecord.mockResolvedValueOnce({ account: person, userId: 1234, token: 'someone' })
    Object.assign(live, {
      'GET https://gitlab.com/api/v4/user': { id: 99, username: 'bob', name: 'Bob', avatar_url: null, web_url: 'https://gitlab.com/bob' }
    })
    await service.authorize(ctx, { code: 'c', state, caller })
    expect(requests.filter((r: any) => r.key.startsWith('DELETE'))).toEqual([])
    const integrations = client.docs.filter((d: any) => d._class === gitlab.class.GitlabIntegration)
    expect(integrations).toHaveLength(1)
    expect(integrations[0].gitlabUserId).toBe(99)
  })

  it('records an auth error on the preference when the code exchange fails', async () => {
    const { service, client } = setup({})
    await expect(service.authorize(ctx, { code: 'bad', state, caller })).rejects.toThrow()
    expect(client.docs.find((d: any) => d._class === gitlab.class.GitlabAuthentication)?.error).toBeTruthy()
  })

  it('enableRepository installs the hook and stores its id', async () => {
    const { service, client, calls } = setup({
      ...routes,
      'GET https://gitlab.com/api/v4/projects/5/hooks': [],
      'POST https://gitlab.com/api/v4/projects/5/hooks': { id: 77, url: 'https://hooks.example.com/api/webhook' }
    })
    await service.authorize(ctx, { code: 'c', state, caller })
    const repo = client.docs.find((d: any) => d._class === gitlab.class.GitlabIntegrationRepository)
    await service.enableRepository(ctx, ws, repo._id)
    expect(repo.hookId).toBe(77)
    expect(calls).toContain('POST https://gitlab.com/api/v4/projects/5/hooks')
  })

  it('rejects a state that belongs to another user or workspace before touching GitLab', async () => {
    const { service, calls, users } = setup(routes)
    await expect(
      service.authorize(ctx, { code: 'c', state, caller: { workspace: ws, account: 'someone-else' } })
    ).rejects.toThrow('OAuth state does not match the current user')
    await expect(
      service.authorize(ctx, { code: 'c', state, caller: { workspace: 'ws2' as WorkspaceUuid, account: 'acc1' } })
    ).rejects.toThrow('OAuth state does not match the current user')
    expect(calls).toEqual([])
    expect(users.save).not.toHaveBeenCalled()
  })

  it('rejects a tampered state', async () => {
    const { service } = setup(routes)
    await expect(service.authorize(ctx, { code: 'c', state: `${state}x`, caller })).rejects.toThrow('Invalid OAuth state')
  })

  it('authorizeUrl embeds a state that verifies for the same caller', async () => {
    const { service, users } = setup(routes)
    const url = new URL(await service.authorizeUrl({ ...caller, accountId: person }))
    const signed = url.searchParams.get('state') as string
    expect(signed).not.toContain('srv-secret')
    await service.authorize(ctx, { code: 'c', state: signed, caller })
    expect(users.save).toHaveBeenCalled()
  })

  it('enableRepository fails clearly for an unknown repository', async () => {
    const { service } = setup(routes)
    await service.authorize(ctx, { code: 'c', state, caller })
    await expect(service.enableRepository(ctx, ws, 'missing' as any)).rejects.toThrow('Repository not found')
  })

  it("authorizeUrl and the code exchange use the browser's origin as the redirect", async () => {
    const { service, requests } = setup(routes)
    const url = new URL(await service.authorizeUrl({ ...caller, accountId: person }, 'https://huly.example.com'))
    expect(url.searchParams.get('redirect_uri')).toBe('https://huly.example.com/gitlab')
    await service.authorize(ctx, { code: 'c', state: url.searchParams.get('state') as string, caller })
    const exchange = requests.find((r: any) => r.key === 'POST https://gitlab.com/oauth/token')
    expect(new URLSearchParams(exchange?.body).get('redirect_uri')).toBe('https://huly.example.com/gitlab')
  })

  it('appStatus shows the callback URL for the browser origin', async () => {
    const { service } = setup(routes)
    expect((await service.appStatus(ws, 'https://huly.example.com')).redirectUri).toBe('https://huly.example.com/gitlab')
  })

  it('authorizeUrl uses the workspace app client id and host', async () => {
    const { service } = setup(routes, { host: 'https://git.corp.local/gitlab' })
    const url = new URL(await service.authorizeUrl({ ...caller, accountId: person }))
    expect(url.origin + url.pathname).toBe('https://git.corp.local/gitlab/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
  })

  it('refuses to authorize when the workspace has no app', async () => {
    const { service } = setup(routes, { apps: false })
    await expect(service.authorizeUrl({ ...caller, accountId: person })).rejects.toThrow('GitLab is not configured for this workspace')
  })

  it('appStatus never exposes the secret', async () => {
    const { service } = setup(routes)
    const status = await service.appStatus(ws)
    expect(status).toEqual({ configured: true, host: 'https://gitlab.com', clientId: 'cid', redirectUri: 'http://front/gitlab', scopes: 'api read_user' })
    expect(JSON.stringify(status)).not.toContain('cs')
  })

  it('appStatus reports unconfigured workspaces', async () => {
    const { service } = setup(routes, { apps: false })
    expect(await service.appStatus(ws)).toEqual({ configured: false, redirectUri: 'http://front/gitlab', scopes: 'api read_user' })
  })

  it('saveApp normalises the host and requires a secret for a new app', async () => {
    const { service, apps } = setup(routes, { apps: false })
    await expect(service.saveApp(ctx, ws, person, { host: 'https://gitlab.com/', clientId: 'cid' })).rejects.toThrow('secret is required')
    await service.saveApp(ctx, ws, person, { host: ' https://gitlab.com/ ', clientId: 'cid', clientSecret: 's1' })
    expect(apps.get(ws)).toMatchObject({ host: 'https://gitlab.com', clientId: 'cid', clientSecret: 's1', updatedBy: person })
  })

  it('saveApp rejects a plain-http local host unless insecure hosts are allowed', async () => {
    const strict = setup(routes, { apps: false })
    await expect(strict.service.saveApp(ctx, ws, person, { host: 'http://localhost:8929', clientId: 'cid', clientSecret: 's1' })).rejects.toThrow('Invalid GitLab URL')
    const dev = setup(routes, { apps: false, allowInsecure: true })
    await dev.service.saveApp(ctx, ws, person, { host: 'http://localhost:8929', clientId: 'cid', clientSecret: 's1' })
    expect(dev.apps.get(ws)?.host).toBe('http://localhost:8929')
  })

  it('saveApp defaults to gitlab.com when no host is given', async () => {
    const { service, apps } = setup(routes, { apps: false })
    await service.saveApp(ctx, ws, person, { clientId: 'cid', clientSecret: 's1' })
    expect(apps.get(ws)?.host).toBe('https://gitlab.com')
    await service.saveApp(ctx, ws, person, { host: '  ', clientId: 'cid' })
    expect(apps.get(ws)?.host).toBe('https://gitlab.com')
  })

  it('saveApp keeps the stored secret when only re-saving the same app without one, and accepts a renewed secret', async () => {
    const { service, apps } = setup(routes)
    await service.saveApp(ctx, ws, person, { host: 'https://gitlab.com', clientId: 'cid' })
    expect(apps.get(ws)?.clientSecret).toBe('cs')
    await service.saveApp(ctx, ws, person, { host: 'https://gitlab.com', clientId: 'cid', clientSecret: 'renewed' })
    expect(apps.get(ws)?.clientSecret).toBe('renewed')
  })

  it('saveApp refuses to change host or client id while GitLab connections exist', async () => {
    const { service } = setup(routes)
    await service.authorize(ctx, { code: 'c', state, caller })
    await expect(service.saveApp(ctx, ws, person, { host: 'https://other.example', clientId: 'cid', clientSecret: 'x' })).rejects.toThrow(
      'Disconnect GitLab before changing the application'
    )
    await expect(service.saveApp(ctx, ws, person, { host: 'https://gitlab.com', clientId: 'cid2', clientSecret: 'x' })).rejects.toThrow(
      'Disconnect GitLab before changing the application'
    )
  })

  it('removeApp refuses while connections exist and succeeds after disconnect', async () => {
    const { service, apps } = setup({ ...routes, 'DELETE https://gitlab.com/api/v4/projects/5/hooks/77': {} })
    await service.authorize(ctx, { code: 'c', state, caller })
    await expect(service.removeApp(ctx, ws)).rejects.toThrow('Disconnect GitLab before changing the application')
    await service.disconnect(ctx, ws, person)
    await service.removeApp(ctx, ws)
    expect(apps.get(ws)).toBeUndefined()
  })

  it('the refusal to change or remove the application names who is connected', async () => {
    const { service, client } = setup(routes)
    await service.authorize(ctx, { code: 'c', state, caller })
    client.docs.push({ _id: 'bob-int', _class: gitlab.class.GitlabIntegration, connectedBy: 'p2', login: 'bob', host: 'https://gitlab.com', gitlabUserId: 7 })
    const message = 'Disconnect GitLab before changing the application (connected: alice, bob)'
    await expect(service.saveApp(ctx, ws, person, { host: 'https://other.example', clientId: 'cid', clientSecret: 'x' })).rejects.toThrow(message)
    await expect(service.removeApp(ctx, ws)).rejects.toThrow(message)
  })

  describe('disconnectAll', () => {
    const allRoutes = {
      ...routes,
      'GET https://gitlab.com/api/v4/projects/5/hooks': [],
      'POST https://gitlab.com/api/v4/projects/5/hooks': { id: 77, url: 'https://hooks.example.com/api/webhook' },
      'DELETE https://gitlab.com/api/v4/projects/5/hooks/77': {},
      'DELETE https://gitlab.com/api/v4/projects/9/hooks/88': {}
    }

    async function prepareAll (): Promise<any> {
      const env = setup(allRoutes)
      await env.service.authorize(ctx, { code: 'c', state, caller })
      const repo = env.client.docs.find((d: any) => d._class === gitlab.class.GitlabIntegrationRepository)
      await env.service.enableRepository(ctx, ws, repo._id)
      // A second member (bob, p2) connected earlier and has a hooked repository.
      env.client.docs.push({ _id: 'bob-int', _class: gitlab.class.GitlabIntegration, connectedBy: 'p2', login: 'bob', host: 'https://gitlab.com', gitlabUserId: 7 })
      env.client.docs.push({ _id: 'bob-repo', _class: gitlab.class.GitlabIntegrationRepository, attachedTo: 'bob-int', projectId: 9, hookId: 88 })
      env.client.docs.push({ _id: 'bob-auth', _class: gitlab.class.GitlabAuthentication, attachedTo: 'p2', login: 'bob' })
      const tokens: Record<string, string> = { p1: 'tok', p2: 'bobtok' }
      env.users.getValidRecord.mockImplementation(async (_w: WorkspaceUuid, socialId: PersonId) => ({ account: socialId, token: tokens[socialId] }))
      return env
    }

    it('continues with the next member when one has no account integration row', async () => {
      const { service, users, accounts } = await prepareAll()
      accounts.deleteIntegration.mockImplementation(async (key: any) => {
        if (key.socialId === 'p1') throw new Error('IntegrationNotFound')
      })
      await service.disconnectAll(ctx, ws)
      expect(users.remove).toHaveBeenCalledWith(ws, 'p1')
      expect(users.remove).toHaveBeenCalledWith(ws, 'p2')
    })

    it("removes every member's integration, repositories, hooks, auth docs, account rows and tokens", async () => {
      const { service, client, users, accounts, requests } = await prepareAll()
      await service.disconnectAll(ctx, ws)
      const classes = [gitlab.class.GitlabIntegration, gitlab.class.GitlabIntegrationRepository, gitlab.class.GitlabAuthentication]
      expect(client.docs.filter((d: any) => classes.includes(d._class))).toEqual([])
      const deletes = requests.filter((r: any) => r.key.startsWith('DELETE'))
      expect(deletes).toEqual(expect.arrayContaining([
        { key: 'DELETE https://gitlab.com/api/v4/projects/5/hooks/77', auth: 'Bearer tok' },
        { key: 'DELETE https://gitlab.com/api/v4/projects/9/hooks/88', auth: 'Bearer bobtok' }
      ]))
      expect(deletes).toHaveLength(2)
      expect(accounts.deleteIntegration).toHaveBeenCalledWith({ kind: 'gitlab', workspaceUuid: ws, socialId: 'p1' })
      expect(accounts.deleteIntegration).toHaveBeenCalledWith({ kind: 'gitlab', workspaceUuid: ws, socialId: 'p2' })
      expect(users.remove).toHaveBeenCalledWith(ws, 'p1')
      expect(users.remove).toHaveBeenCalledWith(ws, 'p2')
      expect(users.remove).toHaveBeenCalledTimes(2)
    })

    it('removes tokens only after hook cleanup', async () => {
      const { service, users, requests } = await prepareAll()
      users.remove.mockImplementation(async () => {
        expect(requests.filter((r: any) => r.key.startsWith('DELETE'))).toHaveLength(2)
      })
      await service.disconnectAll(ctx, ws)
      expect(users.remove).toHaveBeenCalledTimes(2)
    })

    it("still removes a member's docs when their token cannot be refreshed", async () => {
      const { service, client, users, requests } = await prepareAll()
      const valid = users.getValidRecord.getMockImplementation()
      users.getValidRecord.mockImplementation(async (w: WorkspaceUuid, socialId: PersonId) => {
        if (socialId === 'p2') throw new Error('invalid_grant')
        return await valid(w, socialId)
      })
      await service.disconnectAll(ctx, ws)
      expect(client.docs.filter((d: any) => d._class === gitlab.class.GitlabIntegration)).toEqual([])
      expect(requests.filter((r: any) => r.key.startsWith('DELETE')).map((r: any) => r.key)).toEqual(['DELETE https://gitlab.com/api/v4/projects/5/hooks/77'])
      expect(users.remove).toHaveBeenCalledWith(ws, 'p2')
    })

    it('unblocks removing the application', async () => {
      const { service, apps } = await prepareAll()
      await service.disconnectAll(ctx, ws)
      await service.removeApp(ctx, ws)
      expect(apps.get(ws)).toBeUndefined()
    })
  })

  describe('disconnect', () => {
    const disconnectRoutes = {
      ...routes,
      'GET https://gitlab.com/api/v4/projects/5/hooks': [],
      'POST https://gitlab.com/api/v4/projects/5/hooks': { id: 77, url: 'https://hooks.example.com/api/webhook' }
    }

    async function prepare (extra: Record<string, unknown>): Promise<any> {
      const env = setup({ ...disconnectRoutes, ...extra })
      await env.service.authorize(ctx, { code: 'c', state, caller })
      const repo = env.client.docs.find((d: any) => d._class === gitlab.class.GitlabIntegrationRepository)
      await env.service.enableRepository(ctx, ws, repo._id)
      env.client.docs.push({ _id: 'other-int', _class: gitlab.class.GitlabIntegration, connectedBy: 'p2', host: 'https://gitlab.com', gitlabUserId: 7 })
      env.client.docs.push({ _id: 'other-repo', _class: gitlab.class.GitlabIntegrationRepository, attachedTo: 'other-int', projectId: 9, hookId: null })
      return { ...env, myIntegration: repo.attachedTo, myRepo: repo._id }
    }

    it("disconnect removes only the caller's integration, its repositories and hooks", async () => {
      const { service, client, calls, accounts, myIntegration, myRepo } = await prepare({
        'DELETE https://gitlab.com/api/v4/projects/5/hooks/77': {}
      })
      await service.disconnect(ctx, ws, person)
      const ids = client.docs.map((d: any) => d._id)
      expect(ids).not.toContain(myIntegration)
      expect(ids).not.toContain(myRepo)
      expect(ids).toContain('other-int')
      expect(ids).toContain('other-repo')
      expect(calls).toContain('DELETE https://gitlab.com/api/v4/projects/5/hooks/77')
      expect(client.docs.filter((d: any) => d._class === gitlab.class.GitlabAuthentication && d.attachedTo === person)).toEqual([])
      expect(accounts.deleteIntegration).toHaveBeenCalledWith({ kind: 'gitlab', workspaceUuid: ws, socialId: person })
    })

    it("disconnect removes the caller's workspace-scoped GitLab token after hook cleanup", async () => {
      const { service, users, calls } = await prepare({ 'DELETE https://gitlab.com/api/v4/projects/5/hooks/77': {} })
      users.remove.mockImplementationOnce(async () => {
        // The token must still be available for hook cleanup, so remove runs last.
        expect(calls).toContain('DELETE https://gitlab.com/api/v4/projects/5/hooks/77')
      })
      await service.disconnect(ctx, ws, person)
      expect(users.remove).toHaveBeenCalledTimes(1)
      expect(users.remove).toHaveBeenCalledWith(ws, person)
    })

    it('disconnect drops the removed repositories from linked tracker projects', async () => {
      const { service, client, myIntegration, myRepo } = await prepare({ 'DELETE https://gitlab.com/api/v4/projects/5/hooks/77': {} })
      client.docs.push({
        _id: 'prj1',
        _class: tracker.class.Project,
        space: 'core:space:Space',
        [gitlab.mixin.GitlabProject]: { integration: myIntegration, repositories: [myRepo] }
      })
      client.docs.push({
        _id: 'prj2',
        _class: tracker.class.Project,
        space: 'core:space:Space',
        [gitlab.mixin.GitlabProject]: { integration: 'other-int', repositories: ['other-repo'] }
      })
      await service.disconnect(ctx, ws, person)
      const prj1 = client.docs.find((d: any) => d._id === 'prj1')
      expect(prj1[gitlab.mixin.GitlabProject].repositories).toEqual([])
      expect(prj1[gitlab.mixin.GitlabProject].integration).toBe(myIntegration)
      expect(client.docs.find((d: any) => d._id === 'prj2')[gitlab.mixin.GitlabProject].repositories).toEqual(['other-repo'])
    })

    it('disconnect still removes docs when the hook delete fails', async () => {
      const { service, client, calls, users, myIntegration, myRepo } = await prepare({})
      users.getValidRecord.mockResolvedValue(undefined)
      await service.disconnect(ctx, ws, person)
      const ids = client.docs.map((d: any) => d._id)
      expect(ids).not.toContain(myIntegration)
      expect(ids).not.toContain(myRepo)
      expect(ids).toContain('other-int')
      expect(calls.filter((c: string) => c.startsWith('DELETE'))).toEqual([])
    })
  })
})
