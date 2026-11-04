// SPDX-License-Identifier: EPL-2.0

import type { Person } from '@hcengineering/contact'
import { canMergePersons } from './visibilityTester'

const employees = new Set<string>(['employee'])

jest.mock('@hcengineering/presentation', () => ({
  getClient: () => ({
    getHierarchy: () => ({
      hasMixin: (person: Person) => employees.has(person._id)
    })
  })
}))

describe('canMergePersons', () => {
  it.each([['employee'], ['local']])('offers the merge action for the %s person', async (id) => {
    expect(await canMergePersons({ _id: id } as unknown as Person)).toBe(true)
  })
})
