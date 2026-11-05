// SPDX-License-Identifier: EPL-2.0

import { createMentionSearch, mergeMemberResults } from '../mention-search'

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


describe('popup full-text requests', () => {
  it('shares an in-flight request and its result across member updates', async () => {
    let resolve: (value: string[]) => void = () => {}
    const request = new Promise<string[]>((done) => { resolve = done })
    const search = jest.fn(() => request)
    const cached = createMentionSearch(search)
    const initial = cached('ann')
    const membersLoaded = cached('ann')
    expect(search).toHaveBeenCalledTimes(1)
    resolve(['ann'])
    await expect(initial).resolves.toEqual(['ann'])
    await expect(membersLoaded).resolves.toEqual(['ann'])
    await expect(cached('ann')).resolves.toEqual(['ann'])
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('starts a new request for changed text and retries a rejected request', async () => {
    const search = jest.fn(async (query: string) => query)
    const cached = createMentionSearch(search)
    await cached('a')
    await cached('b')
    expect(search).toHaveBeenCalledTimes(2)
    search.mockRejectedValueOnce(new Error('offline'))
    await expect(cached('c')).rejects.toThrow('offline')
    await expect(cached('c')).resolves.toBe('c')
    expect(search).toHaveBeenCalledTimes(4)
  })
})
