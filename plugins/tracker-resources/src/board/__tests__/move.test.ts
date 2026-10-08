//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  attributeTarget,
  customTarget,
  isAvailableCategory,
  isNoopUpdate,
  resolveDropUpdate,
  type DropTarget
} from '../move'

const attr = (key: string, value: unknown): DropTarget => ({ kind: 'attribute', key, value })
const custom = (fieldKey: string, value: string | undefined): DropTarget => ({ kind: 'custom', fieldKey, value })

describe('resolveDropUpdate', () => {
  it('writes the attribute of a column', () => {
    expect(resolveDropUpdate({}, [attr('status', 's2')])).toEqual({ status: 's2' })
  })

  it('writes the value of a custom field column', () => {
    expect(resolveDropUpdate({ customFields: { stage: 'todo', other: 7 } }, [custom('stage', 'done')])).toEqual({
      customFields: { stage: 'done', other: 7 }
    })
  })

  it('clears a custom field when dropped on No value', () => {
    expect(resolveDropUpdate({ customFields: { stage: 'todo', other: 7 } }, [custom('stage', undefined)])).toEqual({
      customFields: { other: 7 }
    })
  })

  it('works for an issue without any custom field', () => {
    expect(resolveDropUpdate({}, [custom('stage', 'todo')])).toEqual({ customFields: { stage: 'todo' } })
    expect(resolveDropUpdate({}, [custom('stage', undefined)])).toEqual({})
  })

  it('writes the column and the swimlane together', () => {
    expect(resolveDropUpdate({}, [attr('status', 's2'), attr('assignee', 'p1')])).toEqual({
      status: 's2',
      assignee: 'p1'
    })
    expect(resolveDropUpdate({ customFields: { x: 1 } }, [attr('status', 's2'), custom('stage', 'doing')])).toEqual({
      status: 's2',
      customFields: { x: 1, stage: 'doing' }
    })
  })

  it('merges two custom fields into one record', () => {
    expect(
      resolveDropUpdate({ customFields: { stage: 'todo', sprint: 'i1', keep: 'k' } }, [
        custom('sprint', 'i2'),
        custom('stage', undefined)
      ])
    ).toEqual({ customFields: { sprint: 'i2', keep: 'k' } })
  })

  it('writes an iteration id like any custom value', () => {
    expect(resolveDropUpdate({ customFields: { sprint: 'i1' } }, [custom('sprint', 'i3')])).toEqual({
      customFields: { sprint: 'i3' }
    })
  })

  it('skips the missing swimlane target', () => {
    expect(resolveDropUpdate({}, [attr('status', 's2'), undefined])).toEqual({ status: 's2' })
    expect(resolveDropUpdate({}, [undefined, undefined])).toEqual({})
  })

  it('writes nothing for a custom field that already has the value', () => {
    expect(resolveDropUpdate({ customFields: { stage: 'todo' } }, [custom('stage', 'todo')])).toEqual({})
  })

  it('refuses contradicting targets', () => {
    expect(resolveDropUpdate({}, [attr('status', 's1'), attr('status', 's2')])).toBeUndefined()
    expect(resolveDropUpdate({}, [custom('stage', 'a'), custom('stage', 'b')])).toBeUndefined()
    expect(resolveDropUpdate({}, [custom('stage', 'a'), custom('stage', 'a')])).toEqual({ customFields: { stage: 'a' } })
  })

  it('does not change the document it was given', () => {
    const doc = { customFields: { stage: 'todo' } }
    resolveDropUpdate(doc, [custom('stage', 'done')])
    expect(doc).toEqual({ customFields: { stage: 'todo' } })
  })
})

describe('isNoopUpdate', () => {
  it('is true when every value is already there', () => {
    expect(isNoopUpdate({ status: 's1', customFields: { a: 1 } }, { status: 's1', customFields: { a: 1 } })).toBe(true)
    expect(isNoopUpdate({ status: 's1' }, {})).toBe(true)
  })

  it('is false when a value differs', () => {
    expect(isNoopUpdate({ status: 's1' }, { status: 's2' })).toBe(false)
    expect(isNoopUpdate({ customFields: { a: 1 } }, { customFields: { a: 2 } })).toBe(false)
  })
})

describe('isAvailableCategory', () => {
  it('allows everything when nothing is restricted', () => {
    expect(isAvailableCategory(undefined, 'a')).toBe(true)
    expect(isAvailableCategory(undefined, undefined)).toBe(true)
  })

  it('allows the listed categories only', () => {
    expect(isAvailableCategory(['a', 'b'], 'a')).toBe(true)
    expect(isAvailableCategory(['a', 'b'], 'c')).toBe(false)
    expect(isAvailableCategory([], 'a')).toBe(false)
    expect(isAvailableCategory([undefined], undefined)).toBe(true)
  })

  it('allows a category with several values when one of them is listed', () => {
    const status = { name: 'Todo', values: [{ _id: 's1', space: 'p1' }, { _id: 's2', space: 'p2' }] }
    expect(isAvailableCategory(['s2'], status)).toBe(true)
    expect(isAvailableCategory(['s3'], status)).toBe(false)
    expect(isAvailableCategory([status], status)).toBe(true)
    expect(isAvailableCategory(['s1'], { name: 'x' })).toBe(false)
  })
})

describe('attributeTarget', () => {
  it('writes a plain value', () => {
    expect(attributeTarget('priority', 2, 'p')).toEqual({ kind: 'attribute', key: 'priority', value: 2 })
    expect(attributeTarget('priority', 0, 'p')).toEqual({ kind: 'attribute', key: 'priority', value: 0 })
    expect(attributeTarget('assignee', 'a1', 'p')).toEqual({ kind: 'attribute', key: 'assignee', value: 'a1' })
  })

  it('picks the value of the project of the card from a category with several values', () => {
    const status = { name: 'Todo', values: [{ _id: 's1', space: 'p1' }, { _id: 's2', space: 'p2' }] }
    expect(attributeTarget('status', status, 'p2')).toEqual({ kind: 'attribute', key: 'status', value: 's2' })
    expect(attributeTarget('status', status, 'p3')).toBeUndefined()
  })

  it('clears an attribute that can be empty when dropped on No value', () => {
    expect(attributeTarget('assignee', undefined, 'p')).toEqual({ kind: 'attribute', key: 'assignee', value: null })
    expect(attributeTarget('milestone', undefined, 'p')).toEqual({ kind: 'attribute', key: 'milestone', value: null })
    expect(attributeTarget('component', null, 'p')).toEqual({ kind: 'attribute', key: 'component', value: null })
  })

  it('refuses No value for an attribute that cannot be empty', () => {
    expect(attributeTarget('status', undefined, 'p')).toBeUndefined()
    expect(attributeTarget('priority', undefined, 'p')).toBeUndefined()
  })
})

describe('customTarget', () => {
  it('writes an id, or clears the field', () => {
    expect(customTarget('stage', 'todo')).toEqual({ kind: 'custom', fieldKey: 'stage', value: 'todo' })
    expect(customTarget('stage', undefined)).toEqual({ kind: 'custom', fieldKey: 'stage', value: undefined })
    expect(customTarget('stage', '')).toEqual({ kind: 'custom', fieldKey: 'stage', value: undefined })
  })
})
