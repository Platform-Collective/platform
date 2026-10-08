//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { buildHierarchyRows, expandableIds, MAX_HIERARCHY_DEPTH } from '../hierarchy'

interface Item {
  id: string
  parent?: string
}

const item = (id: string, parent?: string): Item => ({ id, parent })
const idOf = (it: Item): string => it.id
const parentOf = (it: Item): string | undefined => it.parent

function rows (items: Item[], expanded: string[] = [], maxDepth?: number): string[] {
  return buildHierarchyRows(items, { idOf, parentOf, expanded: new Set(expanded), maxDepth }).map(
    (r) => `${'-'.repeat(r.depth)}${r.item.id}`
  )
}

describe('buildHierarchyRows', () => {
  const tree = [item('a'), item('a1', 'a'), item('a2', 'a'), item('a11', 'a1'), item('b'), item('b1', 'b')]

  it('shows only the top level rows while everything is collapsed', () => {
    expect(rows(tree)).toEqual(['a', 'b'])
  })

  it('shows the children of an expanded row right after it', () => {
    expect(rows(tree, ['a'])).toEqual(['a', '-a1', '-a2', 'b'])
  })

  it('nests several levels and keeps the sibling order', () => {
    expect(rows(tree, ['a', 'a1', 'b'])).toEqual(['a', '-a1', '--a11', '-a2', 'b', '-b1'])
  })

  it('does not show the children of a collapsed row even if its child is expanded', () => {
    expect(rows(tree, ['a1'])).toEqual(['a', 'b'])
  })

  it('reports the state of every row', () => {
    const res = buildHierarchyRows(tree, { idOf, parentOf, expanded: new Set(['a']) })
    const byId = new Map(res.map((r) => [r.item.id, r]))
    expect(byId.get('a')).toMatchObject({ depth: 0, hasChildren: true, expanded: true, childCount: 2 })
    expect(byId.get('a1')).toMatchObject({ depth: 1, hasChildren: true, expanded: false, childCount: 1 })
    expect(byId.get('a2')).toMatchObject({ depth: 1, hasChildren: false, expanded: false, childCount: 0 })
    expect(byId.get('b')).toMatchObject({ hasChildren: true, expanded: false })
  })

  it('shows a child whose parent is not in the list as a top level row', () => {
    // `p` was filtered out
    expect(rows([item('x', 'p'), item('y'), item('z', 'x')], ['x'])).toEqual(['x', '-z', 'y'])
  })

  it('treats a missing parent and a self reference as top level', () => {
    expect(rows([item('a', 'a'), item('b', undefined)])).toEqual(['a', 'b'])
  })

  it('returns nothing for an empty list', () => {
    expect(rows([])).toEqual([])
  })

  it('keeps the first of duplicated ids', () => {
    expect(rows([item('a'), item('a'), item('b')])).toEqual(['a', 'b'])
  })

  it('does not depend on the parent coming first', () => {
    expect(rows([item('c', 'p'), item('p')], ['p'])).toEqual(['p', '-c'])
  })

  it('never loops on a cycle and does not lose its items', () => {
    const cyclic = [item('a', 'b'), item('b', 'a'), item('c')]
    const res = rows(cyclic, ['a', 'b'])
    expect([...res].map((r) => r.replace(/-/g, '')).sort()).toEqual(['a', 'b', 'c'])
    expect(res).toContain('c')
  })

  it('stops nesting at the deepest level and keeps the deeper items as top level rows after their tree', () => {
    const chain: Item[] = []
    for (let i = 0; i < 12; i++) chain.push(item(`n${i}`, i === 0 ? undefined : `n${i - 1}`))
    chain.push(item('other'))
    const all = chain.map((c) => c.id)
    const res = rows(chain, all)
    // n0..n7 are nested (8 levels), n8 starts again at the top level, `other` comes last
    expect(res.slice(0, MAX_HIERARCHY_DEPTH)).toEqual(['n0', '-n1', '--n2', '---n3', '----n4', '-----n5', '------n6', '-------n7'])
    expect(res[MAX_HIERARCHY_DEPTH]).toBe('n8')
    expect(res[res.length - 1]).toBe('other')
    expect(res.map((r) => r.replace(/-/g, '')).sort()).toEqual([...all].sort())
    // the deepest nested row has nothing to expand
    const deepest = buildHierarchyRows(chain, { idOf, parentOf, expanded: new Set(all) })[MAX_HIERARCHY_DEPTH - 1]
    expect(deepest.hasChildren).toBe(false)
  })

  it('honours a custom depth', () => {
    expect(rows(tree, ['a', 'a1', 'b'], 2)).toEqual(['a', '-a1', '-a2', 'a11', 'b', '-b1'])
  })

  it('keeps the descendants of a collapsed deep branch hidden', () => {
    const chain: Item[] = []
    for (let i = 0; i < 12; i++) chain.push(item(`n${i}`, i === 0 ? undefined : `n${i - 1}`))
    // n0 is collapsed: only it is shown, the deep items must not turn up as top level rows
    expect(rows(chain, [])).toEqual(['n0'])
  })

  it('handles a large flat list and a large tree quickly', () => {
    const items: Item[] = []
    for (let i = 0; i < 20000; i++) items.push(item(`r${i}`))
    for (let i = 0; i < 20000; i++) items.push(item(`c${i}`, `r${i}`))
    const start = Date.now()
    const collapsed = buildHierarchyRows(items, { idOf, parentOf, expanded: new Set() })
    expect(collapsed).toHaveLength(20000)
    const expanded = buildHierarchyRows(items, {
      idOf,
      parentOf,
      expanded: new Set(items.filter((it) => it.id.startsWith('r')).map((it) => it.id))
    })
    expect(expanded).toHaveLength(40000)
    expect(Date.now() - start).toBeLessThan(3000)
  })

  it('does not overflow the stack for a very long chain', () => {
    const items: Item[] = []
    for (let i = 0; i < 50000; i++) items.push(item(`n${i}`, i === 0 ? undefined : `n${i - 1}`))
    const res = buildHierarchyRows(items, { idOf, parentOf, expanded: new Set(items.map(idOf)) })
    expect(res).toHaveLength(50000)
  })
})

describe('expandableIds', () => {
  it('lists the items that have children in the list', () => {
    const items = [item('a'), item('a1', 'a'), item('b'), item('c1', 'gone'), item('s', 's')]
    expect(expandableIds(items, idOf, parentOf)).toEqual(['a'])
  })
})
