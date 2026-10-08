//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import * as path from 'path'
import { withFieldSums } from '../../fieldSum/config'
import { withSliceConfig } from '../../slice/config'
import { withHierarchy } from '../config'

// The saved views logic is a pure module of view-resources. The path is built at run time so that the type
// checkers do not pull view-resources sources into this package.
const { isViewDirty } = require(path.resolve(__dirname, '../../../../view-resources/src/savedViews')) as {
  isViewDirty: (baseline: Record<string, unknown>, current: Record<string, unknown>) => boolean
}

type Options = Record<string, any>

// Hierarchy, slice and field sums are stored in the view options, so the saved view saves them and the unsaved
// changes dot follows them without any change in the saved views code.
describe('unsaved changes of the Phase 8 settings', () => {
  const legacy: Options = { groupBy: ['status'], orderBy: ['modifiedOn', -1], shouldShowSubIssues: true }

  it('a view saved before the settings existed is clean and has the hierarchy off', () => {
    expect(isViewDirty({ viewOptions: legacy }, { viewOptions: { ...legacy } })).toBe(false)
  })

  it('turning the hierarchy on makes the view dirty, turning it off again makes it clean', () => {
    const on = withHierarchy(legacy, true)
    expect(isViewDirty({ viewOptions: legacy }, { viewOptions: on })).toBe(true)
    expect(isViewDirty({ viewOptions: legacy }, { viewOptions: withHierarchy(on, false) })).toBe(false)
  })

  it('a new table view starts with the hierarchy and is clean until changed', () => {
    const fresh = withHierarchy(legacy, true)
    expect(isViewDirty({ viewOptions: fresh }, { viewOptions: { ...fresh } })).toBe(false)
    expect(isViewDirty({ viewOptions: fresh }, { viewOptions: withHierarchy(fresh, false) })).toBe(true)
  })

  it('opening the slice panel, choosing a value and closing it', () => {
    const open = withSliceConfig(legacy, { field: 'status', value: [] })
    expect(isViewDirty({ viewOptions: legacy }, { viewOptions: open })).toBe(true)
    const chosen = withSliceConfig(open, { field: 'status', value: ['todo'] })
    expect(isViewDirty({ viewOptions: open }, { viewOptions: chosen })).toBe(true)
    expect(isViewDirty({ viewOptions: legacy }, { viewOptions: withSliceConfig(chosen, undefined) })).toBe(false)
  })

  it('choosing and clearing the fields to sum', () => {
    const one = withFieldSums(legacy, ['estimation'])
    expect(isViewDirty({ viewOptions: legacy }, { viewOptions: one })).toBe(true)
    expect(isViewDirty({ viewOptions: one }, { viewOptions: withFieldSums(one, ['estimation', 'customFields.points']) })).toBe(true)
    expect(isViewDirty({ viewOptions: legacy }, { viewOptions: withFieldSums(one, []) })).toBe(false)
  })

  it('the settings are independent of one another', () => {
    const all = withFieldSums(withSliceConfig(withHierarchy(legacy, true), { field: 'status', value: [] }), ['estimation'])
    const noSlice = withSliceConfig(all, undefined)
    expect(isViewDirty({ viewOptions: all }, { viewOptions: noSlice })).toBe(true)
    expect(noSlice.hierarchy).toBe(true)
    expect(noSlice.fieldSums).toEqual(['estimation'])
  })
})
