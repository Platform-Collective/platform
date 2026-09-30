/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { fakeIdentity, fakeMeasureContext, fakeWorkspaceSession } from '../../__tests__/test-doubles'
import { McpDispatcher } from '../dispatcher'
import { McpSession } from '../session'
import { ToolRegistry } from '../tool'

const ctx = fakeMeasureContext()

function makeDispatcher (registry: ToolRegistry): McpDispatcher {
  return new McpDispatcher({
    ctx,
    registry,
    serverName: 'huly-mcp',
    serverVersion: '0.7.0',
    instructions: 'hello',
    resolveSession: async (session) => fakeWorkspaceSession(session.identity)
  })
}

const makeSession = (): McpSession => new McpSession('sess-1', fakeIdentity(), 0)

const request = (method: string, params?: unknown, id: number = 1): Record<string, unknown> => {
  const base: Record<string, unknown> = { jsonrpc: '2.0', id, method }
  return params === undefined ? base : { ...base, params }
}

const registryWithEcho = (): ToolRegistry =>
  new ToolRegistry().register({
    name: 'echo',
    title: 'Echo',
    description: 'echoes',
    readOnly: true,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    handler: async (_c, args) => ({ content: [{ type: 'text', text: String(args.value) }] })
  })

/** Initializes a session so subsequent calls are allowed. */
const initialized = async (dispatcher: McpDispatcher, session: McpSession): Promise<void> => {
  await dispatcher.dispatch(session, request('initialize'))
}

describe('McpDispatcher', () => {
  it('negotiates a supported protocol version', async () => {
    const result = await makeDispatcher(registryWithEcho()).dispatch(
      makeSession(),
      request('initialize', { protocolVersion: '2025-03-26' })
    )
    expect(result).toMatchObject({ result: { protocolVersion: '2025-03-26' } })
  })

  it('falls back to its own latest version for an unknown one', async () => {
    const result = await makeDispatcher(registryWithEcho()).dispatch(
      makeSession(),
      request('initialize', { protocolVersion: '1999-01-01' })
    )
    expect(result).toMatchObject({ result: { protocolVersion: '2025-06-18' } })
  })

  it('advertises tool capability and server info', async () => {
    const dispatcher = makeDispatcher(registryWithEcho())
    const result = await dispatcher.dispatch(makeSession(), request('initialize'))
    const payload = (result as { result: Record<string, unknown> }).result
    expect(payload.capabilities).toEqual({ tools: { listChanged: false } })
    expect(payload.serverInfo).toEqual({ name: 'huly-mcp', version: '0.7.0' })
    expect(payload.instructions).toBe('hello')
  })

  it('refuses any method other than initialize before the handshake', async () => {
    const result = await makeDispatcher(registryWithEcho()).dispatch(makeSession(), request('tools/list'))
    expect(result).toMatchObject({ error: { code: -32600 } })
  })

  it('allows tools/list once initialized', async () => {
    const dispatcher = makeDispatcher(registryWithEcho())
    const session = makeSession()
    await initialized(dispatcher, session)

    const result = await dispatcher.dispatch(session, request('tools/list'))
    const tools = (result as { result: { tools: Array<Record<string, unknown>> } }).result.tools
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('echo')
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true })
  })

  it('returns no response for a notification', async () => {
    const dispatcher = makeDispatcher(registryWithEcho())
    const session = makeSession()
    await initialized(dispatcher, session)

    const result = await dispatcher.dispatch(session, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(result).toBeNull()
    expect(session.initialized).toBe(true)
  })

  it('answers ping with an empty result', async () => {
    const dispatcher = makeDispatcher(registryWithEcho())
    const session = makeSession()
    await initialized(dispatcher, session)
    expect(await dispatcher.dispatch(session, request('ping'))).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
  })

  it('reports an unknown method as method-not-found', async () => {
    const dispatcher = makeDispatcher(registryWithEcho())
    const session = makeSession()
    await initialized(dispatcher, session)
    expect(await dispatcher.dispatch(session, request('nope/nope'))).toMatchObject({ error: { code: -32601 } })
  })

  it('rejects a malformed envelope with a null id', async () => {
    const result = await makeDispatcher(registryWithEcho()).dispatch(makeSession(), { hello: 'world' })
    expect(result).toMatchObject({ id: null, error: { code: -32600 } })
  })

  it('requires a name for tools/call', async () => {
    const dispatcher = makeDispatcher(registryWithEcho())
    const session = makeSession()
    await initialized(dispatcher, session)
    expect(await dispatcher.dispatch(session, request('tools/call', {}))).toMatchObject({
      error: { code: -32602 }
    })
  })

  it('runs a tool and returns its content', async () => {
    const dispatcher = makeDispatcher(registryWithEcho())
    const session = makeSession()
    await initialized(dispatcher, session)

    const result = await dispatcher.dispatch(
      session,
      request('tools/call', { name: 'echo', arguments: { value: 'hi' } })
    )
    expect(result).toMatchObject({ result: { content: [{ type: 'text', text: 'hi' }] } })
  })

  it('surfaces a tool failure as an isError result, not a protocol error', async () => {
    const failing = new ToolRegistry().register({
      name: 'boom',
      title: 'Boom',
      description: 'always fails',
      readOnly: true,
      inputSchema: { type: 'object' },
      handler: async () => {
        throw new Error('kaboom')
      }
    })
    const dispatcher = makeDispatcher(failing)
    const session = makeSession()
    await initialized(dispatcher, session)

    const result = (await dispatcher.dispatch(session, request('tools/call', { name: 'boom' }))) as {
      error?: unknown
      result: { isError: boolean, content: Array<{ text: string }> }
    }
    expect(result.error).toBeUndefined()
    expect(result.result.isError).toBe(true)
    expect(result.result.content[0].text).toContain('kaboom')
  })

  it('lists empty resources and prompts rather than erroring', async () => {
    const dispatcher = makeDispatcher(registryWithEcho())
    const session = makeSession()
    await initialized(dispatcher, session)

    expect(await dispatcher.dispatch(session, request('resources/list'))).toMatchObject({
      result: { resources: [] }
    })
    expect(await dispatcher.dispatch(session, request('prompts/list'))).toMatchObject({
      result: { prompts: [] }
    })
  })
})
