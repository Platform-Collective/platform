// SPDX-License-Identifier: EPL-2.0

import card from '@hcengineering/card'
import contact, { AvatarType, type Contact, type Member, type Person, type UserProfile } from '@hcengineering/contact'
import core, {
  TxFactory,
  TxProcessor,
  type Class,
  type Doc,
  type DocumentQuery,
  type MarkupBlobRef,
  type Ref,
  type Space,
  type TxRemoveDoc
} from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'

import { OnContactDelete } from '../index'

const txFactory = new TxFactory(core.account.System)

function createPerson (): Person {
  return TxProcessor.createDoc2Doc(
    txFactory.createTxCreateDoc(contact.class.Person, contact.space.Contacts, {
      name: 'Appleseed,John',
      avatarType: AvatarType.COLOR
    })
  )
}

function createProfile (person: Person): UserProfile {
  return TxProcessor.createDoc2Doc(
    txFactory.createTxCreateDoc<UserProfile>(contact.class.UserProfile, card.space.Default, {
      person: person._id,
      title: 'John Appleseed',
      rank: 'a0',
      content: '' as MarkupBlobRef,
      parentInfo: [],
      blobs: {}
    })
  )
}

function createControl (removed: Contact[], profiles: UserProfile[] = [], members: Member[] = []): TriggerControl {
  const findAll = jest.fn(async (_ctx: unknown, _class: Ref<Class<Doc>>, query: DocumentQuery<Doc>) => {
    if (_class === contact.class.UserProfile) {
      return profiles.filter((profile) => profile.person === query.person)
    }
    if (_class === contact.class.Member) {
      return members.filter((member) => member.contact === query.contact)
    }
    throw new Error(`Unexpected query for ${_class}`)
  })

  return {
    ctx: {},
    txFactory,
    removedMap: new Map(removed.map((doc) => [doc._id, doc])),
    hierarchy: {
      isDerived: (actual: Ref<Class<Doc>>, base: Ref<Class<Doc>>) =>
        base === contact.class.Person && actual !== contact.class.Organization
    },
    findAll
  } as unknown as TriggerControl
}

describe('OnContactDelete', () => {
  it('removes the person profile using its stored class and space', async () => {
    const person = createPerson()
    const profile = createProfile(person)
    profile.space = 'moved-profile-space' as Ref<Space>
    person.profile = profile._id
    const control = createControl([person], [profile])

    const result = await OnContactDelete(
      [txFactory.createTxRemoveDoc(person._class, person.space, person._id)],
      control
    )

    expect(result).toEqual([
      expect.objectContaining({
        _class: core.class.TxRemoveDoc,
        objectClass: profile._class,
        objectSpace: profile.space,
        objectId: profile._id
      })
    ])
  })

  it('finds all profiles by person even when the profile reference is missing', async () => {
    const person = createPerson()
    const profiles = [createProfile(person), createProfile(person)]
    const unrelatedProfile = createProfile(createPerson())
    const control = createControl([person], [...profiles, unrelatedProfile])

    const result = await OnContactDelete(
      [txFactory.createTxRemoveDoc(person._class, person.space, person._id)],
      control
    )

    expect(result.map((tx) => (tx as TxRemoveDoc<Doc>).objectId)).toEqual(profiles.map((profile) => profile._id))
  })

  it('handles multiple persons including derived classes in one batch', async () => {
    const persons = [createPerson(), createPerson()]
    persons[1]._class = 'contact:class:CustomPerson' as Ref<Class<Person>>
    const profiles = persons.map(createProfile)
    const control = createControl(persons, profiles)

    const result = await OnContactDelete(
      persons.map((person) => txFactory.createTxRemoveDoc(person._class, person.space, person._id)),
      control
    )

    expect(result.map((tx) => (tx as TxRemoveDoc<Doc>).objectId)).toEqual(profiles.map((profile) => profile._id))
  })

  it('keeps membership cleanup for organizations without querying profiles', async () => {
    const organization = TxProcessor.createDoc2Doc(
      txFactory.createTxCreateDoc(contact.class.Organization, contact.space.Contacts, {
        name: 'Organization',
        avatarType: AvatarType.COLOR,
        members: 1,
        description: null
      })
    )
    const member = TxProcessor.createDoc2Doc(
      txFactory.createTxCreateDoc<Member>(contact.class.Member, contact.space.Contacts, {
        contact: organization._id,
        attachedTo: 'organization-members' as Ref<Doc>,
        attachedToClass: contact.class.Organization,
        collection: 'members'
      })
    )
    const control = createControl([organization], [], [member])

    const result = await OnContactDelete(
      [txFactory.createTxRemoveDoc(organization._class, organization.space, organization._id)],
      control
    )

    expect(result).toEqual([
      expect.objectContaining({
        _class: core.class.TxRemoveDoc,
        objectId: member._id,
        attachedTo: member.attachedTo,
        attachedToClass: member.attachedToClass,
        collection: member.collection,
        objectClass: member._class
      })
    ])
    expect(control.findAll).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the person has no profile', async () => {
    const person = createPerson()
    const control = createControl([person])

    await expect(
      OnContactDelete([txFactory.createTxRemoveDoc(person._class, person.space, person._id)], control)
    ).resolves.toEqual([])
  })

  it('skips contacts missing from the removed map', async () => {
    const person = createPerson()
    const control = createControl([], [createProfile(person)])

    await expect(
      OnContactDelete([txFactory.createTxRemoveDoc(person._class, person.space, person._id)], control)
    ).resolves.toEqual([])
    expect(control.findAll).not.toHaveBeenCalled()
  })
})
