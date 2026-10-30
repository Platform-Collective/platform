// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import type { AvatarType, Person } from '@hcengineering/contact'
import type { Class, Doc, PersonId, PersonUuid, Ref, Space, TxOperations } from '@hcengineering/core'
import { finishPersonMerge } from './finish-person-merge'

function createPerson (id: string, personUuid?: PersonUuid): Person {
  return {
    _id: id as Ref<Person>,
    _class: 'contact:class:Person' as Ref<Class<Person>>,
    space: 'contact:space:Contacts' as Ref<Space>,
    modifiedBy: 'maintainer' as PersonId,
    modifiedOn: 1,
    name: 'Talent,Test',
    avatarType: 'color' as AvatarType,
    personUuid
  }
}

describe('finishPersonMerge', () => {
  const sourceUuid = 'source-uuid' as PersonUuid
  const targetUuid = 'target-uuid' as PersonUuid

  it.each([
    [undefined, undefined],
    [undefined, targetUuid],
    [sourceUuid, undefined],
    [sourceUuid, targetUuid]
  ])('removes the source and retains the merged target (%s, %s)', async (sourcePersonUuid, targetPersonUuid) => {
    const source = createPerson('source', sourcePersonUuid)
    const target: Person = { ...createPerson('target', targetPersonUuid), city: 'Merged location' }
    const persons = new Map<Ref<Doc>, Person>([
      [source._id, source],
      [target._id, target]
    ])
    const remove = jest.fn(async (person: Doc) => {
      persons.delete(person._id)
      return {}
    })
    const mergeSpecifiedPersons = jest.fn(async () => {
      expect(persons.has(source._id)).toBe(true)
    })
    const client: Pick<TxOperations, 'remove'> = { remove }
    const accountClient: Pick<AccountClient, 'mergeSpecifiedPersons'> = { mergeSpecifiedPersons }

    await finishPersonMerge(client, accountClient, source, target)

    expect([...persons.values()]).toEqual([target])
    expect(persons.get(target._id)?.city).toBe('Merged location')
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(source)
    if (sourcePersonUuid !== undefined && targetPersonUuid !== undefined) {
      expect(mergeSpecifiedPersons).toHaveBeenCalledWith(targetPersonUuid, sourcePersonUuid)
    } else {
      expect(mergeSpecifiedPersons).not.toHaveBeenCalled()
    }
  })

  it('retains the source if the global merge is rejected', async () => {
    const source = createPerson('source', sourceUuid)
    const target = createPerson('target', targetUuid)
    const error = new Error('Forbidden')
    const remove = jest.fn(async () => ({}))
    const mergeSpecifiedPersons = jest.fn(async () => {
      throw error
    })

    await expect(finishPersonMerge({ remove }, { mergeSpecifiedPersons }, source, target)).rejects.toThrow(error)

    expect(remove).not.toHaveBeenCalled()
  })

  it('waits for source removal before completing the merge', async () => {
    const source = createPerson('source')
    const target = createPerson('target')
    let resolveRemoval: () => void = () => {
      throw new Error('Removal has not started')
    }
    const removal = new Promise<void>((resolve) => {
      resolveRemoval = resolve
    })
    const remove = jest.fn(async () => {
      await removal
      return {}
    })
    const mergeSpecifiedPersons = jest.fn<Promise<void>, []>().mockResolvedValue(undefined)
    const completed = jest.fn()
    const merge = finishPersonMerge({ remove }, { mergeSpecifiedPersons }, source, target).then(completed)

    await Promise.resolve()
    expect(remove).toHaveBeenCalledWith(source)
    expect(completed).not.toHaveBeenCalled()

    resolveRemoval()
    await merge
    expect(completed).toHaveBeenCalledTimes(1)
  })

  it('propagates a denied source deletion', async () => {
    const source = createPerson('source')
    const target = createPerson('target')
    const error = new Error('Delete permission denied')
    const remove = jest.fn(async () => {
      throw error
    })
    const mergeSpecifiedPersons = jest.fn<Promise<void>, []>().mockResolvedValue(undefined)

    await expect(finishPersonMerge({ remove }, { mergeSpecifiedPersons }, source, target)).rejects.toThrow(error)
  })

  it('rejects a self merge without changing either service', async () => {
    const source = createPerson('source', sourceUuid)
    const remove = jest.fn(async () => ({}))
    const mergeSpecifiedPersons = jest.fn<Promise<void>, []>().mockResolvedValue(undefined)

    await expect(finishPersonMerge({ remove }, { mergeSpecifiedPersons }, source, source)).rejects.toThrow(
      'Cannot merge a person with itself'
    )

    expect(remove).not.toHaveBeenCalled()
    expect(mergeSpecifiedPersons).not.toHaveBeenCalled()
  })
})
