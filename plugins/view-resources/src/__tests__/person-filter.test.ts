// SPDX-License-Identifier: EPL-2.0

import core, { type AccountUuid, type AnyAttribute, type Client, type PersonId, type Ref } from '@hcengineering/core'
import contact, { type Person, type SocialIdentityRef } from '@hcengineering/contact'
import { getFilterPersonRefs } from '../components/filter/person-filter'

jest.mock('@hcengineering/core', () => ({
  __esModule: true,
  default: { class: { ArrOf: 'core:class:ArrOf', TypeAccountUuid: 'core:class:TypeAccountUuid' } }
}))

jest.mock('@hcengineering/contact', () => ({
  __esModule: true,
  default: { class: { Person: 'contact:class:Person', SocialIdentity: 'contact:class:SocialIdentity' } },
  getPersonRefsBySocialIds: async (client: Client, ids: PersonId[]) => {
    const identities = await client.findAll(contact.class.SocialIdentity, { _id: { $in: ids as SocialIdentityRef[] } })
    return Object.fromEntries(identities.map((identity) => [identity._id, identity.attachedTo]))
  }
}))

const ownerUuid = 'aBcDeFaa-1111-4111-8111-111111111111' as AccountUuid
const userUuid = 'bCdEfAbb-2222-4222-8222-222222222222' as AccountUuid
const ownerRef = 'owner' as Ref<Person>
const userRef = 'user' as Ref<Person>
const accountType = { _class: core.class.TypeAccountUuid } as unknown as AnyAttribute['type']
const membersType = { ...accountType, _class: core.class.ArrOf, of: accountType } as unknown as AnyAttribute['type']
const socialType = { _class: 'core:class:TypePersonId' } as unknown as AnyAttribute['type']

describe('getFilterPersonRefs', () => {
  const findAll = jest.fn()
  const client = { findAll } as unknown as Client

  beforeEach(() => {
    findAll.mockReset()
  })

  it('resolves Members tuples by the stored account UUIDs', async () => {
    findAll.mockResolvedValue([{ _id: ownerRef }, { _id: userRef }])
    const selected = [
      [ownerUuid.toUpperCase(), [ownerUuid]],
      [userUuid.toUpperCase(), [userUuid]]
    ]

    expect(await getFilterPersonRefs(client, selected, membersType)).toEqual([ownerRef, userRef])
    expect(findAll).toHaveBeenCalledWith(
      contact.class.Person,
      { personUuid: { $in: [ownerUuid, userUuid] } },
      { projection: { _id: 1 } }
    )
  })

  it('resolves a scalar account ValueFilter tuple', async () => {
    findAll.mockResolvedValue([{ _id: ownerRef }])

    expect(await getFilterPersonRefs(client, [[ownerUuid.toUpperCase(), [ownerUuid]]], accountType)).toEqual([ownerRef])
    expect(findAll.mock.calls[0][1]).toEqual({ personUuid: { $in: [ownerUuid] } })
  })

  it('resolves every stored value in a group', async () => {
    const otherCase = ownerUuid.toUpperCase() as AccountUuid
    findAll.mockResolvedValue([{ _id: ownerRef }])

    expect(await getFilterPersonRefs(client, [[otherCase, [ownerUuid, otherCase]]], membersType)).toEqual([ownerRef])
    expect(findAll.mock.calls[0][1]).toEqual({ personUuid: { $in: [ownerUuid, otherCase] } })
  })

  it('preserves flat social identity filters', async () => {
    const socialIds = ['social-owner', 'social-owner-other'] as PersonId[]
    findAll.mockResolvedValue(socialIds.map((_id) => ({ _id, attachedTo: ownerRef })))

    expect(await getFilterPersonRefs(client, socialIds, socialType)).toEqual([ownerRef, ownerRef])
    expect(findAll).toHaveBeenCalledWith(contact.class.SocialIdentity, { _id: { $in: socialIds } })
  })

  it('unwraps grouped social identity values without treating them as account UUIDs', async () => {
    const socialId = 'social-owner' as PersonId
    findAll.mockResolvedValue([{ _id: socialId, attachedTo: ownerRef }])
    const arrayType = { ...socialType, _class: core.class.ArrOf, of: socialType } as unknown as AnyAttribute['type']

    expect(await getFilterPersonRefs(client, [[socialId.toUpperCase(), [socialId]]], arrayType)).toEqual([ownerRef])
    expect(findAll).toHaveBeenCalledWith(contact.class.SocialIdentity, { _id: { $in: [socialId] } })
  })

  it.each([
    { values: [], type: membersType },
    { values: [[undefined, []]], type: membersType },
    { values: [undefined, null], type: membersType },
    { values: [], type: socialType },
    { values: [undefined, null], type: socialType }
  ])('does not query for empty selections: $values', async ({ values, type }) => {
    expect(await getFilterPersonRefs(client, values, type)).toEqual([])
    expect(findAll).not.toHaveBeenCalled()
  })
})
