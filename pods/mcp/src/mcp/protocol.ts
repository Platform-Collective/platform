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

// JSON-RPC 2.0 + MCP message shapes.
//
// The MCP server side of the wire format is small and stable, so it is
// implemented here directly instead of pulling a protocol SDK (and its
// transitive zod dependency) into the monorepo. Everything below is pure data
// plus guards: no I/O, no framework coupling, trivially unit tested.

export const JSONRPC_VERSION = '2.0' as const

/**
 * Protocol revisions this server understands, newest first. `initialize` picks
 * the client's revision when it is listed here, otherwise we answer with
 * LATEST_PROTOCOL_VERSION and let the client decide whether to continue.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

export type JsonRpcId = string | number

export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION
  id: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION
  method: string
  params?: unknown
}

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: typeof JSONRPC_VERSION
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcErrorResponse {
  jsonrpc: typeof JSONRPC_VERSION
  id: JsonRpcId | null
  error: JsonRpcErrorObject
}

export type JsonRpcResponseMessage = JsonRpcResponse | JsonRpcErrorResponse

/** Standard JSON-RPC 2.0 error codes plus the MCP/HTTP-relevant additions. */
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603
} as const

/**
 * A JSON-RPC level failure. Anything thrown that is *not* a RpcError is
 * reported to the client as InternalError, so internal messages never leak.
 */
export class RpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor (code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.data = data
  }
}

export function isJsonRpcId (value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

export function isJsonRpcRequest (value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>

  if (candidate.jsonrpc !== JSONRPC_VERSION) return false
  if (typeof candidate.method !== 'string' || candidate.method.length === 0) return false
  if (!isJsonRpcId(candidate.id)) return false

  // `params` is optional; when present it must be a structured value.
  if (candidate.params !== undefined) {
    return typeof candidate.params === 'object' && candidate.params !== null && !Array.isArray(candidate.params)
  }
  return true
}

export function isJsonRpcNotification (value: unknown): value is JsonRpcNotification {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>

  if (candidate.jsonrpc !== JSONRPC_VERSION) return false
  if (typeof candidate.method !== 'string' || candidate.method.length === 0) return false
  // The absence of `id` is what makes it a notification rather than a request.
  return candidate.id === undefined
}

export function successResponse (id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result }
}

export function errorResponse (
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

/* -------------------------------------------------------------------------- */
/* MCP content blocks                                                          */
/* -------------------------------------------------------------------------- */

export interface McpTextContent {
  type: 'text'
  text: string
}

export type McpContentBlock = McpTextContent

export interface McpToolCallResult {
  content: McpContentBlock[]
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

export function textResult (text: string, structuredContent?: Record<string, unknown>): McpToolCallResult {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent === undefined ? {} : { structuredContent })
  }
}

export function errorResult (message: string): McpToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function isMcpTextContent (value: unknown): value is McpTextContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === 'text' &&
    typeof (value as Record<string, unknown>).text === 'string'
  )
}
