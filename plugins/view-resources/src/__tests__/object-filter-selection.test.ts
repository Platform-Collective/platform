// SPDX-License-Identifier: EPL-2.0

import type { Doc, Ref } from '@hcengineering/core'
import { isObjectFilterValueSelected, toggleObjectFilterValue } from '../components/filter/object-filter-selection'

const doc = { _id: 'doc-1' as Ref<Doc> } as unknown as Doc
const other = { _id: 'doc-2' as Ref<Doc> } as unknown as Doc

// A saved filter is stored as JSON, which turns undefined array items into null.
function saveAndReload (values: any[]): any[] {
  return JSON.parse(JSON.stringify(values))
}

describe('object filter selection', () => {
  it('keeps "Not selected" ticked after the filter is saved and reloaded, then unticks it', () => {
    const ticked = toggleObjectFilterValue(undefined, [], false)
    expect(ticked).toEqual([undefined])
    expect(isObjectFilterValueSelected(undefined, ticked)).toBe(true)

    const reloaded = saveAndReload(ticked)
    expect(reloaded).toEqual([null])
    expect(isObjectFilterValueSelected(undefined, reloaded)).toBe(true)
    expect(isObjectFilterValueSelected(null, reloaded)).toBe(true)

    const unticked = toggleObjectFilterValue(undefined, reloaded, isObjectFilterValueSelected(undefined, reloaded))
    expect(unticked).toEqual([])
    expect(isObjectFilterValueSelected(undefined, unticked)).toBe(false)
  })

  it('leaves other values alone when "Not selected" is unticked after a reload', () => {
    const reloaded = saveAndReload([doc._id, undefined])
    expect(isObjectFilterValueSelected(doc, reloaded)).toBe(true)

    const unticked = toggleObjectFilterValue(null, reloaded, isObjectFilterValueSelected(null, reloaded))
    expect(unticked).toEqual([doc._id])
    expect(isObjectFilterValueSelected(doc, unticked)).toBe(true)
  })

  it('ticks and unticks ordinary values without touching "Not selected"', () => {
    const values = toggleObjectFilterValue(doc, [undefined], false)
    expect(values).toEqual([undefined, doc._id])
    expect(isObjectFilterValueSelected(doc, values)).toBe(true)
    expect(isObjectFilterValueSelected(other, values)).toBe(false)

    expect(toggleObjectFilterValue(doc, values, true)).toEqual([undefined])
  })
})
