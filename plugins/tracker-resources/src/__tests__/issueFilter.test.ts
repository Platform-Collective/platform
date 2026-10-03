//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType, type ProjectField } from '@hcengineering/tracker'
import { filterGrammar } from '@hcengineering/view-resources'
import { buildIssueFilterSchema, customFilterToQuery, fieldFilterName } from '../issueFilter'
import { buildFiltersPredicate, endOfDay, startOfDay, type CustomFieldFilter } from '../projectFields/query'
import { buildRegistry } from '../projectFields/registry'

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

const fields = [
  field('storyPoints', 'Story points', ProjectFieldType.Number),
  field('notes', 'Notes', ProjectFieldType.Text),
  field('target', 'Target date', ProjectFieldType.Date),
  field('size', 'Size', ProjectFieldType.SingleSelect, [
    ['s', 'Small'],
    ['l', 'Extra large']
  ]),
  field('area', 'Area', ProjectFieldType.MultiSelect, [
    ['fe', 'Frontend'],
    ['be', 'Backend']
  ]),
  field('status', 'Status', ProjectFieldType.Text)
]

const { compileFilter, evaluate, parseFilter } = filterGrammar

const schema = buildIssueFilterSchema({
  statuses: [{ id: 's1', name: 'Todo' }],
  priorities: [{ id: 1, name: 'Urgent' }],
  assignees: [{ id: 'p1', name: 'Alice' }],
  components: [],
  milestones: [],
  labels: [{ id: 'l1', name: 'bug' }],
  labelRefs: [{ issue: 'i1', label: 'l1' }],
  customFields: fields,
  noParentId: 'no-parent'
})

describe('fieldFilterName', () => {
  it('lowercases and hyphenates', () => {
    expect(fieldFilterName('Story Points', 'storyPoints')).toBe('story-points')
  })

  it('supports non-latin labels', () => {
    expect(fieldFilterName('Оценка работ', 'ocenkaRabot')).toBe('оценка-работ')
  })

  it('falls back to the key for labels that are not valid names', () => {
    expect(fieldFilterName('2 weeks', 'f2Weeks')).toBe('f2weeks')
    expect(fieldFilterName('???', 'fieldX')).toBe('fieldx')
  })
})

describe('buildIssueFilterSchema', () => {
  it('contains the built-in fields and the custom fields', () => {
    const names = schema.map((f) => f.name)
    expect(names).toEqual(expect.arrayContaining(['title', 'status', 'priority', 'assignee', 'label', 'parent-issue']))
    expect(names).toEqual(expect.arrayContaining(['story-points', 'notes', 'target-date', 'size', 'area']))
  })

  it('keeps built-in fields when a custom field has the same name', () => {
    expect(schema.filter((f) => f.name === 'status')).toHaveLength(1)
    expect(schema.find((f) => f.name === 'status')?.source).toBe('attribute')
  })

  it('maps custom field types and options', () => {
    const size = schema.find((f) => f.name === 'size')
    expect(size).toMatchObject({ type: 'select', source: 'custom', key: 'size' })
    expect(size?.options).toEqual([
      { id: 's', name: 'Small' },
      { id: 'l', name: 'Extra large' }
    ])
    expect(schema.find((f) => f.name === 'area')?.type).toBe('multi')
    expect(schema.find((f) => f.name === 'target-date')?.type).toBe('date')
  })

  it('resolves labels through the tag references', () => {
    const label = schema.find((f) => f.name === 'label')
    expect(label?.resolveDocIds?.(['l1'])).toEqual(['i1'])
    expect(label?.read?.({ _id: 'i1' })).toEqual(['l1'])
    expect(label?.read?.({ _id: 'other' })).toEqual([])
  })

  it('parses filter strings against the schema', () => {
    expect(parseFilter('story-points:>3 target-date:@today size:"extra large" label:bug', schema).ok).toBe(true)
  })
})

