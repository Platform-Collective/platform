// SPDX-License-Identifier: EPL-2.0

import { type TxOperations } from '@hcengineering/core'

import { fakeIdentity, fakeMeasureContext } from '../../__tests__/test-doubles'
import { type SessionIdentity } from '../../auth/authenticator'
import { type AccountApi, type AccountApiFactory } from '../../platform/account-api'
import { CachingWorkspaceClientProvider, type ClientFactory } from '../../platform/workspace-client-provider'
import { McpDispatcher } from '../dispatcher'
import { type JsonRpcResponseMessage } from '../protocol'
import { McpSession } from '../session'
import { type HulyTool, ToolRegistry } from '../tool'

const ctx = fakeMeasureContext()

const request = (method: string, params?: unknown, id: number = 1): Record<string, unknown> => {
  const base: Record<string, unknown> = { jsonrpc: '2.0', id, method }
  return params === undefined ? base : { ...base, params }
}

const resultOf = (response: JsonRpcResponseMessage | null): { isError?: boolean, content: Array<{ text: string }> } => {
  const payload = response as { result: { isError?: boolean, content: Array<{ text: string }> } }
  return payload.result
}

interface Harness {
  dispatcher: McpDispatcher
  provider: CachingWorkspaceClientProvider
  /** One entry per client build, in call order. */
  built: SessionIdentity[]
  /** Every write that actually reached a tool handler. */
  writes: string[]
}

const makeHarness = (): Harness => {
  const built: SessionIdentity[] = []
  const writes: string[] = []

  const createClient: ClientFactory = async (identity) => {
    built.push(identity)
    const client = { close: async () => {} }
    return client as unknown as TxOperations
  }
  const createAccounts: AccountApiFactory = () => Object.create(null) as AccountApi

  const provider = new CachingWorkspaceClientProvider({
    ctx,
    createClient,
    createAccounts,
    sweepIntervalMs: 600_000
  })

  const echoTool: HulyTool = {
    name: 'echo',
    title: 'Echo',
    description: 'echoes',
    readOnly: true,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    handler: async (_c, args) => ({ content: [{ type: 'text', text: String(args.value) }] })
  }
  const writeTool: HulyTool = {
    name: 'write',
    title: 'Write',
    description: 'writes',
    readOnly: false,
    inputSchema: { type: 'object' },
    handler: async () => {
      writes.push('write')
      return { content: [{ type: 'text', text: 'written' }] }
    }
  }

  const dispatcher = new McpDispatcher({
    ctx,
    registry: new ToolRegistry().registerAll([echoTool, writeTool]),
    serverName: 'huly-mcp',
    serverVersion: '0.7.0',
    // Mirrors server.ts: the workspace client comes from the shared cache,
    // keyed by the identity the transport verified for this request.
    resolveSession: async (session) => await provider.get(session.identity)
  })

  return { dispatcher, provider, built, writes }
}

const initialize = async (dispatcher: McpDispatcher, session: McpSession): Promise<void> => {
  await dispatcher.dispatch(session, request('initialize'))
}

describe('read-only token against a warm full-access cache', () => {
  it('refuses the write and uses a separate cache entry instead of the full-access client', async () => {
    const { dispatcher, provider, built, writes } = makeHarness()

    // Step 1: the user's full-access token fills the cache first.
    const full = new McpSession('sess-full', fakeIdentity({ workspaceToken: 'full-token' }), 0)
    await initialize(dispatcher, full)
    const allowed = await dispatcher.dispatch(full, request('tools/call', { name: 'write' }))
    expect(resultOf(allowed).content[0].text).toBe('written')
    expect(writes).toHaveLength(1)

    // Step 2: a read-only token for the SAME account:workspace. Before the
    // fix this reused the cached full-access session, so the gate saw
    // readOnly === false and the write ran under the full-access token.
    const readOnly = new McpSession(
      'sess-ro',
      fakeIdentity({ readOnly: true, workspaceToken: 'read-only-token' }),
      0
    )
    await initialize(dispatcher, readOnly)
    const refused = await dispatcher.dispatch(readOnly, request('tools/call', { name: 'write' }))

    expect(resultOf(refused).isError).toBe(true)
    expect(resultOf(refused).content[0].text).toContain('read-only')
    // The handler never ran: no write left the process for the read-only token.
    expect(writes).toHaveLength(1)
    // Two privilege classes, two cache entries, two clients.
    expect(built.map((identity) => identity.readOnly)).toEqual([false, true])
    expect(provider.size).toBe(2)

    await provider.close()
  })

  it('shows each session only the tools its privilege class may run', async () => {
    const { dispatcher, provider } = makeHarness()
    const readOnly = new McpSession('sess-ro', fakeIdentity({ readOnly: true }), 0)
    const full = new McpSession('sess-full', fakeIdentity(), 0)
    await initialize(dispatcher, readOnly)
    await initialize(dispatcher, full)

    const roList = await dispatcher.dispatch(readOnly, request('tools/list'))
    const roTools = (roList as { result: { tools: Array<{ name: string }> } }).result.tools
    expect(roTools.map((tool) => tool.name)).toEqual(['echo'])

    const fullList = await dispatcher.dispatch(full, request('tools/list'))
    const fullTools = (fullList as { result: { tools: Array<{ name: string }> } }).result.tools
    expect(fullTools.map((tool) => tool.name)).toEqual(['echo', 'write'])

    // Listing never resolves a workspace client, so the cache stays cold.
    expect(provider.size).toBe(0)

    await provider.close()
  })
})
