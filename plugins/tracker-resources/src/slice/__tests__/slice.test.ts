//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType, type Iteration, type ProjectField } from '@hcengineering/tracker'
import { buildSummableFields } from '../../fieldSum/config'
import { buildIssueFilterSchema } from '../../issueFilter'
import {
  normalizeSliceConfig,
  readSliceConfig,
  sanitizeSliceValues,
  selectAllValues,
  SLICE_NONE,
  SLICE_OPTION_KEY,
  toggleSliceValue,
  withSliceConfig,
  withSliceField,
  type SliceConfig
} from '../config'
import {
  buildSliceFields,
  defaultSliceField,
  listsEmptyValues,
  resolveSliceField,
  sliceFieldId,
  sliceProjection
} from '../fields'
import { collectSliceSums, SLICE_ALL } from '../sums'
import { collectSliceValues, createSlicePredicate } from '../values'

function field (key: string, label: string, type: ProjectFieldType, options?: Array<[string, string]>): ProjectField {
  return {
    _id: key,
    key,
    label,
    type,
    position: 0,
    options: options?.map(([value, l]) => ({ value, label: l }))
  } as unknown as ProjectField
}

const customFields = [
  field('size', 'Size', ProjectFieldType.SingleSelect, [
    ['s', 'Small'],
    ['m', 'Medium'],
    ['l', 'Large']
  ]),
  field('areas', 'Areas', ProjectFieldType.MultiSelect, [
    ['ui', 'UI'],
    ['api', 'API']
  ]),
  field('points', 'Points', ProjectFieldType.Number),
  field('notes', 'Notes', ProjectFieldType.Text),
  field('sprint', 'Sprint', ProjectFieldType.Iteration)
]

const iterations = [
  { _id: 'it1', label: 'Iteration 1', field: 'sprint', isBreak: false, startDate: 0, duration: 7 },
  { _id: 'it2', label: 'Iteration 2', field: 'sprint', isBreak: false, startDate: 0, duration: 7 }
] as unknown as Iteration[]

const schema = buildIssueFilterSchema({
  statuses: [
    { id: 'todo', name: 'Todo' },
    { id: 'doing', name: 'Doing' },
    { id: 'done', name: 'Done' }
  ],
  priorities: [
    { id: 0, name: 'No priority' },
    { id: 1, name: 'Urgent' },
    { id: 2, name: 'High' }
  ],
  assignees: [
    { id: 'u1', name: 'Alice' },
    { id: 'u2', name: 'Bob' }
  ],
  components: [{ id: 'c1', name: 'Core' }],
  milestones: [{ id: 'm1', name: 'Beta' }],
  labels: [
    { id: 'l1', name: 'bug' },
    { id: 'l2', name: 'ui' }
  ],
  labelRefs: [
    { issue: 'i1', label: 'l1' },
    { issue: 'i1', label: 'l2' },
    { issue: 'i2', label: 'l1' }
  ],
  customFields,
  iterations,
  noParentId: 'none'
})

const specOf = (id: string): any => {
  const found = buildSliceFields(schema).find((f) => sliceFieldId(f) === id)
  if (found === undefined) throw new Error(`no slice field ${id}`)
  return found
}

const issues = [
  { _id: 'i1', status: 'todo', priority: 1, assignee: 'u1', component: 'c1', customFields: { size: 's', areas: ['ui', 'api'], sprint: 'it1', points: 3 } },
  { _id: 'i2', status: 'todo', priority: 2, assignee: 'u1', component: null, customFields: { size: 's', areas: ['ui'], sprint: 'it2' } },
  { _id: 'i3', status: 'doing', priority: 0, assignee: null, customFields: { size: 'l', sprint: 'gone' } },
  { _id: 'i4', status: 'done', priority: 1, assignee: 'u2' }
]

