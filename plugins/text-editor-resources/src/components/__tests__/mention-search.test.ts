// SPDX-License-Identifier: EPL-2.0

import { mergeMemberResults } from '../mention-search'

interface Item {
  num: number
  category: string
  item: { id: string, title: string }
}

function item (category: string, id: string, num: number): Item {
  return { num, category, item: { id, title: id } }
}

const isEmployee = (it: Item): boolean => it.category === 'employee'

describe('mergeMemberResults', () => {
  const fullText = [
    item('employee', 'ranked-a', 0),
    item('employee', 'member-b', 1),
    item('employee', 'ranked-c', 2),
    item('issue', 'issue-1', 0),
    item('issue', 'issue-2', 1),
    item('document', 'doc-1', 0)
  ]

  it('returns the full-text results unchanged without members', () => {
    expect(mergeMemberResults([], fullText, isEmployee)).toBe(fullText)
  })

  it('puts members first in one employee section and keeps the other categories in place', () => {
    const members = [item('employee', 'member-a', 0), item('employee', 'member-b', 1)]
    const merged = mergeMemberResults(members, fullText, isEmployee)

    expect(merged.map((it) => it.item.id)).toEqual([
      'member-a',
      'member-b',
      'ranked-a',
      'ranked-c',
      'issue-1',
      'issue-2',
      'doc-1'
    ])
    // One header per category: the first item of each category has num 0.
    expect(merged.map((it) => it.num)).toEqual([0, 1, 2, 3, 0, 1, 0])
    expect(merged.filter((it) => it.num === 0).map((it) => it.category)).toEqual(['employee', 'issue', 'document'])
  })

  it('uses the full-text version of a member that also matched the full-text search', () => {
    const fromFullText = { ...item('employee', 'member-b', 1), item: { id: 'member-b', title: 'Full text title' } }
    const merged = mergeMemberResults([item('employee', 'member-b', 0)], [fromFullText], isEmployee)

    expect(merged).toEqual([{ ...fromFullText, num: 0 }])
  })

  it('ends the employee section after the last employee, so @everyone and @here stay next to it', () => {
    const merged = mergeMemberResults([item('employee', 'member-a', 0)], fullText, isEmployee)

    expect(merged.findLastIndex(isEmployee)).toBe(3)
    expect(merged[4].category).toBe('issue')
  })
})
