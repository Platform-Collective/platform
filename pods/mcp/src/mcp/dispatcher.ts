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

import { type MeasureContext } from '@hcengineering/core'

import { type WorkspaceSession } from '../platform/workspace-client-provider'

import {
  ErrorCode,
  isJsonRpcNotification,
  isJsonRpcRequest,
  LATEST_PROTOCOL_VERSION,
  RpcError,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcRequest,
  type JsonRpcResponseMessage,
  successResponse
} from './protocol'
import { type McpSession } from './session'
import { toolContext, type ToolRegistry } from './tool'

export interface McpDispatcherOptions {
  ctx: MeasureContext
  registry: ToolRegistry
  serverName: string
  serverVersion: string
  /** Free-form guidance shown to the model after `initialize`. */
  instructions?: string
  /**
   * Resolves the workspace client for the session. Injected rather than
   * constructed so the dispatcher stays free of platform dependencies and can be
   * tested with a fake.
   */
  resolveSession: (session: McpSession) => Promise<WorkspaceSession>
}

interface InitializeResult {
  protocolVersion: string
  capabilities: Record<string, unknown>
  serverInfo: { name: string, version: string }
  instructions?: string
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/**
 * Routes MCP JSON-RPC methods to handlers.
 *
 * Knows nothing about HTTP, SSE or sessions-on-the-wire: it takes a message and
 * a session and returns a response (or `null` for notifications). That keeps the
 * protocol rules unit-testable without a socket, and lets the transport layer
 * change without touching any MCP semantics.
 */
export class McpDispatcher {
  private readonly ctx: MeasureContext
  private readonly registry: ToolRegistry
  private readonly serverName: string
  private readonly serverVersion: string
  private readonly instructions: string | undefined
  private readonly resolveSession: McpDispatcherOptions['resolveSession']

  constructor (options: McpDispatcherOptions) {
    this.ctx = options.ctx
    this.registry = options.registry
    this.serverName = options.serverName
    this.serverVersion = options.serverVersion
    this.instructions = options.instructions
    this.resolveSession = options.resolveSession
  }

  /**
   * @returns a response, or `null` when the message was a notification (which
   * by JSON-RPC rules must not be answered).
   */
  async dispatch (session: McpSession, message: unknown): Promise<JsonRpcResponseMessage | null> {
    if (isJsonRpcNotification(message)) {
      await this.handleNotification(session, message.method)
      return null
    }

    if (!isJsonRpcRequest(message)) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: ErrorCode.InvalidRequest, message: 'Not a valid JSON-RPC 2.0 request' }
      }
    }

    const request = message as JsonRpcRequest

    // Guard every method except initialize: a client that skips the handshake
    // would otherwise be able to call tools with no negotiated protocol version.
    if (request.method !== 'initialize' && session.protocolVersion === undefined) {
      return this.fail(request.id, ErrorCode.InvalidRequest, 'Session is not initialized')
    }

    try {
      const result = await this.handleRequest(session, request)
      return successResponse(request.id, result)
    } catch (err) {
      if (err instanceof RpcError) {
        return { jsonrpc: '2.0', id: request.id, error: { code: err.code, message: err.message } }
      }
      const error = err as Error
      this.ctx.error('mcp dispatch failed', { method: request.method, error: error?.message })
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: ErrorCode.InternalError, message: 'Internal server error' }
      }
    }
  }

  private async handleNotification (session: McpSession, method: string): Promise<void> {
    if (method === 'notifications/initialized' || method === 'initialized') {
      session.initialized = true
      this.ctx.info('mcp session initialized', { session: session.id })
    }
  }

  private async handleRequest (session: McpSession, request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return this.initialize(session, request.params)
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: this.registry.list() }
      case 'tools/call':
        return await this.callTool(session, request.params)
      case 'resources/list':
        return { resources: [] }
      case 'prompts/list':
        return { prompts: [] }
      default:
        throw new RpcError(ErrorCode.MethodNotFound, `Method not found: ${request.method}`)
    }
  }

  private initialize (session: McpSession, params: unknown): InitializeResult {
    const requested = isNonEmptyString((params as { protocolVersion?: unknown })?.protocolVersion)
      ? (params as { protocolVersion: string }).protocolVersion
      : undefined

    // Per spec: echo the client's version when we support it, otherwise answer
    // with our own latest and let the client decide whether to continue.
    const protocolVersion =
      requested !== undefined && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION

    session.protocolVersion = protocolVersion

    return {
      protocolVersion,
      capabilities: {
        tools: { listChanged: false }
      },
      serverInfo: { name: this.serverName, version: this.serverVersion },
      ...(this.instructions === undefined ? {} : { instructions: this.instructions })
    }
  }

  private async callTool (session: McpSession, params: unknown): Promise<unknown> {
    const args = params as { name?: unknown, arguments?: unknown } | undefined
    if (!isNonEmptyString(args?.name)) {
      throw new RpcError(ErrorCode.InvalidParams, 'tools/call requires a "name" parameter')
    }

    const workspaceSession = await this.resolveSession(session)
    const context = toolContext(workspaceSession, this.ctx.newChild(args.name, {}, { span: false }))

    return await this.registry.call(args.name, args.arguments, context)
  }

  private fail (id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponseMessage {
    return { jsonrpc: '2.0', id, error: { code, message } }
  }
}
