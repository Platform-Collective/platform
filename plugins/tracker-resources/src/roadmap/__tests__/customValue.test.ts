//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType } from '@hcengineering/tracker'
import { formatCustomValue } from '../customValue'

const options = [
  { value: 'a', label: 'Small' },
  { value: 'b', label: 'Large' }
]

describe('formatCustomValue', () => {
  it('formats text and numbers', () => {
    expect(formatCustomValue({ key: 't', type: ProjectFieldType.Text }, { t: 'hello' }, [])).toBe('hello')
    expect(formatCustomValue({ key: 't', type: ProjectFieldType.Text }, { t: '' }, [])).toBeUndefined()
    expect(formatCustomValue({ key: 'n', type: ProjectFieldType.Number }, { n: 5 }, [])).toBe('5')
    expect(formatCustomValue({ key: 'n', type: ProjectFieldType.Number }, { n: 0 }, [])).toBe('0')
  })

  it('formats a date in the given locale', () => {
    const ts = new Date(2026, 9, 3).getTime()
    expect(formatCustomValue({ key: 'd', type: ProjectFieldType.Date }, { d: ts }, [], 'en')).toBe('Oct 3, 2026')
  })

  it('resolves option and iteration labels', () => {
    expect(formatCustomValue({ key: 's', type: ProjectFieldType.SingleSelect, options }, { s: 'b' }, [])).toBe('Large')
    expect(formatCustomValue({ key: 's', type: ProjectFieldType.SingleSelect, options }, { s: 'x' }, [])).toBeUndefined()
    expect(formatCustomValue({ key: 'm', type: ProjectFieldType.MultiSelect, options }, { m: ['a', 'b'] }, [])).toBe(
      'Small, Large'
    )
    expect(
      formatCustomValue({ key: 'i', type: ProjectFieldType.Iteration }, { i: 'it1' }, [{ _id: 'it1', label: 'Sprint 1' }])
    ).toBe('Sprint 1')
    expect(formatCustomValue({ key: 'i', type: ProjectFieldType.Iteration }, { i: 'gone' }, [])).toBeUndefined()
  })

  it('has no text without a value', () => {
    expect(formatCustomValue({ key: 'n', type: ProjectFieldType.Number }, undefined, [])).toBeUndefined()
    expect(formatCustomValue({ key: 'n', type: ProjectFieldType.Number }, {}, [])).toBeUndefined()
  })
})
