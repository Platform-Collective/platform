//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  MAX_PROJECT_FIELDS,
  MAX_PROJECT_FIELD_OPTIONS,
  ProjectFieldType,
  generateFieldKey,
  getFieldValue,
  normalizeFieldValue,
  overLimitFields,
  slugifyFieldLabel,
  validateProjectField
} from '../projectField'

const opts = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' }
]

describe('slugifyFieldLabel', () => {
  it('camel-cases words', () => expect(slugifyFieldLabel('Story points')).toBe('storyPoints'))
  it('strips punctuation', () => expect(slugifyFieldLabel('  Due -- date! ')).toBe('dueDate'))
  it('prefixes leading digits', () => expect(slugifyFieldLabel('2nd pass')).toBe('f2ndPass'))
  it('returns empty for symbols only', () => expect(slugifyFieldLabel('!!!')).toBe(''))
})

describe('generateFieldKey', () => {
  it('avoids collisions', () => expect(generateFieldKey('Size', ['size', 'size2'])).toBe('size3'))
  it('keeps free key', () => expect(generateFieldKey('Size', [])).toBe('size'))
})

describe('validateProjectField', () => {
  it('rejects empty label', () =>
    expect(validateProjectField({ label: ' ', type: ProjectFieldType.Text }, [])).toBe('emptyLabel'))
  it('rejects duplicate label case-insensitively', () =>
    expect(validateProjectField({ label: 'size', type: ProjectFieldType.Text }, [{ label: 'Size' }])).toBe(
      'duplicateLabel'
    ))
  it('enforces the field limit', () => {
    const existing = Array.from({ length: MAX_PROJECT_FIELDS }, (_, i) => ({ label: `f${i}` }))
    expect(validateProjectField({ label: 'x', type: ProjectFieldType.Text }, existing)).toBe('tooManyFields')
  })
  it('requires options for selects', () =>
    expect(validateProjectField({ label: 'x', type: ProjectFieldType.SingleSelect }, [])).toBe('optionsRequired'))
  it('enforces the option limit', () => {
    const options = Array.from({ length: MAX_PROJECT_FIELD_OPTIONS + 1 }, (_, i) => ({ value: `${i}`, label: `o${i}` }))
    expect(validateProjectField({ label: 'x', type: ProjectFieldType.MultiSelect, options }, [])).toBe(
      'tooManyOptions'
    )
  })
  it('rejects duplicate options', () =>
    expect(
      validateProjectField(
        { label: 'x', type: ProjectFieldType.SingleSelect, options: [...opts, { value: 'c', label: 'a' }] },
        []
      )
    ).toBe('duplicateOption'))
  it('forbids default on date', () =>
    expect(validateProjectField({ label: 'x', type: ProjectFieldType.Date, defaultValue: 1 }, [])).toBe(
      'defaultNotAllowed'
    ))
  it('checks default against options', () =>
    expect(
      validateProjectField(
        { label: 'x', type: ProjectFieldType.SingleSelect, options: opts, defaultValue: 'zzz' },
        []
      )
    ).toBe('invalidDefault'))
  it('accepts a valid number field', () =>
    expect(validateProjectField({ label: 'x', type: ProjectFieldType.Number, defaultValue: 3 }, [])).toBeUndefined())
})

describe('normalizeFieldValue', () => {
  it('drops removed select options', () =>
    expect(normalizeFieldValue({ type: ProjectFieldType.SingleSelect, options: opts }, 'gone')).toBeNull())
  it('filters multi-select to known options', () =>
    expect(normalizeFieldValue({ type: ProjectFieldType.MultiSelect, options: opts }, ['a', 'gone'])).toEqual(['a']))
  it('rejects NaN numbers', () => expect(normalizeFieldValue({ type: ProjectFieldType.Number }, NaN)).toBeNull())
  it('rejects wrong types', () => expect(normalizeFieldValue({ type: ProjectFieldType.Text }, 5)).toBeNull())
})

describe('getFieldValue', () => {
  it('reads by key and tolerates missing record', () => {
    const f = { key: 'size', type: ProjectFieldType.Number }
    expect(getFieldValue({ size: 5 }, f)).toBe(5)
    expect(getFieldValue(undefined, f)).toBeNull()
  })
})

describe('overLimitFields', () => {
  it('keeps the oldest MAX fields', () => {
    const fields = Array.from({ length: MAX_PROJECT_FIELDS + 2 }, (_, i) => ({ _id: i, position: i, createdOn: i }))
    expect(overLimitFields(fields).map((f) => f._id)).toEqual([MAX_PROJECT_FIELDS, MAX_PROJECT_FIELDS + 1])
  })
})
