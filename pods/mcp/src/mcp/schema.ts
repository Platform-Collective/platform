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

// The subset of JSON Schema that MCP tool `inputSchema` values use.
//
// This is intentionally a closed subset: tool authors get a small surface with
// good error messages instead of a general purpose JSON Schema engine. The
// validator in ./validation.ts and the types in this file must stay in sync —
// anything not listed here is rejected by validation instead of silently
// ignored, which is what keeps tools and validators from drifting apart.

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

export interface JsonSchema {
  type?: JsonSchemaType
  description?: string
  title?: string

  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean

  items?: JsonSchema

  enum?: Array<string | number | boolean | null>

  default?: unknown

  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string

  format?: string
}

export type ToolArguments = Record<string, unknown>

/** Shape returned to clients by `tools/list`. */
export interface McpToolDescriptor {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
  }
}

/** Small helpers so tool definitions read declaratively and stay DRY. */
export const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

export const stringProp = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({
  type: 'string',
  description,
  ...extra
})

export const numberProp = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({
  type: 'number',
  description,
  ...extra
})

export const booleanProp = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({
  type: 'boolean',
  description,
  ...extra
})
