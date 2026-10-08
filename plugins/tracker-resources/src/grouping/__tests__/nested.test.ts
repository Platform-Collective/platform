//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  allGroups,
  buildNestedGroups,
  flattenNestedGroups,
  groupPathId,
  summarizeGroups,
  toggleGroupCollapsed,
  visibleNestedItems,
  type GroupLevel
} from '../nested'

interface Item {
  id: string
  team?: string
  stage?: string
  size?: number
}
const item = (id: string, team?: string, stage?: string, size?: number): Item => ({ id, team, stage, size })

const items: Item[] = [
  item('1', 'b', 'todo', 3),
  item('2', 'a', 'doing', 5),
  item('3', 'a', 'todo', 1),
  item('4', undefined, 'todo', 2),
  item('5', 'b', undefined, 4),
  item('6', 'a', 'todo', 8)
]

const byTeam: GroupLevel<Item> = { valueOf: (i) => i.team }
const byStage: GroupLevel<Item> = { valueOf: (i) => i.stage }
const ids = (list: Item[]): string[] => list.map((i) => i.id)

describe('buildNestedGroups', () => {
  it('has no groups without levels', () => {
    expect(buildNestedGroups(items, [])).toEqual([])
  })

  it('nests the groups level by level and keeps the order of the items', () => {
    const groups = buildNestedGroups(items, [byTeam, byStage])
    // first seen order, "No team" last
    expect(groups.map((g) => g.value)).toEqual(['b', 'a', undefined])
    const a = groups[1]
    expect(ids(a.items)).toEqual(['2', '3', '6'])
    expect(a.children.map((g) => g.value)).toEqual(['doing', 'todo'])
    expect(ids(a.children[1].items)).toEqual(['3', '6'])
    expect(a.children[1].level).toBe(1)
    expect(a.children[1].parentId).toBe(a.id)
    expect(a.children[1].children).toEqual([])
  })

  it('puts the group without a value last at every level', () => {
    const groups = buildNestedGroups(items, [byTeam, byStage])
    expect(groups[groups.length - 1].value).toBeUndefined()
    const b = groups[0]
    expect(b.children.map((g) => g.value)).toEqual(['todo', undefined])
  })

  it('treats null and empty values as no value', () => {
    const groups = buildNestedGroups(
      [item('1', ''), item('2'), item('3', 'a')],
      [{ valueOf: (i) => (i.id === '2' ? null : i.team) }]
    )
    expect(groups.map((g) => [g.value, ids(g.items)])).toEqual([
      ['a', ['3']],
      [undefined, ['1', '2']]
    ])
  })

  it('orders by the given order, then by the comparator, then by first seen', () => {
    const level: GroupLevel<Item> = {
      valueOf: (i) => i.team,
      order: ['b', 'a'],
      compare: (x, y) => x.localeCompare(y)
    }
    const more = [...items, item('7', 'z'), item('8', 'c')]
    expect(buildNestedGroups(more, [level]).map((g) => g.value)).toEqual(['b', 'a', 'c', 'z', undefined])
    // without a comparator the unlisted values follow in the order they are met
    const noCompare = { ...level, compare: undefined }
    expect(buildNestedGroups(more, [noCompare]).map((g) => g.value)).toEqual(['b', 'a', 'z', 'c', undefined])
  })

  it('orders alphabetically by label through the comparator', () => {
    const labels: Record<string, string> = { a: 'Zed', b: 'Alpha' }
    const level: GroupLevel<Item> = {
      valueOf: (i) => i.team,
      compare: (x, y) => labels[x].localeCompare(labels[y])
    }
    expect(buildNestedGroups(items, [level]).map((g) => g.value)).toEqual(['b', 'a', undefined])
  })

  it('orders by iteration date when the order lists iterations by their start', () => {
    const iterationOf: Record<string, string | undefined> = { 1: 'i3', 2: 'i1', 3: 'i2', 4: 'i1', 5: undefined, 6: 'i3' }
    const level: GroupLevel<Item> = { valueOf: (i) => iterationOf[i.id], order: ['i1', 'i2', 'i3'] }
    expect(buildNestedGroups(items, [level]).map((g) => [g.value, g.items.length])).toEqual([
      ['i1', 2],
      ['i2', 1],
      ['i3', 2],
      [undefined, 1]
    ])
  })

  it('lists the empty values of the order only when asked to', () => {
    const level: GroupLevel<Item> = { valueOf: (i) => i.team, order: ['a', 'x', 'b', undefined] }
    expect(buildNestedGroups(items, [level]).map((g) => g.value)).toEqual(['a', 'b', undefined])
    const all = buildNestedGroups(items, [{ ...level, includeEmpty: true }])
    expect(all.map((g) => [g.value, g.items.length])).toEqual([
      ['a', 3],
      ['x', 0],
      ['b', 2],
      [undefined, 1]
    ])
  })

  it('lists "No value" for an empty level only when the order mentions it', () => {
    const level: GroupLevel<Item> = { valueOf: (i) => i.team, order: ['a'], includeEmpty: true }
    expect(buildNestedGroups([item('1', 'a')], [level]).map((g) => g.value)).toEqual(['a'])
    const withNone: GroupLevel<Item> = { ...level, order: ['a', undefined] }
    expect(buildNestedGroups([item('1', 'a')], [withNone]).map((g) => g.value)).toEqual(['a', undefined])
  })

  it('shows empty groups of the first level only when the deeper levels do not ask for it', () => {
    const first: GroupLevel<Item> = { valueOf: (i) => i.team, order: ['a', 'x', 'b'], includeEmpty: true }
    const second: GroupLevel<Item> = { valueOf: (i) => i.stage, order: ['todo', 'doing', 'done'] }
    const groups = buildNestedGroups(items, [first, second])
    expect(groups.map((g) => g.value)).toEqual(['a', 'x', 'b', undefined])
    expect(groups[1].items).toEqual([])
    expect(groups[1].children).toEqual([])
    // no empty "done" under a
    expect(groups[0].children.map((g) => g.value)).toEqual(['todo', 'doing'])
  })

  it('lists the empty values of a deeper level under every parent when that level asks for it', () => {
    const second: GroupLevel<Item> = { valueOf: (i) => i.stage, order: ['todo', 'done'], includeEmpty: true }
    const groups = buildNestedGroups(items, [byTeam, second])
    // the first group is "b": one item in todo, none in done, one without a stage
    expect(groups[0].value).toBe('b')
    expect(groups[0].children.map((g) => [g.value, g.items.length])).toEqual([
      ['todo', 1],
      ['done', 0],
      [undefined, 1]
    ])
  })

  it('ignores a repeated value in the order', () => {
    const level: GroupLevel<Item> = { valueOf: (i) => i.team, order: ['a', 'a', 'b'] }
    expect(buildNestedGroups(items, [level]).map((g) => g.value)).toEqual(['a', 'b', undefined])
  })

  it('counts every level', () => {
    const groups = buildNestedGroups(items, [byTeam, byStage])
    const counts = allGroups(groups).map((g) => [g.id, g.items.length])
    expect(counts).toContainEqual([groupPathId(undefined, 'a'), 3])
    expect(counts).toContainEqual([groupPathId(groupPathId(undefined, 'a'), 'todo'), 2])
    // the counts of the children add up to the parent
    for (const g of allGroups(groups)) {
      if (g.children.length > 0) expect(g.children.reduce((n, c) => n + c.items.length, 0)).toBe(g.items.length)
    }
  })

  it('supports three levels', () => {
    const size: GroupLevel<Item> = { valueOf: (i) => (i.size === undefined ? undefined : i.size > 3 ? 'big' : 'small') }
    const groups = buildNestedGroups(items, [byTeam, byStage, size])
    const leaf = groups[1].children[1].children
    expect(leaf.map((g) => [g.value, ids(g.items), g.level])).toEqual([
      ['small', ['3'], 2],
      ['big', ['6'], 2]
    ])
    expect(leaf[0].children).toEqual([])
  })
})

