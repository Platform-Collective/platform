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

import { type JsonSchema, type JsonSchemaType, type ToolArguments } from './schema'

// Minimal JSON Schema validator for the closed subset declared in ./schema.ts.
//
// Tool arguments arrive from a language model, so validation is a trust
// boundary: it is the only thing standing between a hallucinated argument and
// a malformed Huly query. It therefore fails fast and reports every issue at
// once, so an agent can correct the whole call in one round trip.

export type ValidationResult =
  | { ok: true, value: ToolArguments }
  | { ok: false, issues: string[] }

const MAX_PATTERN_LENGTH = 512
const patternCache = new Map<string, RegExp>()

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function typeOf (value: unknown): JsonSchemaType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'boolean'
  // bigint, symbol, function and undefined can all arrive from a JS caller
  // even though JSON cannot carry them; treat them all as a type mismatch.
  return 'object'
}

function matchesType (value: unknown, type: JsonSchemaType): boolean {
  const actual = typeOf(value)
  // A JSON `1.0` is a valid `integer` per JSON Schema.
  if (type === 'number') return actual === 'number' || actual === 'integer'
  if (type === 'integer') return actual === 'integer'
  return actual === type
}

function compilePattern (pattern: string): RegExp | undefined {
  const cached = patternCache.get(pattern)
  if (cached !== undefined) return cached
  if (pattern.length > MAX_PATTERN_LENGTH) return undefined
  try {
    const compiled = new RegExp(pattern)
    patternCache.set(pattern, compiled)
    return compiled
  } catch {
    // An uncompilable pattern is a bug in the tool definition, not in the
    // arguments. Fail fast at call time rather than rejecting every request.
    throw new Error(`Tool schema declares an invalid pattern: ${pattern}`)
  }
}

/** Validates a single value against a schema node, collecting issues. */
function validateValue (value: unknown, schema: JsonSchema, path: string, issues: string[]): void {
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    issues.push(`${path} must be of type ${schema.type} (received ${typeOf(value)})`)
    return
  }

  if (schema.enum !== undefined) {
    if (!schema.enum.some((allowed) => allowed === value)) {
      issues.push(`${path} must be one of: ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}`)
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push(`${path} must be at least ${schema.minLength} characters long`)
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push(`${path} must be at most ${schema.maxLength} characters long`)
    }
    if (schema.pattern !== undefined) {
      const regex = compilePattern(schema.pattern)
      if (regex !== undefined && !regex.test(value)) {
        issues.push(`${path} must match the pattern ${schema.pattern}`)
      }
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push(`${path} must be greater than or equal to ${schema.minimum}`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push(`${path} must be less than or equal to ${schema.maximum}`)
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push(`${path} must contain at least ${schema.minItems} items`)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push(`${path} must contain at most ${schema.maxItems} items`)
    }
    if (schema.items !== undefined) {
      value.forEach((entry, index) => {
        validateValue(entry, schema.items as JsonSchema, `${path}[${index}]`, issues)
      })
    }
  }

  if (isPlainObject(value) && schema.properties !== undefined) {
    validateObject(value, schema, path, issues)
  }
}

function validateObject (
  value: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  issues: string[]
): void {
  const properties = schema.properties ?? {}
  const required = schema.required ?? []

  for (const key of required) {
    if (value[key] === undefined) {
      issues.push(`${path === '' ? key : `${path}.${key}`} is required`)
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    const childPath = path === '' ? key : `${path}.${key}`
    const propertySchema = properties[key]
    if (propertySchema === undefined) {
      if (schema.additionalProperties === false) {
        issues.push(`${childPath} is not an accepted property. Accepted: ${Object.keys(properties).join(', ')}`)
      }
      continue
    }
    if (entry === undefined) continue
    validateValue(entry, propertySchema, childPath, issues)
  }
}

/**
 * Validates untyped tool arguments against the tool's input schema and applies
 * declared defaults, so handlers can rely on required properties being present.
 */
export function validateArguments (schema: JsonSchema, args: unknown): ValidationResult {
  const issues: string[] = []
  const input = args === undefined || args === null ? {} : args

  if (!isPlainObject(input)) {
    return { ok: false, issues: ['arguments must be an object'] }
  }

  const properties = schema.properties ?? {}
  const required = schema.required ?? []

  for (const key of required) {
    if (input[key] === undefined) {
      issues.push(`${key} is required`)
    }
  }

  for (const [key, entry] of Object.entries(input)) {
    const propertySchema = properties[key]
    if (propertySchema === undefined) {
      if (schema.additionalProperties === false) {
        issues.push(`${key} is not an accepted property. Accepted: ${Object.keys(properties).join(', ')}`)
      }
      continue
    }
    if (entry === undefined) continue
    validateValue(entry, propertySchema, key, issues)
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  const value: ToolArguments = { ...input }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (value[key] === undefined && propertySchema.default !== undefined) {
      value[key] = propertySchema.default
    }
  }

  return { ok: true, value }
}
