// SPDX-License-Identifier: EPL-2.0

import core, { AccountRole, ClassifierKind, Hierarchy, TxFactory } from '@hcengineering/core'
import type {
  AccountUuid,
  Class,
  Doc,
  Ref,
  Role,
  Space,
  SpaceType,
  SpaceTypeDescriptor,
  TypedSpace
} from '@hcengineering/core'
import { collectPersonAccess, collectSpaceAccess, filterSpaceAccess } from '../access-overview'
import type { SpaceAccess } from '../access-overview'

const alice = 'alice' as AccountUuid
const bob = 'bob' as AccountUuid
const guest = 'guest' as AccountUuid
const outsider = 'outsider' as AccountUuid
const projectClass = 'test:class:Project' as Ref<Class<TypedSpace>>
const excludedClass = 'test:class:Excluded' as Ref<Class<Space>>
const excludedChild = 'test:class:ExcludedChild' as Ref<Class<Space>>
const targetClass = 'test:mixin:Roles' as Ref<Class<Space>>
const otherTargetClass = 'test:mixin:OtherRoles' as Ref<Class<Space>>
const type: SpaceType = {
  _id: 'test:type:Project' as Ref<SpaceType>,
  _class: core.class.SpaceType,
  space: core.space.Model,
  modifiedOn: 0,
  modifiedBy: core.account.System,
  name: 'Project type',
  descriptor: 'test:descriptor:Project' as Ref<SpaceTypeDescriptor>,
  targetClass,
  roles: 1
}
const role: Role = {
  _id: 'test:role:Lead' as Ref<Role>,
  _class: core.class.Role,
  space: core.space.Model,
  modifiedOn: 0,
  modifiedBy: core.account.System,
  attachedTo: type._id,
  attachedToClass: core.class.SpaceType,
  collection: 'roles',
  name: 'Lead',
  permissions: []
}

function space (id: string, attributes: Partial<Space> = {}): Space {
  return {
    _id: id as Ref<Space>,
    _class: core.class.Space,
    space: core.space.Space,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    name: id,
    description: '',
    private: false,
    archived: false,
    members: [],
    ...attributes
  }
}

function hierarchy (): Hierarchy {
  const h = new Hierarchy()
  const factory = new TxFactory(core.account.System)
  const classes: Array<[Ref<Class<Doc>>, Ref<Class<Doc>> | undefined]> = [
    [core.class.Obj, undefined],
    [core.class.Doc, core.class.Obj],
    [core.class.Class, core.class.Doc],
    [core.class.Space, core.class.Doc],
    [core.class.TypedSpace, core.class.Space],
    [projectClass, core.class.TypedSpace],
    [excludedClass, core.class.Space],
    [excludedChild, excludedClass]
  ]
  for (const [id, parent] of classes) {
    h.tx(
      factory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        { kind: ClassifierKind.CLASS, extends: parent, label: core.string.Space },
        id
      )
    )
  }
  for (const id of [targetClass, otherTargetClass]) {
    h.tx(
      factory.createTxCreateDoc(
        core.class.Mixin,
        core.space.Model,
        { kind: ClassifierKind.MIXIN, extends: core.class.TypedSpace, label: core.string.Space },
        id
      )
    )
  }
  return h
}

function inventory (spaces: Space[], types = [type], roles = [role]): SpaceAccess[] {
  return collectSpaceAccess(spaces, types, roles, hierarchy(), [excludedClass])
}

function project (id: string, attributes: Partial<TypedSpace> = {}): TypedSpace {
  const result: TypedSpace = {
    ...space(id),
    _id: id as Ref<TypedSpace>,
    _class: projectClass,
    type: type._id,
    [targetClass]: { [role._id]: [alice, outsider, alice] },
    [otherTargetClass]: { [role._id]: [bob] },
    ...attributes
  }
  return result
}