describe('group ids', () => {
  it('are unique paths that survive other groups coming and going', () => {
    const full = buildNestedGroups(items, [byTeam, byStage])
    const without = buildNestedGroups(items.filter((i) => i.team !== 'b'), [byTeam, byStage])
    const idsOf = (g: ReturnType<typeof buildNestedGroups<Item>>): string[] => allGroups(g).map((x) => x.id)
    expect(new Set(idsOf(full)).size).toBe(idsOf(full).length)
    for (const id of idsOf(without)) expect(idsOf(full)).toContain(id)
  })

  it('tell "No value" from a value, and the same value under two parents', () => {
    expect(groupPathId(undefined, undefined)).not.toBe(groupPathId(undefined, 'undefined'))
    const groups = buildNestedGroups(items, [byTeam, byStage])
    const todoIds = allGroups(groups).filter((g) => g.value === 'todo').map((g) => g.id)
    expect(new Set(todoIds).size).toBe(todoIds.length)
    expect(todoIds.length).toBeGreaterThan(1)
  })

  it('escape the separator of values', () => {
    expect(groupPathId('/a', 'x/y')).toBe('/a/x%2Fy')
  })
})

describe('flattenNestedGroups', () => {
  const groups = buildNestedGroups(items, [byTeam, byStage])

  it('draws headers and, at the last level, the items', () => {
    const rows = flattenNestedGroups(groups, new Set())
    const first = rows.slice(0, 4).map((r) => (r.type === 'group' ? `g${r.depth}:${r.group.value}` : `i${r.depth}:${r.item.id}`))
    expect(first).toEqual(['g0:b', 'g1:todo', 'i2:1', 'g1:undefined'])
    expect(rows.filter((r) => r.type === 'item')).toHaveLength(items.length)
  })

  it('hides what is below a collapsed group but not the group', () => {
    const a = groups[1]
    const rows = flattenNestedGroups(groups, new Set([a.id]))
    expect(rows.some((r) => r.type === 'group' && r.group.id === a.id && r.collapsed)).toBe(true)
    expect(rows.some((r) => r.type === 'item' && ['2', '3', '6'].includes(r.item.id))).toBe(false)
    // a collapsed sub group keeps its siblings
    const todo = a.children[1]
    const some = flattenNestedGroups(groups, new Set([todo.id]))
    expect(some.some((r) => r.type === 'item' && r.item.id === '2')).toBe(true)
    expect(some.some((r) => r.type === 'item' && r.item.id === '3')).toBe(false)
  })

  it('lists the visible items in the order they are drawn', () => {
    expect(ids(visibleNestedItems(groups, new Set()))).toEqual(
      flattenNestedGroups(groups, new Set()).flatMap((r) => (r.type === 'item' ? [r.item.id] : []))
    )
    expect(ids(visibleNestedItems(groups, new Set([groups[0].id])))).not.toContain('1')
  })
})