describe('slice fields', () => {
  it('offers the built-in fields and the select, multi select and iteration fields', () => {
    expect(buildSliceFields(schema).map(sliceFieldId)).toEqual([
      'status',
      'priority',
      'assignee',
      'label',
      'component',
      'milestone',
      'customFields.size',
      'customFields.areas',
      'customFields.sprint'
    ])
  })

  it('does not offer title, dates, numbers, text or the parent', () => {
    const ids = buildSliceFields(schema).map(sliceFieldId)
    for (const bad of ['title', 'due', 'start', 'estimate', 'parent-issue', 'sub-issues', 'customFields.points', 'customFields.notes']) {
      expect(ids).not.toContain(bad)
    }
  })

  it('finds the field of the settings by its id, and survives a rename of a custom field', () => {
    const fields = buildSliceFields(schema)
    expect(resolveSliceField({ field: 'customFields.size', value: [] }, fields)?.key).toBe('size')
    expect(resolveSliceField({ field: 'customFields.gone', value: [] }, fields)).toBeUndefined()
    expect(resolveSliceField(undefined, fields)).toBeUndefined()
    expect(defaultSliceField(fields)?.name).toBe('status')
    expect(defaultSliceField([])).toBeUndefined()
  })

  it('knows what a field needs to be loaded', () => {
    expect(sliceProjection(specOf('status'))).toEqual(['_id', 'status'])
    expect(sliceProjection(specOf('customFields.size'))).toEqual(['_id', 'customFields'])
    expect(listsEmptyValues(specOf('customFields.size'))).toBe(true)
    expect(listsEmptyValues(specOf('status'))).toBe(false)
  })
})

describe('slice config', () => {
  it('reads whatever is stored defensively', () => {
    expect(normalizeSliceConfig(undefined)).toBeUndefined()
    expect(normalizeSliceConfig('status')).toBeUndefined()
    expect(normalizeSliceConfig({ field: '' })).toBeUndefined()
    expect(normalizeSliceConfig({ field: 'status' })).toEqual({ field: 'status', value: [] })
    expect(normalizeSliceConfig({ field: 'status', value: ['a', 'a', '', 5, 'b'] })).toEqual({
      field: 'status',
      value: ['a', 'b']
    })
    // A single value, as the key `value` suggests
    expect(normalizeSliceConfig({ field: 'status', value: 'todo' })).toEqual({ field: 'status', value: ['todo'] })
    expect(readSliceConfig({ [SLICE_OPTION_KEY]: { field: 'priority', value: [] } })).toEqual({ field: 'priority', value: [] })
    expect(readSliceConfig(undefined)).toBeUndefined()
  })

  it('stores nothing when the panel is closed', () => {
    const opts = { groupBy: ['status'], [SLICE_OPTION_KEY]: { field: 'status', value: ['todo'] } }
    expect(SLICE_OPTION_KEY in withSliceConfig(opts, undefined)).toBe(false)
    expect(withSliceConfig({ groupBy: ['status'] }, undefined)).toEqual({ groupBy: ['status'] })
    expect(withSliceConfig<Record<string, any>>({}, { field: 'status', value: ['x'] })[SLICE_OPTION_KEY]).toEqual({ field: 'status', value: ['x'] })
    expect(opts[SLICE_OPTION_KEY].value).toEqual(['todo'])
  })

  it('drops the chosen values when the field changes', () => {
    const config: SliceConfig = { field: 'status', value: ['todo'] }
    expect(withSliceField(config, 'status')).toBe(config)
    expect(withSliceField(config, 'priority')).toEqual({ field: 'priority', value: [] })
    expect(withSliceField(undefined, 'status')).toEqual({ field: 'status', value: [] })
    expect(selectAllValues(config)).toEqual({ field: 'status', value: [] })
  })

  it('chooses one value on a click and goes back to All on a second click', () => {
    let config: SliceConfig = { field: 'status', value: [] }
    config = toggleSliceValue(config, 'todo', false)
    expect(config.value).toEqual(['todo'])
    config = toggleSliceValue(config, 'doing', false)
    expect(config.value).toEqual(['doing'])
    config = toggleSliceValue(config, 'doing', false)
    expect(config.value).toEqual([])
  })

  it('adds and removes values with Cmd/Ctrl', () => {
    let config: SliceConfig = { field: 'status', value: ['todo'] }
    config = toggleSliceValue(config, 'doing', true)
    expect(config.value).toEqual(['todo', 'doing'])
    config = toggleSliceValue(config, SLICE_NONE, true)
    expect(config.value).toEqual(['todo', 'doing', SLICE_NONE])
    config = toggleSliceValue(config, 'todo', true)
    expect(config.value).toEqual(['doing', SLICE_NONE])
    // a plain click on one of several chosen values chooses it alone
    expect(toggleSliceValue(config, 'doing', false).value).toEqual(['doing'])
  })

  it('drops chosen values that were deleted', () => {
    expect(sanitizeSliceValues(['a', 'gone', SLICE_NONE], new Set(['a', 'b']))).toEqual(['a', SLICE_NONE])
    expect(sanitizeSliceValues([], new Set())).toEqual([])
  })
})

