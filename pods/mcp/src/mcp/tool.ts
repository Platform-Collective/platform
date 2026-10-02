// SPDX-License-Identifier: EPL-2.0

import { type AccountUuid, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'

import { type SessionIdentity } from '../auth/authenticator'
import { type WorkspaceSession } from '../platform/workspace-client-provider'
import { errorResult, type McpToolCallResult } from './protocol'
import { type JsonSchema, type McpToolDescriptor, type ToolArguments } from './schema'
import { validateArguments } from './validation'

/** Everything a tool handler is allowed to touch. */
export interface ToolContext extends WorkspaceSession {
  /** Per-request child context, so tool spans are attributed correctly. */
  ctx: MeasureContext
  account: AccountUuid
  workspace: WorkspaceUuid
  /** Read-only flag of THIS request's identity — the write gate reads it, not the cached one. */
  readOnly: boolean
}

export interface HulyTool {
  name: string
  title: string
  description: string
  /**
   * Read-only tools are the default. A tool must opt in to writing by setting
   * this to false, which also makes it unavailable to read-only tokens.
   */
  readOnly: boolean
  /** True when a call can destroy data; surfaced as the MCP destructive hint. */
  destructive?: boolean
  inputSchema: JsonSchema
  handler: (ctx: ToolContext, args: ToolArguments) => Promise<McpToolCallResult>
}

/**
 * Builds the context for one tool call.
 *
 * `identity` must be the identity authenticated for the CURRENT request — it
 * is the source of the `readOnly` flag that `ToolRegistry.call` uses to refuse
 * writes. It must never be pulled from the shared client cache: a full-access
 * request could have populated that cache first, and the write would then run
 * under the wrong token.
 *
 * The parameter defaults to `session.identity` for older call sites. That
 * fallback cannot cross privilege classes in practice, because the provider
 * keys its cache by the read-only flag too, but production code (the
 * dispatcher) passes the identity explicitly so the authorization source is
 * visible at the call site.
 */
export function toolContext (
  session: WorkspaceSession,
  ctx: MeasureContext,
  identity: SessionIdentity = session.identity
): ToolContext {
  return {
    ...session,
    ctx,
    // The whole context describes THIS request: identity first, then the
    // fields derived from it, so nothing can be read off the shared cache.
    identity,
    account: identity.account,
    workspace: identity.workspace,
    readOnly: identity.readOnly
  }
}

/**
 * Registry of MCP tools.
 *
 * Registration fails fast on duplicates: a silently shadowed tool is the kind
 * of bug that only shows up as "the agent called the wrong thing".
 */
export class ToolRegistry {
  private readonly tools = new Map<string, HulyTool>()

  register (tool: HulyTool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} is already registered`)
    }
    this.tools.set(tool.name, tool)
    return this
  }

  registerAll (tools: HulyTool[]): this {
    tools.forEach((tool) => this.register(tool))
    return this
  }

  get (name: string): HulyTool | undefined {
    return this.tools.get(name)
  }

  has (name: string): boolean {
    return this.tools.has(name)
  }

  get size (): number {
    return this.tools.size
  }

  /** Lists tools; a read-only caller is not shown tools it could never run. */
  list (options: { readOnly?: boolean } = {}): McpToolDescriptor[] {
    const visible = [...this.tools.values()].filter((tool) => options.readOnly !== true || tool.readOnly)
    return visible.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: tool.readOnly,
        destructiveHint: tool.destructive ?? false,
        idempotentHint: tool.readOnly
      }
    }))
  }

  /**
   * Validates and runs a tool.
   *
   * Returns (rather than throws) for the three failures that are the agent's
   * fault and are worth retrying with different arguments: unknown tool, bad
   * arguments, and a write attempt from a read-only token. Reporting those as
   * `isError` results lets the model self-correct; the transport stays a
   * successful JSON-RPC call.
   */
  async call (name: string, rawArgs: unknown, context: ToolContext): Promise<McpToolCallResult> {
    const tool = this.tools.get(name)
    if (tool === undefined) {
      const available = [...this.tools.keys()].join(', ')
      return errorResult(`Unknown tool "${name}". Available tools: ${available}`)
    }

    if (!tool.readOnly && context.readOnly) {
      return errorResult(`Tool "${name}" modifies data and this token is read-only.`)
    }

    const validation = validateArguments(tool.inputSchema, rawArgs)
    if (!validation.ok) {
      return errorResult(`Invalid arguments for "${name}": ${validation.issues.join('; ')}`)
    }

    return await context.ctx.with(tool.name, { tool: tool.name, readOnly: tool.readOnly }, async (ctx) => {
      try {
        return await tool.handler({ ...context, ctx }, validation.value)
      } catch (err) {
        // Surfaced as a tool error, never as an HTTP 500: the agent needs the
        // reason in order to try a different approach.
        const message = err instanceof Error ? err.message : String(err)
        ctx.error('mcp tool failed', { tool: tool.name, error: message })
        return errorResult(`Tool "${name}" failed: ${message}`)
      }
    })
  }
}
