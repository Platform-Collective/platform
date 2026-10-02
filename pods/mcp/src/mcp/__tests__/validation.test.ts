// SPDX-License-Identifier: EPL-2.0

import { type JsonSchema, nullableStringProp, objectSchema } from '../schema'
import { type ValidationResult, validateArguments } from '../validation'

const schema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 10 },
    count: { type: 'integer', minimum: 1, maximum: 5 },
    mode: { type: 'string', enum: ['a', 'b'] },
    flag: { type: 'boolean', default: false },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    nested: { type: 'object', properties: { deep: { type: 'number' } }, required: ['deep'] }
  },
  required: ['title']
}

/**
 * `ok` is compared explicitly rather than used as a bare condition.
 *
 * The repo's ESLint enables `strict-boolean-expressions`, and an explicit
 * comparison also documents intent: these assertions care about *which* branch
 * they took, not merely whether validation passed.
 */
const issuesOf = (result: ValidationResult): string[] => (result.ok ? [] : result.issues)

const valueOf = (result: ValidationResult): Record<string, unknown> => (result.ok ? result.value : {})

const isOk = (result: ValidationResult): boolean => result.ok

describe('validateArguments', () => {
  it('accepts a minimal valid payload', () => {
    expect(isOk(validateArguments(schema, { title: 'ok' }))).toBe(true)
  })

  it('reports every problem at once so the model can fix them in one round trip', () => {
    const issues = issuesOf(validateArguments(schema, { count: 99, mode: 'z' }))
    expect(issues).toHaveLength(3)
    expect(issues.join(' ')).toContain('title is required')
    expect(issues.join(' ')).toContain('count')
    expect(issues.join(' ')).toContain('mode')
  })

  it('rejects unknown properties when additionalProperties is false', () => {
    const issues = issuesOf(validateArguments(schema, { title: 'ok', sneaky: 1 }))
    expect(issues[0]).toContain('sneaky is not an accepted property')
  })

  it('applies declared defaults', () => {
    expect(valueOf(validateArguments(schema, { title: 'ok' })).flag).toBe(false)
  })

  it('treats undefined as absent rather than invalid', () => {
    expect(isOk(validateArguments(schema, { title: 'ok', count: undefined }))).toBe(true)
  })

  it('treats a whole-number float as an integer', () => {
    expect(isOk(validateArguments(schema, { title: 'ok', count: 3.0 }))).toBe(true)
  })

  it('rejects a fractional value for an integer field', () => {
    expect(isOk(validateArguments(schema, { title: 'ok', count: 3.5 }))).toBe(false)
  })

  it('enforces string length bounds', () => {
    expect(isOk(validateArguments(schema, { title: '' }))).toBe(false)
    expect(isOk(validateArguments(schema, { title: 'far too long' }))).toBe(false)
  })

  it('validates array items and their length', () => {
    expect(isOk(validateArguments(schema, { title: 'ok', tags: ['a'] }))).toBe(true)
    expect(isOk(validateArguments(schema, { title: 'ok', tags: ['a', 'b', 'c'] }))).toBe(false)
    expect(isOk(validateArguments(schema, { title: 'ok', tags: ['a', 5] }))).toBe(false)
  })

  it('validates nested objects and their required fields', () => {
    expect(isOk(validateArguments(schema, { title: 'ok', nested: { deep: 1 } }))).toBe(true)
    const issues = issuesOf(validateArguments(schema, { title: 'ok', nested: {} }))
    expect(issues.join(' ')).toContain('nested.deep is required')
  })

  it('treats a null or absent body as an empty object', () => {
    // `title` is required, so an empty object still fails — but only for that
    // reason, not because the body itself was rejected.
    expect(issuesOf(validateArguments(schema, null))).toEqual(['title is required'])
    expect(isOk(validateArguments(objectSchema({}), null))).toBe(true)
    expect(isOk(validateArguments(objectSchema({}), undefined))).toBe(true)
  })

  it('rejects a body that is not an object', () => {
    expect(isOk(validateArguments(schema, []))).toBe(false)
    expect(isOk(validateArguments(schema, 'nope'))).toBe(false)
    expect(isOk(validateArguments(schema, 7))).toBe(false)
  })

  it('checks numeric bounds', () => {
    expect(isOk(validateArguments(schema, { title: 'ok', count: 1 }))).toBe(true)
    expect(isOk(validateArguments(schema, { title: 'ok', count: 5 }))).toBe(true)
    expect(isOk(validateArguments(schema, { title: 'ok', count: 0 }))).toBe(false)
    expect(isOk(validateArguments(schema, { title: 'ok', count: 6 }))).toBe(false)
  })

  describe('nullable types', () => {
    const nullable = objectSchema({ due: nullableStringProp('Due date, or null to clear.') })

    it('accepts null and a string for a nullable field', () => {
      expect(isOk(validateArguments(nullable, { due: null }))).toBe(true)
      expect(isOk(validateArguments(nullable, { due: '2026-12-31' }))).toBe(true)
    })

    it('still rejects any other type and names both allowed types', () => {
      const issues = issuesOf(validateArguments(nullable, { due: 5 }))
      expect(issues).toEqual(['due must be of type string or null (received integer)'])
    })

    it('keeps null invalid for a plain string field', () => {
      const plain = objectSchema({ name: { type: 'string' } })
      expect(isOk(validateArguments(plain, { name: null }))).toBe(false)
    })
  })
})
