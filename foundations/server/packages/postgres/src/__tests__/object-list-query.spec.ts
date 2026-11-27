// SPDX-License-Identifier: EPL-2.0

import { type Class, type Doc, Hierarchy, ModelDb, type Ref, type WorkspaceUuid } from '@hcengineering/core'
import { PostgresAdapter } from '../storage'
import { genMinModel } from './minmodel'
import { createTaskModel, taskPlugin } from './tasks'

/**
 * Collects query parameters the way the adapter's own variables do: each value becomes `$n` plus its cast.
 */
class TestVariables {
  values: any[] = []

  add (value: any, type: string = ''): string {
    this.values.push(value)
    return `$${this.values.length}${type}`
  }

  addArray (value: any[], type: string = ''): string {
    return this.add(
      value.filter((it) => it != null),
      type
    )
  }

  addArrayI (value: any[], type: string = ''): string {
    const vals = value.filter((it) => it != null)
    return vals.length === 0 ? "array['NULL']" : this.add(vals, type)
  }
}

const linkA = { _id: 'link-a' as Ref<Doc>, _class: 'class:Linked' as Ref<Class<Doc>> }
const linkB = { _id: 'link-b' as Ref<Doc>, _class: 'class:Linked' as Ref<Class<Doc>> }

describe('postgres - $in / $nin / $all over a list of links', () => {
  let adapter: any

  beforeAll(async () => {
    const txes = genMinModel()
    createTaskModel(txes)
    const hierarchy = new Hierarchy()
    const model = new ModelDb(hierarchy)
    for (const tx of txes) {
      hierarchy.tx(tx)
    }
    for (const tx of txes) {
      await model.tx(tx)
    }
    // No connection is opened: only the query builder is used.
    adapter = new PostgresAdapter(
      {} as any,
      {} as any,
      { url: () => '', close: () => {} },
      'workspace' as WorkspaceUuid,
      hierarchy,
      model,
      'test'
    )
  })

  function build (query: Record<string, any>): { sql: string, values: any[] } {
    const vars = new TestVariables()
    const sql: string = adapter.buildQuery(vars, taskPlugin.class.Task, 'test_task', query, [], { skipClass: true })
    return { sql, values: vars.values }
  }

  it('matches any of several links by JSON containment', () => {
    const { sql, values } = build({ links: { $in: [linkA, linkB] } })
    expect(sql).toContain("(test_task.data->'links' @> $2::text::jsonb OR test_task.data->'links' @> $3::text::jsonb)")
    expect(values.slice(1)).toEqual([JSON.stringify([linkA]), JSON.stringify([linkB])])
    expect(sql).not.toContain('?|')
    expect(JSON.stringify(values)).not.toContain('[object Object]')
  })

  it('matches all of several links by JSON containment', () => {
    const { sql, values } = build({ links: { $all: [linkA, linkB] } })
    expect(sql).toContain("test_task.data->'links' @> $2::text::jsonb")
    expect(values[1]).toEqual(JSON.stringify([linkA, linkB]))
    expect(JSON.stringify(values)).not.toContain('[object Object]')
  })

  it('passes link values as parameters, not inside the SQL text', () => {
    const quoted = { _id: "it's" as Ref<Doc>, _class: 'class:Linked' as Ref<Class<Doc>> }
    for (const op of ['$in', '$all']) {
      const { sql, values } = build({ links: { [op]: [quoted] } })
      expect(sql).not.toContain("it's")
      expect(values.slice(1).join()).toContain("it's")
    }
  })

  it('matches links by _id and _class only', () => {
    const { values } = build({ links: { $in: [{ ...linkA, title: 'extra' }] } })
    expect(values[1]).toEqual(JSON.stringify([linkA]))
  })

  it('translates $nin over links as the complement of $in', () => {
    const { sql } = build({ links: { $nin: [linkA] } })
    expect(sql).toContain("NOT COALESCE((test_task.data->'links' @> $2::text::jsonb), FALSE)")
  })

  it('adds a null branch for null operands', () => {
    const { sql, values } = build({ links: { $in: [linkA, null] } })
    expect(sql).toContain(
      "(test_task.data->'links' @> $2::text::jsonb OR test_task.data->'links' IS NULL OR " +
        "jsonb_typeof(test_task.data->'links') = 'null' OR test_task.data->'links' @> '[null]'::jsonb)"
    )
    expect(values.slice(1)).toEqual([JSON.stringify([linkA])])
  })

  it('handles empty operands', () => {
    expect(build({ links: { $in: [] } }).sql).toContain('FALSE')
    expect(build({ links: { $all: [] } }).sql).toContain("jsonb_typeof(test_task.data->'links') = 'array'")
  })

  it('keeps the existing translation for lists of plain values', () => {
    expect(build({ arr: { $in: [1, 2] } }).sql).toContain("test_task.data->'arr' ?| $2::text[]")
    const all = build({ arr: { $all: [1, 2] } })
    expect(all.sql).toContain("test_task.data->'arr' @> $2::text::jsonb")
    expect(all.values[1]).toEqual('["1","2"]')
    expect(build({ arr: { $nin: [1, 2] } }).sql).toContain("(test_task.data->>'arr')::text != ALL($2::text[])")
  })
})
