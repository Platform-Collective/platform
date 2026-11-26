// SPDX-License-Identifier: EPL-2.0

import core, { type AccountUuid, type AnyAttribute, type Client, type PersonId, type Ref } from '@hcengineering/core'
import contact, { getPersonRefsBySocialIds, type Person } from '@hcengineering/contact'
import { createFilterPersonUpdater, getFilterPersonRefs } from '../components/filter/person-filter'
import type { PersonFilterValue } from '../components/filter/person-filter'

jest.mock('@hcengineering/core', () => ({
  __esModule: true,
  default: { class: { ArrOf: 'core:class:ArrOf', TypeAccountUuid: 'core:class:TypeAccountUuid' } }
}))

jest.mock('@hcengineering/contact', () => ({
  __esModule: true,
  default: { class: { Person: 'contact:class:Person' } },
  getPersonRefsBySocialIds: jest.fn()
}))

const ownerUuid = 'abcdefaa-1111-4111-8111-111111111111' as AccountUuid
const userUuid = 'bcdefabb-2222-4222-8222-222222222222' as AccountUuid
const ownerRef = 'owner' as Ref<Person>
const userRef = 'user' as Ref<Person>
const accountType = { _class: core.class.TypeAccountUuid } as unknown as AnyAttribute['type']
const membersType = { ...accountType, _class: core.class.ArrOf, of: accountType } as unknown as AnyAttribute['type']
const socialType = { _class: 'core:class:TypePersonId' } as unknown as AnyAttribute['type']
const socialOwner = 'social-owner' as PersonId
const socialUser = 'social-user' as PersonId
const resolveSocialIds = jest.mocked(getPersonRefsBySocialIds)
const findAll = jest.fn()
const client = { findAll } as unknown as Client

beforeEach(() => {
  findAll.mockReset()
  resolveSocialIds.mockReset()
})

