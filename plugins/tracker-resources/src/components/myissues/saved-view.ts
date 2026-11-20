// SPDX-License-Identifier: EPL-2.0

import contact from '@hcengineering/contact'
import type { Employee, SocialIdentityRef } from '@hcengineering/contact'
import type { AccountUuid, Client, PersonId, Ref } from '@hcengineering/core'

export interface MyIssuesScope {
  employee: Ref<Employee> | null
  socialIds: PersonId[]
  account: AccountUuid | undefined
}

/** Resolve a saved My Issues view's creator without taking a snapshot of its issues. */
export async function getSavedMyIssuesScope (client: Client, creator: PersonId): Promise<MyIssuesScope> {
  const identity = await client.findOne(contact.class.SocialIdentity, { _id: creator as SocialIdentityRef })
  if (identity === undefined) return { employee: null, socialIds: [creator], account: undefined }

  const [person, identities] = await Promise.all([
    client.findOne(contact.class.Person, { _id: identity.attachedTo }),
    client.findAll(contact.class.SocialIdentity, { attachedTo: identity.attachedTo })
  ])
  return {
    employee: person === undefined ? null : (person._id as Ref<Employee>),
    socialIds: Array.from(new Set([creator, ...identities.map((it) => it._id)])),
    account: person?.personUuid as AccountUuid | undefined
  }
}