describe('slice values', () => {
  it('counts the items of every status, and hides the ones nobody has', () => {
    const res = collectSliceValues(specOf('status'), issues)
    expect(res.total).toBe(4)
    expect(res.none).toBe(0)
    expect(res.values.map((v) => [v.id, v.label, v.count])).toEqual([
      ['todo', 'Todo', 2],
      ['doing', 'Doing', 1],
      ['done', 'Done', 1]
    ])
    expect(collectSliceValues(specOf('status'), issues.slice(0, 2)).values.map((v) => v.id)).toEqual(['todo'])
  })

  it('keeps a chosen value in the list even when nobody has it, so that the choice can be undone', () => {
    const res = collectSliceValues(specOf('status'), issues.slice(0, 2), { keep: ['done'] })
    expect(res.values.map((v) => [v.id, v.count])).toEqual([
      ['todo', 2],
      ['done', 0]
    ])
  })

  it('lists values nobody has when asked, and puts the listed order first', () => {
    const res = collectSliceValues(specOf('status'), issues.slice(0, 2), { includeEmpty: true, order: ['done', 'doing', 'todo'] })
    expect(res.values.map((v) => [v.id, v.count])).toEqual([
      ['done', 0],
      ['doing', 0],
      ['todo', 2]
    ])
  })

  it('counts priorities by their number, and items without a priority as none', () => {
    const res = collectSliceValues(specOf('priority'), issues)
    expect(res.values.map((v) => [v.label, v.count])).toEqual([
      ['No priority', 1],
      ['Urgent', 2],
      ['High', 1]
    ])
  })

  it('counts items without a value as none', () => {
    const res = collectSliceValues(specOf('assignee'), issues)
    expect(res.none).toBe(1)
    expect(res.values.map((v) => [v.label, v.count])).toEqual([
      ['Alice', 2],
      ['Bob', 1]
    ])
    expect(collectSliceValues(specOf('component'), issues).none).toBe(3)
  })

  it('counts an item once for each of its labels', () => {
    const res = collectSliceValues(specOf('label'), issues)
    expect(res.values.map((v) => [v.label, v.count])).toEqual([
      ['bug', 2],
      ['ui', 1]
    ])
    expect(res.none).toBe(2)
  })

  it('counts multi select values once per item', () => {
    const res = collectSliceValues(specOf('customFields.areas'), issues, { includeEmpty: true })
    expect(res.values.map((v) => [v.label, v.count])).toEqual([
      ['UI', 2],
      ['API', 1]
    ])
    expect(res.none).toBe(2)
  })

  it('lists every option of a custom select with its count, in the order of the field', () => {
    const res = collectSliceValues(specOf('customFields.size'), issues, { includeEmpty: true })
    expect(res.values.map((v) => [v.label, v.count])).toEqual([
      ['Small', 2],
      ['Medium', 0],
      ['Large', 1]
    ])
    expect(res.none).toBe(1)
  })

  it('counts a deleted iteration as none', () => {
    const res = collectSliceValues(specOf('customFields.sprint'), issues, { includeEmpty: true })
    expect(res.values.map((v) => [v.label, v.count])).toEqual([
      ['Iteration 1', 1],
      ['Iteration 2', 1]
    ])
    // i3 refers to a deleted iteration, i4 has no custom fields
    expect(res.none).toBe(2)
  })

  it('sorts by label when asked', () => {
    const res = collectSliceValues(specOf('assignee'), issues, { sortByLabel: true })
    expect(res.values.map((v) => v.label)).toEqual(['Alice', 'Bob'])
    const reversed = { ...specOf('assignee'), options: [...specOf('assignee').options].reverse() }
    expect(collectSliceValues(reversed, issues, { sortByLabel: true }).values.map((v) => v.label)).toEqual(['Alice', 'Bob'])
    expect(collectSliceValues(reversed, issues).values.map((v) => v.label)).toEqual(['Bob', 'Alice'])
  })

  it('has no values for no items', () => {
    expect(collectSliceValues(specOf('status'), [])).toEqual({ values: [], none: 0, total: 0 })
  })

  it('handles a large list', () => {
    const many = Array.from({ length: 50000 }, (_, i) => ({ _id: `x${i}`, status: i % 3 === 0 ? 'todo' : 'done' }))
    const res = collectSliceValues(specOf('status'), many)
    expect(res.values.find((v) => v.id === 'todo')?.count).toBe(16667)
    expect(res.values.find((v) => v.id === 'done')?.count).toBe(33333)
  })
})