describe('getFilterPersonRefs', () => {
  it('resolves Members tuples by the stored account UUIDs', async () => {
    findAll.mockResolvedValue([
      { _id: ownerRef, personUuid: ownerUuid },
      { _id: userRef, personUuid: userUuid }
    ])
    const selected: PersonFilterValue[] = [
      [ownerUuid.toUpperCase(), [ownerUuid]],
      [userUuid.toUpperCase(), [userUuid]]
    ]

    expect(await getFilterPersonRefs(client, selected, membersType)).toEqual([ownerRef, userRef])
    expect(findAll).toHaveBeenCalledWith(
      contact.class.Person,
      { personUuid: { $in: [ownerUuid, userUuid] } },
      { projection: { _id: 1, personUuid: 1 } }
    )
    expect(resolveSocialIds).not.toHaveBeenCalled()
  })

  it('resolves a scalar account ValueFilter tuple', async () => {
    findAll.mockResolvedValue([{ _id: ownerRef, personUuid: ownerUuid }])

    expect(await getFilterPersonRefs(client, [[ownerUuid.toUpperCase(), [ownerUuid]]], accountType)).toEqual([ownerRef])
    expect(findAll.mock.calls[0][1]).toEqual({ personUuid: { $in: [ownerUuid] } })
  })

  it('resolves every stored value in a group', async () => {
    findAll.mockResolvedValue([
      { _id: ownerRef, personUuid: ownerUuid },
      { _id: userRef, personUuid: userUuid }
    ])
    const selected: PersonFilterValue[] = [['Members', [ownerUuid, userUuid, ownerUuid]]]

    expect(await getFilterPersonRefs(client, selected, membersType)).toEqual([ownerRef, userRef])
    expect(findAll.mock.calls[0][1]).toEqual({ personUuid: { $in: [ownerUuid, userUuid, ownerUuid] } })
    expect(resolveSocialIds).not.toHaveBeenCalled()
  })

  it('preserves flat social identity filters', async () => {
    const socialIds = [socialOwner, socialUser]
    resolveSocialIds.mockResolvedValue({ [socialOwner]: ownerRef, [socialUser]: userRef })

    expect(await getFilterPersonRefs(client, socialIds, socialType)).toEqual([ownerRef, userRef])
    expect(resolveSocialIds).toHaveBeenCalledTimes(1)
    expect(resolveSocialIds).toHaveBeenCalledWith(client, socialIds)
    expect(findAll).not.toHaveBeenCalled()
  })

  it('deduplicates persons across selected social identities and groups', async () => {
    const otherSocialOwner = 'social-owner-other' as PersonId
    resolveSocialIds.mockResolvedValue({ [socialOwner]: ownerRef, [otherSocialOwner]: ownerRef, [socialUser]: userRef })
    const selected: PersonFilterValue[] = [[socialOwner.toUpperCase(), [socialOwner, otherSocialOwner]], socialUser]

    expect(await getFilterPersonRefs(client, selected, socialType)).toEqual([ownerRef, userRef])
    expect(resolveSocialIds).toHaveBeenCalledWith(client, [socialOwner, otherSocialOwner, socialUser])
    expect(findAll).not.toHaveBeenCalled()
  })

  it('unwraps grouped social identity values without treating them as account UUIDs', async () => {
    resolveSocialIds.mockResolvedValue({ [socialOwner]: ownerRef })
    const arrayType = { ...socialType, _class: core.class.ArrOf, of: socialType } as unknown as AnyAttribute['type']
    const selected: PersonFilterValue[] = [[socialOwner.toUpperCase(), [socialOwner]]]

    expect(await getFilterPersonRefs(client, selected, arrayType)).toEqual([ownerRef])
    expect(resolveSocialIds).toHaveBeenCalledTimes(1)
    expect(resolveSocialIds).toHaveBeenCalledWith(client, [socialOwner])
    expect(findAll).not.toHaveBeenCalled()
  })

  it('preserves selected account order despite database order', async () => {
    findAll.mockResolvedValue([
      { _id: userRef, personUuid: userUuid },
      { _id: ownerRef, personUuid: ownerUuid }
    ])

    expect(await getFilterPersonRefs(client, [ownerUuid, userUuid, ownerUuid], accountType)).toEqual([
      ownerRef,
      userRef
    ])
    expect(findAll).toHaveBeenCalledWith(
      contact.class.Person,
      { personUuid: { $in: [ownerUuid, userUuid, ownerUuid] } },
      { projection: { _id: 1, personUuid: 1 } }
    )
  })

  it('case-normalizes returned rows in a synthetic lookup response', async () => {
    // This row would not match the exact-text query. Isolate post-query mapping only;
    // this synthetic response does not test case-insensitive retrieval from storage.
    findAll.mockResolvedValue([{ _id: ownerRef, personUuid: ownerUuid }])
    const selected: PersonFilterValue[] = [ownerUuid.toUpperCase() as AccountUuid]

    expect(await getFilterPersonRefs(client, selected, accountType)).toEqual([ownerRef])
    expect(findAll).toHaveBeenCalledWith(
      contact.class.Person,
      { personUuid: { $in: selected } },
      { projection: { _id: 1, personUuid: 1 } }
    )
  })

  it('preserves selected social identity order despite lookup order', async () => {
    resolveSocialIds.mockResolvedValue({ [socialUser]: userRef, [socialOwner]: ownerRef })

    expect(await getFilterPersonRefs(client, [socialOwner, socialUser], socialType)).toEqual([ownerRef, userRef])
    expect(resolveSocialIds).toHaveBeenCalledWith(client, [socialOwner, socialUser])
  })

  it('preserves distinct local persons sharing an account UUID', async () => {
    findAll.mockResolvedValue([
      { _id: ownerRef, personUuid: ownerUuid },
      { _id: userRef, personUuid: ownerUuid }
    ])

    expect(await getFilterPersonRefs(client, [ownerUuid], accountType)).toEqual([ownerRef, userRef])
  })

  it('omits unresolved account UUIDs without changing the stored selection', async () => {
    const selected: PersonFilterValue[] = [ownerUuid, userUuid]
    findAll.mockResolvedValue([{ _id: userRef, personUuid: userUuid }])

    expect(await getFilterPersonRefs(client, selected, membersType)).toEqual([userRef])
    expect(selected).toEqual([ownerUuid, userUuid])
    expect(findAll.mock.calls[0][1]).toEqual({ personUuid: { $in: [ownerUuid, userUuid] } })
  })

  it('returns no persons when all account UUIDs are unresolved', async () => {
    findAll.mockResolvedValue([])

    expect(await getFilterPersonRefs(client, [ownerUuid], accountType)).toEqual([])
    expect(findAll.mock.calls[0][1]).toEqual({ personUuid: { $in: [ownerUuid] } })
  })

  it('omits unresolved social identities without changing the stored selection', async () => {
    const selected: PersonFilterValue[] = [socialOwner, socialUser]
    resolveSocialIds.mockResolvedValue({ [socialUser]: userRef })

    expect(await getFilterPersonRefs(client, selected, socialType)).toEqual([userRef])
    expect(selected).toEqual([socialOwner, socialUser])
    expect(resolveSocialIds).toHaveBeenCalledWith(client, [socialOwner, socialUser])
  })

  it('does not resolve inherited object properties as social identities', async () => {
    resolveSocialIds.mockResolvedValue({})

    expect(await getFilterPersonRefs(client, ['toString'], socialType)).toEqual([])
    expect(resolveSocialIds).toHaveBeenCalledWith(client, ['toString'])
  })

  it('ignores malformed stored values while resolving valid social IDs', async () => {
    resolveSocialIds.mockResolvedValue({ [socialOwner]: ownerRef, [socialUser]: userRef })
    const selected = [42, null, [socialOwner.toUpperCase(), [socialOwner, false, [socialUser], {}]], socialUser]

    expect(await getFilterPersonRefs(client, selected, socialType)).toEqual([ownerRef, userRef])
    expect(resolveSocialIds).toHaveBeenCalledWith(client, [socialOwner, socialUser])
    expect(findAll).not.toHaveBeenCalled()
  })

  it.each([
    { values: [], type: membersType },
    { values: [[undefined, []]], type: membersType },
    { values: [undefined, null], type: membersType },
    { values: [42, false, {}, ['MALFORMED'], ['NESTED', [[ownerUuid]]]], type: membersType },
    { values: [], type: socialType },
    { values: [[undefined, []]], type: socialType },
    { values: [undefined, null], type: socialType },
    { values: [42, false, {}, ['MALFORMED'], ['NESTED', [[socialOwner]]]], type: socialType }
  ])('does not query for empty selections: $values', async ({ values, type }) => {
    expect(await getFilterPersonRefs(client, values, type)).toEqual([])
    expect(findAll).not.toHaveBeenCalled()
    expect(resolveSocialIds).not.toHaveBeenCalled()
  })

  it.each([accountType, socialType])('propagates lookup errors for $_class', async (type) => {
    const error = new Error('Person lookup failed')
    findAll.mockRejectedValue(error)
    resolveSocialIds.mockRejectedValue(error)

    await expect(getFilterPersonRefs(client, [ownerUuid], type)).rejects.toBe(error)
  })
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T> (): Deferred<T> {
  let resolvePromise: Deferred<T>['resolve'] | undefined
  let rejectPromise: Deferred<T>['reject'] | undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error('Promise executor did not run synchronously')
  }
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

describe('createFilterPersonUpdater', () => {
  it('keeps the newer selection when an older lookup resolves last', async () => {
    const older = deferred<Record<PersonId, Ref<Person>>>()
    const newer = deferred<Record<PersonId, Ref<Person>>>()
    resolveSocialIds.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const onUpdate = jest.fn()
    const update = createFilterPersonUpdater(client, onUpdate)

    const first = update([socialOwner], socialType)
    const second = update([socialUser], socialType)
    newer.resolve({ [socialUser]: userRef })
    await second
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith([userRef])

    older.resolve({ [socialOwner]: ownerRef })
    await first
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith([userRef])
  })

  it('ignores an older lookup while a newer selection is still pending', async () => {
    const older = deferred<Record<PersonId, Ref<Person>>>()
    const newer = deferred<Record<PersonId, Ref<Person>>>()
    resolveSocialIds.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const onUpdate = jest.fn()
    const update = createFilterPersonUpdater(client, onUpdate)

    const first = update([socialOwner], socialType)
    const second = update([socialUser], socialType)
    older.resolve({ [socialOwner]: ownerRef })
    await first
    expect(onUpdate).not.toHaveBeenCalled()

    newer.resolve({ [socialUser]: userRef })
    await second
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith([userRef])
  })

  it('invalidates pending lookups when the selection is cleared', async () => {
    const pending = deferred<Record<PersonId, Ref<Person>>>()
    resolveSocialIds.mockReturnValueOnce(pending.promise)
    const onUpdate = jest.fn()
    const update = createFilterPersonUpdater(client, onUpdate)

    const first = update([socialOwner], socialType)
    await update([], socialType)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith([])
    expect(resolveSocialIds).toHaveBeenCalledTimes(1)

    pending.resolve({ [socialOwner]: ownerRef })
    await first
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith([])
  })

  it('invalidates a pending lookup when only the filter type changes', async () => {
    const pending = deferred<Record<PersonId, Ref<Person>>>()
    resolveSocialIds.mockReturnValueOnce(pending.promise)
    findAll.mockResolvedValue([{ _id: userRef, personUuid: ownerUuid }])
    const onUpdate = jest.fn()
    const update = createFilterPersonUpdater(client, onUpdate)

    const first = update([ownerUuid], socialType)
    await update([ownerUuid], accountType)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith([userRef])

    pending.resolve({ [ownerUuid]: ownerRef })
    await first
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith([userRef])
  })

  it('invalidates older results even when the latest lookup fails', async () => {
    const older = deferred<Record<PersonId, Ref<Person>>>()
    const newer = deferred<Record<PersonId, Ref<Person>>>()
    resolveSocialIds.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const onUpdate = jest.fn()
    const update = createFilterPersonUpdater(client, onUpdate)
    const error = new Error('Latest lookup failed')

    const first = update([socialOwner], socialType)
    const second = update([socialUser], socialType)
    const rejection = expect(second).rejects.toBe(error)
    newer.reject(error)
    await rejection

    older.resolve({ [socialOwner]: ownerRef })
    await first
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('updates independently when two presenters have pending lookups', async () => {
    const firstResult = deferred<Record<PersonId, Ref<Person>>>()
    const secondResult = deferred<Record<PersonId, Ref<Person>>>()
    resolveSocialIds.mockReturnValueOnce(firstResult.promise).mockReturnValueOnce(secondResult.promise)
    const firstUpdate = jest.fn()
    const secondUpdate = jest.fn()
    const updateFirst = createFilterPersonUpdater(client, firstUpdate)
    const updateSecond = createFilterPersonUpdater(client, secondUpdate)

    const first = updateFirst([socialOwner], socialType)
    const second = updateSecond([socialUser], socialType)
    secondResult.resolve({ [socialUser]: userRef })
    await second
    firstResult.resolve({ [socialOwner]: ownerRef })
    await first

    expect(firstUpdate).toHaveBeenCalledTimes(1)
    expect(firstUpdate).toHaveBeenCalledWith([ownerRef])
    expect(secondUpdate).toHaveBeenCalledTimes(1)
    expect(secondUpdate).toHaveBeenCalledWith([userRef])
  })
})