describe('customFilterToQuery', () => {
  const registry = buildRegistry(fields)
  const rule = (fieldKey: string, operator: any, value?: any): CustomFieldFilter => ({
    id: fieldKey + operator,
    fieldKey,
    operator,
    value
  })

  it('writes each operator in grammar syntax', () => {
    const q = (r: CustomFieldFilter): string => customFilterToQuery([r], registry.byKey)
    expect(q(rule('storyPoints', 'eq', 5))).toBe('story-points:5')
    expect(q(rule('storyPoints', 'gt', 5))).toBe('story-points:>5')
    expect(q(rule('storyPoints', 'lte', 5))).toBe('story-points:<=5')
    expect(q(rule('storyPoints', 'between', { from: 1, to: 3 }))).toBe('story-points:1..3')
    expect(q(rule('storyPoints', 'between', { from: 1 }))).toBe('story-points:1..*')
    expect(q(rule('notes', 'contains', ' hello world '))).toBe('notes:"hello world"')
    expect(q(rule('size', 'anyOf', ['s', 'l']))).toBe('size:Small,"Extra large"')
    expect(q(rule('notes', 'isEmpty'))).toBe('no:notes')
    expect(q(rule('notes', 'isNotEmpty'))).toBe('has:notes')
  })

  it('writes dates as calendar days', () => {
    const d = new Date(2026, 0, 5, 15).getTime()
    expect(customFilterToQuery([rule('target', 'before', d)], registry.byKey)).toBe('target-date:<2026-01-05')
    expect(customFilterToQuery([rule('target', 'after', d)], registry.byKey)).toBe('target-date:>2026-01-05')
    expect(customFilterToQuery([rule('target', 'between', { from: d, to: d })], registry.byKey)).toBe(
      'target-date:2026-01-05..2026-01-05'
    )
  })

  it('skips incomplete rules and unknown fields and joins with AND', () => {
    const q = customFilterToQuery(
      [rule('storyPoints', 'gt'), rule('gone', 'eq', 1), rule('storyPoints', 'eq', 2), rule('notes', 'isEmpty')],
      registry.byKey
    )
    expect(q).toBe('story-points:2 no:notes')
  })

  it('selects the same issues as the rules did', () => {
    const day = new Date(2026, 5, 10, 9).getTime()
    const issues: any[] = [
      { _id: 'a', customFields: { storyPoints: 3, notes: 'Hello World', target: day, size: 's', area: ['fe'] } },
      { _id: 'b', customFields: { storyPoints: 8, notes: 'x', target: endOfDay(day) + 1, size: 'l', area: [] } },
      { _id: 'c', customFields: { storyPoints: 5, target: startOfDay(day) - 1 } },
      { _id: 'd' }
    ]
    const ruleSets: CustomFieldFilter[][] = [
      [rule('storyPoints', 'gt', 3)],
      [rule('storyPoints', 'between', { from: 3, to: 5 })],
      [rule('notes', 'contains', 'hello')],
      [rule('size', 'anyOf', ['s', 'l'])],
      [rule('area', 'anyOf', ['fe'])],
      [rule('area', 'isEmpty')],
      [rule('target', 'before', day)],
      [rule('target', 'after', day)],
      [rule('target', 'between', { from: day, to: day })],
      [rule('storyPoints', 'gte', 5), rule('notes', 'isNotEmpty')]
    ]
    const ctx = { now: day }
    for (const rules of ruleSets) {
      const legacy = buildFiltersPredicate(registry.byKey, rules)
      const text = customFilterToQuery(rules, registry.byKey)
      const parsed = compileFilter(text, schema, ctx)
      if (!parsed.ok) throw new Error(`${text}: ${parsed.error.message}`)
      for (const issue of issues) {
        expect([text, issue._id, evaluate(parsed.value.ast, issue, ctx)]).toEqual([text, issue._id, legacy(issue)])
      }
    }
  })
})