describe('slice predicate', () => {
  const ids = (spec: any, config: SliceConfig | undefined): string[] =>
    issues.filter(createSlicePredicate(spec, config)).map((i) => i._id)

  it('lets every item through for All or no slice', () => {
    expect(ids(specOf('status'), undefined)).toEqual(['i1', 'i2', 'i3', 'i4'])
    expect(ids(specOf('status'), { field: 'status', value: [] })).toEqual(['i1', 'i2', 'i3', 'i4'])
  })

  it('keeps the items with the chosen value', () => {
    expect(ids(specOf('status'), { field: 'status', value: ['todo'] })).toEqual(['i1', 'i2'])
    expect(ids(specOf('priority'), { field: 'priority', value: ['1'] })).toEqual(['i1', 'i4'])
  })

  it('keeps the items with any of several chosen values', () => {
    expect(ids(specOf('status'), { field: 'status', value: ['doing', 'done'] })).toEqual(['i3', 'i4'])
  })

  it('keeps the items without a value for the none entry, alone or with others', () => {
    expect(ids(specOf('assignee'), { field: 'assignee', value: [SLICE_NONE] })).toEqual(['i3'])
    expect(ids(specOf('assignee'), { field: 'assignee', value: [SLICE_NONE, 'u2'] })).toEqual(['i3', 'i4'])
  })

  it('matches an item with several values when one of them is chosen', () => {
    expect(ids(specOf('label'), { field: 'label', value: ['l2'] })).toEqual(['i1'])
    expect(ids(specOf('label'), { field: 'label', value: ['l1'] })).toEqual(['i1', 'i2'])
    expect(ids(specOf('customFields.areas'), { field: 'customFields.areas', value: ['api'] })).toEqual(['i1'])
  })

  it('keeps items on a custom field, and treats a deleted option as none', () => {
    expect(ids(specOf('customFields.size'), { field: 'customFields.size', value: ['s'] })).toEqual(['i1', 'i2'])
    expect(ids(specOf('customFields.sprint'), { field: 'customFields.sprint', value: [SLICE_NONE] })).toEqual(['i3', 'i4'])
  })

  it('shows nothing for a value that nobody has', () => {
    expect(ids(specOf('customFields.size'), { field: 'customFields.size', value: ['m'] })).toEqual([])
  })

  it('composes with a filter by intersection', () => {
    // The slice is one more condition on top of the filter: an item must pass both
    const inFilter = (i: any): boolean => i.priority === 1
    const slice = createSlicePredicate(specOf('status'), { field: 'status', value: ['todo', 'done'] })
    expect(issues.filter((i) => inFilter(i) && slice(i)).map((i) => i._id)).toEqual(['i1', 'i4'])
  })
})

describe('slice sums', () => {
  const summable = buildSummableFields(customFields, 'Estimation')
  const withEstimates = [
    { _id: 'i1', status: 'todo', estimation: 2, customFields: { size: 's', areas: ['ui', 'api'], points: 3 } },
    { _id: 'i2', status: 'todo', estimation: 3, customFields: { size: 's', areas: ['ui'], points: 'x' } },
    { _id: 'i3', status: 'doing', estimation: 5, customFields: { size: 'l' } },
    { _id: 'i4', status: 'done' }
  ]

  it('gives nothing without fields', () => {
    expect(collectSliceSums(specOf('status'), withEstimates, []).size).toBe(0)
  })

  it('sums the chosen field for every value, for none and for all', () => {
    const res = collectSliceSums(specOf('status'), withEstimates, [summable[0]])
    expect(res.get('todo')).toBe('5')
    expect(res.get('doing')).toBe('5')
    expect(res.get('done')).toBe('0')
    expect(res.get(SLICE_ALL)).toBe('10')
    expect(res.has(SLICE_NONE)).toBe(false)
  })

  it('puts the items without a value under none, and adds up several fields', () => {
    const res = collectSliceSums(specOf('customFields.size'), withEstimates, [summable[0], summable[1]])
    expect(res.get('s')).toBe('5 · 3')
    expect(res.get('l')).toBe('5 · 0')
    expect(res.get(SLICE_NONE)).toBe('0 · 0')
  })

  it('counts an item with several values for each of them, like the counts do', () => {
    const res = collectSliceSums(specOf('customFields.areas'), withEstimates, [summable[0]])
    expect(res.get('ui')).toBe('5')
    expect(res.get('api')).toBe('2')
    expect(res.get(SLICE_ALL)).toBe('10')
  })
})