describe('summarizeGroups', () => {
  it('summarizes every level and skips groups without items', () => {
    const level: GroupLevel<Item> = { valueOf: (i) => i.team, order: ['a', 'x'], includeEmpty: true }
    const groups = buildNestedGroups(items, [level, byStage])
    const sums = summarizeGroups(groups, (list) => list.reduce((n, i) => n + (i.size ?? 0), 0))
    expect(sums.get(groupPathId(undefined, 'a'))).toBe(14)
    expect(sums.get(groupPathId(groupPathId(undefined, 'a'), 'todo'))).toBe(9)
    expect(sums.has(groupPathId(undefined, 'x'))).toBe(false)
  })

  it('leaves a group out when there is nothing to show', () => {
    const groups = buildNestedGroups(items, [byTeam])
    expect(summarizeGroups(groups, () => undefined).size).toBe(0)
  })
})

describe('toggleGroupCollapsed', () => {
  it('collapses and expands without changing the given set', () => {
    const start: ReadonlySet<string> = new Set(['x'])
    const next = toggleGroupCollapsed(start, 'y')
    expect([...next]).toEqual(['x', 'y'])
    expect([...start]).toEqual(['x'])
    expect([...toggleGroupCollapsed(next, 'x')]).toEqual(['y'])
  })
})

describe('large lists', () => {
  it('groups 50k items on three levels quickly', () => {
    const teams = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']
    const stages = ['s0', 's1', 's2', 's3', 's4']
    const kinds = ['k0', 'k1', 'k2']
    const big: Item[] = []
    for (let n = 0; n < 50000; n++) {
      big.push({
        id: String(n),
        team: n % 11 === 0 ? undefined : teams[n % teams.length],
        stage: stages[n % stages.length],
        size: n % 7
      })
    }
    const levels: Array<GroupLevel<Item>> = [
      { valueOf: (i) => i.team, order: teams },
      { valueOf: (i) => i.stage, order: stages },
      { valueOf: (i) => kinds[Number(i.id) % kinds.length] }
    ]
    const started = Date.now()
    const groups = buildNestedGroups(big, levels)
    const rows = flattenNestedGroups(groups, new Set())
    const sums = summarizeGroups(groups, (list) => list.length)
    const took = Date.now() - started
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(50000)
    expect(rows.filter((r) => r.type === 'item')).toHaveLength(50000)
    expect(sums.size).toBe(allGroups(groups).length)
    expect(took).toBeLessThan(3000)
  })
})
