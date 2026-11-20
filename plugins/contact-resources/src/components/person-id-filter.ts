// SPDX-License-Identifier: EPL-2.0

import core, { type PersonId } from '@hcengineering/core'

export interface SocialIdentityReference {
  _id: PersonId
}

export function getUnresolvedPersonIds (
  personIds: Iterable<PersonId | null | undefined>,
  socialIdentities: Iterable<SocialIdentityReference | null | undefined>,
  search: string = ''
): PersonId[] {
  const socialIdentityIds = new Set<PersonId>()
  for (const socialIdentity of socialIdentities) {
    if (socialIdentity != null) {
      socialIdentityIds.add(socialIdentity._id)
    }
  }

  const unresolvedPersonIds = new Set<PersonId>()
  const normalizedSearch = search.trim().toLocaleLowerCase()
  for (const personId of personIds) {
    if (
      personId != null &&
      !socialIdentityIds.has(personId) &&
      (normalizedSearch === '' || personId.toLocaleLowerCase().includes(normalizedSearch))
    ) {
      unresolvedPersonIds.add(personId)
    }
  }

  return Array.from(unresolvedPersonIds)
}

/**
 * Built-in system accounts have no social identity; show them as "System"
 * instead of their raw id.
 */
export function isSystemPersonId (personId: PersonId): boolean {
  return personId === core.account.System || personId === core.account.ConfigUser
}
