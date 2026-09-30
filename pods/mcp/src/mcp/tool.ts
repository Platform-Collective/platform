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

import { type AccountUuid, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'

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

export function toolContext (session: WorkspaceSession, ctx: MeasureContext): ToolContext {
  return {
    ...session,
    ctx,
    account: session.identity.account,
    workspace: session.identity.workspace,
    readOnly: session.identity.readOnly
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
