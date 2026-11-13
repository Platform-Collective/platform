// SPDX-License-Identifier: EPL-2.0

import type { Person } from '@hcengineering/contact'
import type { Ref, TxOperations } from '@hcengineering/core'
import { updateAllRefs } from './update-person-refs'

jest.mock(
  '@hcengineering/core',
  () => ({
    __esModule: true,
    default: { class: { Attribute: 'attribute', RefTo: 'ref', ArrOf: 'array', Tx: 'tx', BenchmarkDoc: 'benchmark' } }
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/contact',
  () => ({
    __esModule: true,
    default: { class: { Person: 'person' } }
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/presentation',
  () => ({
    updateAttribute: async (builder: { moved: () => void }) => {
      builder.moved()
    }
  }),
  { virtual: true }
)

describe('updateAllRefs', () => {
  it('continues scalar and array classes after failures, then reports all failing classes', async () => {
    const moved: string[] = []
    let currentClass = ''
    const scalar = { name: 'owner', attributeOf: 'scalar-parent', type: { _class: 'ref', to: 'person' } }
    const array = {
      name: 'members',
      attributeOf: 'array-parent',
      type: { _class: 'array', of: { _class: 'ref', to: 'person' } }
    }
    const client = {
      getHierarchy: () => ({
        getAncestors: () => ['person'],
        getBaseClass: () => 'person',
        getDescendants: (parent: string) =>
          parent === 'scalar-parent' ? ['broken-scalar', 'good-scalar'] : ['broken-array', 'good-array'],
        isDerived: () => false,
        findDomain: () => 'domain'
      }),
      findAll: jest.fn(async (cls: string, query: Record<string, string>) => {
        if (cls === 'attribute') return query['type._class'] === 'ref' ? [scalar] : [array]
        currentClass = cls
        if (cls.startsWith('broken')) throw new Error('Denied')
        return moved.includes(cls) ? [] : [{ _id: cls }]
      }),
      apply: () => ({
        txes: [{}],
        moved: () => {
          moved.push(currentClass)
        },
        commit: async () => {}
      })
    }
    const source: Pick<Person, '_id'> = { _id: 'source' as Ref<Person> }
    const target: Pick<Person, '_id'> = { _id: 'target' as Ref<Person> }
    await expect(updateAllRefs(client as unknown as TxOperations, source, target)).rejects.toThrow(
      'broken-scalar, broken-array'
    )
    expect(moved).toEqual(['good-scalar', 'good-array'])
  })
})
