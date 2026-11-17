// SPDX-License-Identifier: EPL-2.0

import type { Contact } from '@hcengineering/contact'
import { findProperty } from '@hcengineering/core'
import { getPersonNameQueries } from './person-name-query'

function matchesName (name: string, search: string): boolean {
  const person = { name } as unknown as Contact
  return getPersonNameQueries(search).some((query) => findProperty([person], 'name', query.name).length > 0)
}

describe('getPersonNameQueries', () => {
  it.each(['John Smith', 'Smith John', 'john smith', 'Jo Smi', 'Smi Jo', '  John   Smith  '])(
    'matches the stored name using %j',
    (search) => {
      expect(matchesName('Smith,John', search)).toBe(true)
    }
  )

  it.each(['John', 'Smith', 'oh', 'Smith,John', '', '   '])('preserves searches using %j', (search) => {
    expect(matchesName('Smith,John', search)).toBe(true)
  })

  it.each([
    ['Smith,John Paul', 'John Paul Smith'],
    ['Smith,John Paul', 'Smith John Paul'],
    ['van Smith,John', 'John van Smith'],
    ['van Smith,John', 'van Smith John'],
    ['van Smith,John Paul', 'John Paul van Smith'],
    ['van Smith,John Paul', 'van Smith John Paul']
  ])('matches multiword name %j using %j', (name, search) => {
    expect(matchesName(name, search)).toBe(true)
  })

  it.each(['John Jones', 'Jane Smith', 'John Paul Smith', 'Smith Jane'])('rejects unrelated name %j', (search) => {
    expect(matchesName('Smith,John', search)).toBe(false)
  })

  it('preserves punctuation as literal characters', () => {
    expect(matchesName("O'Neil,John (J.)", "John (J.) O'Neil")).toBe(true)
    expect(matchesName("O'Neil,John XJY", "John (J.) O'Neil")).toBe(false)
  })
})
