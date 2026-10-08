// SPDX-License-Identifier: EPL-2.0

import { fakeIdentity, fakeMeasureContext, fakeToolContext, fakeWorkspaceSession } from '../../__tests__/test-doubles'
import { McpDispatcher } from '../dispatcher'
import { objectSchema } from '../schema'
import { SessionStore } from '../session'
import { toolContext, type HulyTool, ToolRegistry } from '../tool'

const ctx = fakeMeasureContext()

const echoTool: HulyTool = {
  name: 'echo',
  title: 'Echo',
  description: 'echoes',
  readOnly: true,
  inputSchema: objectSchema({ value: { type: 'string' } }),
  handler: async (_c, args) => ({ content: [{ type: 'text', text: String(args.value) }] })
}

const writeTool: HulyTool = {
  name: 'write',
  title: 'Write',
  description: 'writes',
  readOnly: false,
  inputSchema: objectSchema({}),
  handler: async () => ({ content: [{ type: 'text', text: 'written' }] })
}

describe('ToolRegistry', () => {
  it('refuses a duplicate name rather than shadowing silently', () => {
    const registry = new ToolRegistry().register(echoTool)
    expect(() => registry.register({ ...echoTool })).toThrow(/already registered/)
    expect(registry.size).toBe(1)
  })

  it('exposes MCP annotations', () => {
    const listed = new ToolRegistry().registerAll([echoTool, writeTool]).list()
    expect(listed[0].annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true })
    expect(listed[1].annotations?.readOnlyHint).toBe(false)
  })

  it('rejects an unknown tool with the list of valid ones', async () => {
    const registry = new ToolRegistry().register(echoTool)
    const result = await registry.call('nope', {}, fakeToolContext())
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('echo')
  })

  it('rejects invalid arguments before the handler runs', async () => {
    const registry = new ToolRegistry().register(echoTool)
    const result = await registry.call('echo', { value: 42 }, fakeToolContext())
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('must be of type string')
  })

  it('hides write tools from a read-only listing', () => {
    const registry = new ToolRegistry().registerAll([echoTool, writeTool])

    expect(registry.list({ readOnly: true }).map((tool) => tool.name)).toEqual([echoTool.name])
    expect(registry.list().map((tool) => tool.name)).toEqual([echoTool.name, writeTool.name])
  })

  it('blocks a write tool for a read-only identity', async () => {
    const registry = new ToolRegistry().registerAll([echoTool, writeTool])
    const identity = fakeIdentity({ readOnly: true })
    const result = await registry.call('write', {}, fakeToolContext(identity))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('read-only')
  })
})

describe('SessionStore', () => {
  it('creates, finds and deletes a session', () => {
    const store = new SessionStore({ ctx, generateId: () => 'fixed' })
    const created = store.create(fakeIdentity())
    expect(created.id).toBe('fixed')
    expect(store.get('fixed')).toBe(created)
    expect(store.delete('fixed')).toBe(true)
    expect(store.get('fixed')).toBeUndefined()
    expect(store.delete('fixed')).toBe(false)
  })

  it('generates unique ids by default', () => {
    const store = new SessionStore({ ctx })
    const ids = new Set(Array.from({ length: 50 }, () => store.create(fakeIdentity()).id))
    expect(ids.size).toBe(50)
  })

  it('drops sessions idle beyond the TTL', () => {
    let now = 0
    const store = new SessionStore({ ctx, idleTtlMs: 100, now: () => now })
    const session = store.create(fakeIdentity())

    // 50ms later the session is still well inside the window.
    now = 50
    expect(store.sweep()).toBe(0)
    expect(store.get(session.id)).toBeDefined()

    // Reading it refreshed lastSeen to 50, so it survives until 50 + TTL.
    now = 140
    expect(store.sweep()).toBe(0)

    now = 160
    expect(store.sweep()).toBe(1)
    expect(store.size).toBe(0)
  })

  it('evicts the least recently used session when full', () => {
    let now = 0
    const store = new SessionStore({ ctx, maxSessions: 2, now: () => now })
    const first = store.create(fakeIdentity())
    now = 1
    store.create(fakeIdentity())
    now = 2
    store.get(first.id)
    now = 3
    store.create(fakeIdentity())

    expect(store.get(first.id)).toBeDefined()
    expect(store.size).toBe(2)
  })

  it('binds a session to one identity', () => {
    const store = new SessionStore({ ctx })
    const session = store.create(fakeIdentity())
    expect(session.belongsTo(fakeIdentity())).toBe(true)
    expect(session.belongsTo(fakeIdentity({ account: 'other' as never }))).toBe(false)
    expect(session.belongsTo(fakeIdentity({ workspace: 'other' as never }))).toBe(false)
  })

  it('binds a session to one privilege class, not just account and workspace', () => {
    const store = new SessionStore({ ctx })
    const readOnlySession = store.create(fakeIdentity({ readOnly: true }))
    const fullSession = store.create(fakeIdentity({ readOnly: false }))

    // Same account and workspace, different read-only flag: letting the token
    // through would authorize requests as the (more privileged) identity the
    // session was initialized with.
    expect(readOnlySession.belongsTo(fakeIdentity({ readOnly: true }))).toBe(true)
    expect(readOnlySession.belongsTo(fakeIdentity({ readOnly: false }))).toBe(false)
    expect(fullSession.belongsTo(fakeIdentity({ readOnly: true }))).toBe(false)
    expect(fullSession.belongsTo(fakeIdentity({ readOnly: false }))).toBe(true)
  })
})

describe('toolContext', () => {
  it('takes readOnly from the identity of this request, not from the cached session', () => {
    const cachedFullAccess = fakeWorkspaceSession(fakeIdentity({ workspaceToken: 'full-token' }))

    const guarded = toolContext(
      cachedFullAccess,
      fakeMeasureContext(),
      fakeIdentity({ readOnly: true, workspaceToken: 'read-only-token' })
    )
    expect(guarded.readOnly).toBe(true)
    expect(guarded.identity.workspaceToken).toBe('read-only-token')

    // The opposite direction: a cached read-only session must not drag a
    // full-access request down either — the passed identity always wins.
    const cachedReadOnly = fakeWorkspaceSession(fakeIdentity({ readOnly: true, workspaceToken: 'read-only-token' }))
    const allowed = toolContext(cachedReadOnly, fakeMeasureContext(), fakeIdentity({ workspaceToken: 'full-token' }))
    expect(allowed.readOnly).toBe(false)
    expect(allowed.identity.workspaceToken).toBe('full-token')
  })
})

describe('session and dispatcher integration', () => {
  it('resolves the workspace client lazily, only when a tool is called', async () => {
    const registry = new ToolRegistry().register(echoTool)
    const store = new SessionStore({ ctx, generateId: () => 's1' })
    const session = store.create(fakeIdentity())

    let resolved = 0
    const dispatcher = new McpDispatcher({
      ctx,
      registry,
      serverName: 'huly-mcp',
      serverVersion: '0.7.0',
      resolveSession: async (s) => {
        resolved += 1
        return fakeWorkspaceSession(s.identity)
      }
    })

    await dispatcher.dispatch(session, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    await dispatcher.dispatch(session, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(resolved).toBe(0)

    await dispatcher.dispatch(session, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { value: 'x' } }
    })
    expect(resolved).toBe(1)
  })
})
