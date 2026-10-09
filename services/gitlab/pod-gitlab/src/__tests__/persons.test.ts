// SPDX-License-Identifier: EPL-2.0
import contact from '@hcengineering/contact'
import { type PersonId, type PersonUuid, type Ref, SocialIdType } from '@hcengineering/core'
import type { Person } from '@hcengineering/contact'
import { GitlabPersonMapper, linkGitlabIdentity, personName } from '../sync/persons'
import { asTxOperations, createMemoryClient } from './helpers/memory'

const host = 'https://gitlab.example.com'
const user = (id: number, username = `user${id}`): any => ({
  id,
  username,
  name: `First${id} Last${id}`,
  avatar_url: null
})

function setup (): any {
  const memory = createMemoryClient()
  const accounts = {
    ensurePerson: jest.fn(async (_type: SocialIdType, value: string) => ({
      uuid: `uuid-${value}`,
      socialId: `sid-${value}`
    }))
  }
  const mapper = new GitlabPersonMapper(asTxOperations(memory), accounts as any)
  return { memory, accounts, mapper }
}

describe('GitlabPersonMapper', () => {
  it('creates a placeholder person and a host-scoped GitLab social id once', async () => {
    const { memory, accounts, mapper } = setup()
    const [a, b] = await Promise.all([mapper.personIdFor(host, user(7)), mapper.personIdFor(host, user(7))])
    expect(a).toBe('sid-7@gitlab.example.com')
    expect(b).toBe(a)
    expect(await mapper.personIdFor(host, user(7))).toBe(a)
    expect(accounts.ensurePerson).toHaveBeenCalledTimes(1)
    expect(accounts.ensurePerson).toHaveBeenCalledWith(SocialIdType.GITLAB, '7@gitlab.example.com', 'First7 Last7', '')
    const person = memory.docs.find((d: any) => d._class === contact.class.Person)
    expect(person).toMatchObject({ personUuid: 'uuid-7@gitlab.example.com', name: 'Last7,First7' })
    expect(memory.docs.find((d: any) => d._class === contact.class.SocialIdentity)).toMatchObject({
      _id: a,
      attachedTo: person._id,
      type: SocialIdType.GITLAB,
      value: '7@gitlab.example.com',
      displayValue: 'user7'
    })
  })

  it('reuses a workspace social id that already exists', async () => {
    const { memory, accounts, mapper } = setup()
    memory.docs.push({
      _id: 'sid-known',
      _class: contact.class.SocialIdentity,
      type: SocialIdType.GITLAB,
      value: '7@gitlab.example.com',
      attachedTo: 'person-1'
    })
    expect(await mapper.personIdFor(host, user(7))).toBe('sid-known')
    expect(accounts.ensurePerson).not.toHaveBeenCalled()
  })

  it('reuses the local person of an account that already has the GitLab id', async () => {
    const { memory, mapper } = setup()
    memory.docs.push({
      _id: 'person-alice',
      _class: contact.class.Person,
      personUuid: 'uuid-7@gitlab.example.com',
      name: 'Alice'
    })
    await mapper.personIdFor(host, user(7))
    expect(memory.docs.filter((d: any) => d._class === contact.class.Person)).toHaveLength(1)
    expect(memory.docs.find((d: any) => d._class === contact.class.SocialIdentity).attachedTo).toBe('person-alice')
  })

  it('keeps the same user id on two GitLab hosts as two people', async () => {
    const { memory, mapper } = setup()
    const a = await mapper.personIdFor('https://gitlab.com', user(7))
    const b = await mapper.personIdFor('https://git.corp.local/gitlab', user(7))
    expect(a).not.toBe(b)
    expect(memory.docs.filter((d: any) => d._class === contact.class.Person)).toHaveLength(2)
  })

  it('resolves the person of a GitLab user, and null for none', async () => {
    const { memory, mapper } = setup()
    const ref = await mapper.personRefFor(host, user(7))
    expect(ref).toBe(memory.docs.find((d: any) => d._class === contact.class.Person)._id)
    expect(await mapper.personRefFor(host, undefined)).toBeNull()
  })

  it('finds the GitLab user id of a person on the matching host only', async () => {
    const { memory, mapper } = setup()
    memory.docs.push({
      _id: 's1',
      _class: contact.class.SocialIdentity,
      type: SocialIdType.GITLAB,
      value: '5@gitlab.com',
      attachedTo: 'p1'
    })
    memory.docs.push({
      _id: 's2',
      _class: contact.class.SocialIdentity,
      type: SocialIdType.GITLAB,
      value: '9@gitlab.example.com',
      attachedTo: 'p1'
    })
    expect(await mapper.gitlabUserIdFor('p1' as Ref<Person>, host)).toBe(9)
    expect(await mapper.gitlabUserIdFor('p1' as Ref<Person>, 'https://other.example.com')).toBeUndefined()
    expect(await mapper.gitlabUserIdFor(null, host)).toBeUndefined()
  })
})

describe('personName', () => {
  it('turns a display name into Huly "Last,First"', () => {
    expect(personName('Ada Lovelace')).toBe('Lovelace,Ada')
    expect(personName('Jean Luc Picard')).toBe('Picard,Jean Luc')
    expect(personName('  cher ')).toBe('cher')
  })
})

describe('linkGitlabIdentity', () => {
  const accounts = { addSocialIdToPerson: jest.fn(async () => 'sid-x' as PersonId) }

  it("moves a placeholder's GitLab identity to the user who connected", async () => {
    const memory = createMemoryClient()
    memory.docs.push({ _id: 'person-user', _class: contact.class.Person, personUuid: 'acc-1' })
    memory.docs.push({
      _id: 'sid-x',
      _class: contact.class.SocialIdentity,
      type: SocialIdType.GITLAB,
      value: '7@gitlab.example.com',
      attachedTo: 'person-ghost'
    })
    await linkGitlabIdentity(asTxOperations(memory), accounts as any, 'acc-1' as PersonUuid, host, user(7), 123)
    expect(accounts.addSocialIdToPerson).toHaveBeenCalledWith(
      'acc-1',
      SocialIdType.GITLAB,
      '7@gitlab.example.com',
      true,
      'user7'
    )
    expect(memory.docs.find((d: any) => d._id === 'sid-x')).toMatchObject({
      attachedTo: 'person-user',
      verifiedOn: 123
    })
  })

  it('creates the identity when the workspace has none', async () => {
    const memory = createMemoryClient()
    memory.docs.push({ _id: 'person-user', _class: contact.class.Person, personUuid: 'acc-1' })
    await linkGitlabIdentity(asTxOperations(memory), accounts as any, 'acc-1' as PersonUuid, host, user(7), 123)
    expect(memory.docs.find((d: any) => d._id === 'sid-x')).toMatchObject({
      _class: contact.class.SocialIdentity,
      attachedTo: 'person-user',
      value: '7@gitlab.example.com',
      verifiedOn: 123
    })
  })
})