describe('space access inventory', () => {
  it('includes typed, untyped, private and archived spaces and excludes internal classes and their descendants', () => {
    const entries = inventory([
      space('Channel'),
      space('Personal', { _class: excludedClass }),
      space('Internal child', { _class: excludedChild }),
      project('Project', { private: true, archived: true, autoJoin: true })
    ])
    expect(entries.map((e) => e.space.name)).toEqual(['Channel', 'Project'])
    expect(entries[0].type).toBeUndefined()
    expect(entries[1].type).toEqual(type)
    expect(entries[1].space).toMatchObject({ private: true, archived: true, autoJoin: true })
  })

  it('reads roles only from the matching type mixin and deduplicates accounts without mutating source data', () => {
    const input = project('Project', { members: [alice, alice, guest], owners: [bob, bob] })
    const before = JSON.stringify(input)
    const unrelatedRole = { ...role, _id: 'other-role' as Ref<Role>, attachedTo: 'other-type' as Ref<SpaceType> }
    const [entry] = inventory([input], [type], [role, unrelatedRole])
    expect(entry.members).toEqual([alice, guest])
    expect(entry.owners).toEqual([bob])
    expect(entry.roles).toEqual([{ role, accounts: [alice, outsider] }])
    expect(JSON.stringify(input)).toBe(before)
  })

  it('keeps spaces with missing types, mixins or optional owners and does not invent role assignments', () => {
    expect(inventory([project('Missing type')], [])[0].roles).toEqual([])
    const noMixin: TypedSpace = {
      ...space('No mixin'),
      _id: 'No mixin' as Ref<TypedSpace>,
      _class: projectClass,
      type: type._id
    }
    const [entry] = inventory([noMixin])
    expect(entry.owners).toEqual([])
    expect(entry.roles).toEqual([{ role, accounts: [] }])
    expect(inventory([space('Untyped')])[0].roles).toEqual([])
  })

  it('sorts by name and combines case-insensitive search with class, private and archive filters', () => {
    const entries = inventory([
      project('Zulu', { private: true, archived: true }),
      space('Alpha'),
      project('Beta', { private: true }),
      project('Gamma')
    ])
    expect(entries.map((e) => e.space.name)).toEqual(['Alpha', 'Beta', 'Gamma', 'Zulu'])
    expect(
      filterSpaceAccess(entries, {
        search: 'PROJECT TYPE',
        spaceClass: projectClass,
        private: true,
        archived: false
      }).map((e) => e.space.name)
    ).toEqual(['Beta'])
    expect(filterSpaceAccess(entries, { search: 'zUL' }).map((e) => e.space.name)).toEqual(['Zulu'])
    expect(filterSpaceAccess(entries, { private: false }).map((e) => e.space.name)).toEqual(['Alpha', 'Gamma'])
    expect(filterSpaceAccess(entries, {})).toEqual(entries)
  })
})

describe('person access inventory', () => {
  it('includes every workspace member, even without an employee record or any spaces', () => {
    const entries = collectPersonAccess(
      [],
      [
        { person: alice, role: AccountRole.Owner },
        { person: guest, role: AccountRole.Guest }
      ]
    )
    expect(entries).toEqual([
      { person: alice, role: AccountRole.Owner, guest: false, spaces: [] },
      { person: guest, role: AccountRole.Guest, guest: true, spaces: [] }
    ])
  })

  it('shows direct membership, ownership and roles without inferring effective access', () => {
    const spaces = inventory([
      project('Project', { members: [alice, guest], owners: [alice, bob] }),
      space('Public auto-join', { autoJoin: true })
    ])
    const people = collectPersonAccess(spaces, [
      { person: alice, role: AccountRole.Owner },
      { person: bob, role: AccountRole.User },
      { person: guest, role: AccountRole.Guest },
      { person: outsider, role: AccountRole.User }
    ])
    expect(people[0].spaces).toHaveLength(1)
    expect(people[0].spaces[0]).toMatchObject({ owner: true, member: true, roles: [role] })
    expect(people[1].spaces[0]).toMatchObject({ owner: true, member: false, roles: [] })
    expect(people[2].spaces[0]).toMatchObject({ owner: false, member: true, roles: [] })
    expect(people[3].spaces).toEqual([])
  })

  it.each([AccountRole.Guest, AccountRole.ReadOnlyGuest, AccountRole.DocGuest])('identifies guest role %s', (role) => {
    expect(collectPersonAccess([], [{ person: guest, role }])[0].guest).toBe(true)
  })
})
