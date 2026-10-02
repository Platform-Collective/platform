// SPDX-License-Identifier: EPL-2.0

// The subset of JSON Schema that MCP tool `inputSchema` values use.
//
// This is intentionally a closed subset: tool authors get a small surface with
// good error messages instead of a general purpose JSON Schema engine. The
// validator in ./validation.ts and the types in this file must stay in sync —
// anything not listed here is rejected by validation instead of silently
// ignored, which is what keeps tools and validators from drifting apart.

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

export interface JsonSchema {
  /** A single type, or a list when the value may be one of several (e.g. `['string', 'null']`). */
  type?: JsonSchemaType | JsonSchemaType[]
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

/** A string that may also be `null`, for fields where `null` means "clear this value". */
export const nullableStringProp = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({
  type: ['string', 'null'],
  description,
  ...extra
})
