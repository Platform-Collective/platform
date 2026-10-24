// SPDX-License-Identifier: EPL-2.0

import core, { AccountRole } from '@hcengineering/core'
import type {
  AccountUuid,
  Class,
  Hierarchy,
  Ref,
  Role,
  RolesAssignment,
  Space,
  SpaceType,
  TypedSpace,
  WorkspaceMemberInfo
} from '@hcengineering/core'

export interface SpaceAccess {
  space: Space
  type?: SpaceType
  owners: AccountUuid[]
  members: AccountUuid[]
  roles: Array<{
    role: Role
    accounts: AccountUuid[]
  }>
}

export interface PersonSpaceAccess {
  entry: SpaceAccess
  owner: boolean
  member: boolean
  roles: Role[]
}

export interface PersonAccess extends WorkspaceMemberInfo {
  guest: boolean
  spaces: PersonSpaceAccess[]
}

export interface SpaceAccessFilter {
  search?: string
  spaceClass?: Ref<Class<Space>>
  private?: boolean
  archived?: boolean
}

/** Collect direct memberships and type-specific role assignments without inferring effective access. */
export function collectSpaceAccess (
  spaces: Space[],
  types: SpaceType[],
  roles: Role[],
  hierarchy: Hierarchy,
  excludedClasses: Array<Ref<Class<Space>>>
): SpaceAccess[] {
  const typesById = new Map(types.map((type) => [type._id, type]))
  const rolesByType = new Map<Ref<SpaceType>, Role[]>()
  for (const role of roles) {
    const typeRoles = rolesByType.get(role.attachedTo) ?? []
    typeRoles.push(role)
    rolesByType.set(role.attachedTo, typeRoles)
  }

  return spaces
    .filter((space) => !excludedClasses.some((base) => hierarchy.isDerived(space._class, base)))
    .map((space): SpaceAccess => {
      const type = hierarchy.isDerived(space._class, core.class.TypedSpace)
        ? typesById.get((space as TypedSpace).type)
        : undefined
      const assignment: RolesAssignment =
        type === undefined ? {} : (hierarchy.as(space, type.targetClass) as Space & RolesAssignment)
      return {
        space,
        type,
        owners: [...new Set(space.owners ?? [])],
        members: [...new Set(space.members)],
        roles: (type === undefined ? [] : (rolesByType.get(type._id) ?? [])).map((role) => ({
          role,
          accounts: [...new Set(assignment[role._id] ?? [])]
        }))
      }
    })
    .sort((a, b) => a.space.name.localeCompare(b.space.name))
}

/** Include all workspace members; public visibility, auto-join and role assignments do not imply membership. */
export function collectPersonAccess (spaces: SpaceAccess[], members: WorkspaceMemberInfo[]): PersonAccess[] {
  const spacesByPerson = new Map<AccountUuid, PersonSpaceAccess[]>()
  for (const entry of spaces) {
    for (const person of new Set([...entry.owners, ...entry.members])) {
      const personSpaces = spacesByPerson.get(person) ?? []
      personSpaces.push({
        entry,
        owner: entry.owners.includes(person),
        member: entry.members.includes(person),
        roles: entry.roles.filter(({ accounts }) => accounts.includes(person)).map(({ role }) => role)
      })
      spacesByPerson.set(person, personSpaces)
    }
  }
  return members.map((member) => ({
    ...member,
    guest: [AccountRole.Guest, AccountRole.ReadOnlyGuest, AccountRole.DocGuest].includes(member.role),
    spaces: spacesByPerson.get(member.person) ?? []
  }))
}

/** Apply inventory filters locally so archived and private spaces remain in the Owner's source inventory. */
export function filterSpaceAccess (spaces: SpaceAccess[], filter: SpaceAccessFilter): SpaceAccess[] {
  const search = filter.search?.trim().toLocaleLowerCase() ?? ''
  return spaces.filter(
    ({ space, type }) =>
      (filter.spaceClass === undefined || space._class === filter.spaceClass) &&
      (filter.private === undefined || space.private === filter.private) &&
      (filter.archived === undefined || space.archived === filter.archived) &&
      (search === '' || `${space.name} ${type?.name ?? ''}`.toLocaleLowerCase().includes(search))
  )
}
