// SPDX-License-Identifier: EPL-2.0

import { rankByName } from './member-search'

interface Named {
  id: string
  names: string[]
}

const names = (it: Named): string[] => it.names

describe('rankByName', () => {
  const people: Named[] = [
    { id: 'joanna', names: ['Joanna Smith'] },
    { id: 'anna', names: ['Anna Berg'] },
    { id: 'hannah', names: ['Hannah Lee'] },
    { id: 'an', names: ['An Ho'] },
    { id: 'bob', names: ['Bob Stone'] }
  ]

  it('ranks exact, then prefix, then word prefix, then contains matches', () => {
    expect(rankByName(people, 'an', names, 10).map((it) => it.id)).toEqual(['an', 'anna', 'hannah', 'joanna'])
  })

  it('matches any of the given names, ignoring case and surrounding spaces', () => {
    const withDisplayName = [{ id: 'x', names: ['Doe,John', 'Johnny'] }]
    expect(rankByName(withDisplayName, ' JOHNNY ', names, 10).map((it) => it.id)).toEqual(['x'])
    expect(rankByName(withDisplayName, 'john', names, 10).map((it) => it.id)).toEqual(['x'])
  })

  it('returns the first names alphabetically for an empty search', () => {
    expect(rankByName(people, '', names, 3).map((it) => it.id)).toEqual(['an', 'anna', 'bob'])
  })

  it('limits the number of results', () => {
    expect(rankByName(people, 'a', names, 2)).toHaveLength(2)
  })
})


it('matches composed and decomposed accents with or without accents in the query', () => {
  const people = [{ id: 'jose', names: ['José García'] }, { id: 'zoe', names: ['Zoe\u0308 Martin'] }]
  expect(rankByName(people, 'jose', names, 5).map((person) => person.id)).toEqual(['jose'])
  expect(rankByName(people, 'GARCÍA', names, 5).map((person) => person.id)).toEqual(['jose'])
  expect(rankByName(people, 'zoë', names, 5).map((person) => person.id)).toEqual(['zoe'])
})
