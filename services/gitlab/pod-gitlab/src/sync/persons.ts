// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import contact, { AvatarType, type Person, type SocialIdentityRef } from '@hcengineering/contact'
import { buildSocialIdString, type PersonId, type PersonUuid, type Ref, SocialIdType, type TxOperations } from '@hcengineering/core'
import type { GitlabUserRef } from '../gitlab/types'
import { gitlabSocialValue, hostKey, parseGitlabSocialValue } from './keys'

export interface PersonMapping {
  // Social id of the GitLab user, creating a placeholder person on first sight
  personIdFor: (host: string, user: GitlabUserRef) => Promise<PersonId>
  personRefFor: (host: string, user: GitlabUserRef | undefined) => Promise<Ref<Person> | null>
  // GitLab user id of a Huly person on `host`; undefined when the person has no GitLab identity there
  gitlabUserIdFor: (person: Ref<Person> | null, host: string) => Promise<number | undefined>
}

/** Huly person name ("Last,First") from a GitLab display name. */
export function personName (name: string): string {
  const parts = name.trim().split(/\s+/).filter((it) => it !== '')
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts[parts.length - 1]},${parts.slice(0, -1).join(' ')}`
}

function displayName (user: GitlabUserRef): string {
  return user.name.trim() !== '' ? user.name : user.username
}

export class GitlabPersonMapper implements PersonMapping {
  // Keyed by social id value; concurrent lookups of one user share a single resolution
  private readonly cache = new Map<string, Promise<PersonId>>()

  constructor (
    private readonly client: TxOperations,
    private readonly accounts: Pick<AccountClient, 'ensurePerson'>
  ) {}

  async personIdFor (host: string, user: GitlabUserRef): Promise<PersonId> {
    const value = gitlabSocialValue(host, user.id)
    let pending = this.cache.get(value)
    if (pending === undefined) {
      pending = this.resolve(value, user)
      this.cache.set(value, pending)
      pending.catch(() => this.cache.delete(value))
    }
    return await pending
  }

  async personRefFor (host: string, user: GitlabUserRef | undefined): Promise<Ref<Person> | null> {
    if (user === undefined) return null
    const id = await this.personIdFor(host, user)
    const identity = await this.client.findOne(contact.class.SocialIdentity, { _id: id as SocialIdentityRef })
    return identity?.attachedTo ?? null
  }

  async gitlabUserIdFor (person: Ref<Person> | null, host: string): Promise<number | undefined> {
    if (person === null) return undefined
    const key = hostKey(host)
    const identities = await this.client.findAll(contact.class.SocialIdentity, { attachedTo: person, type: SocialIdType.GITLAB })
    for (const identity of identities) {
      const parsed = parseGitlabSocialValue(identity.value)
      if (parsed?.host === key) return parsed.userId
    }
    return undefined
  }

  private async resolve (value: string, user: GitlabUserRef): Promise<PersonId> {
    const local = await this.client.findOne(contact.class.SocialIdentity, { type: SocialIdType.GITLAB, value })
    if (local !== undefined) return local._id
    const { uuid, socialId } = await this.accounts.ensurePerson(SocialIdType.GITLAB, value, displayName(user), '')
    const existing = await this.client.findOne(contact.class.Person, { personUuid: uuid })
    const person = existing?._id ?? (await this.createPerson(uuid, user))
    await this.client.addCollection(
      contact.class.SocialIdentity,
      contact.space.Contacts,
      person,
      contact.class.Person,
      'socialIds',
      { type: SocialIdType.GITLAB, value, key: buildSocialIdString({ type: SocialIdType.GITLAB, value }), displayValue: user.username },
      socialId as SocialIdentityRef
    )
    return socialId
  }

  private async createPerson (uuid: PersonUuid, user: GitlabUserRef): Promise<Ref<Person>> {
    return await this.client.createDoc(contact.class.Person, contact.space.Contacts, {
      name: personName(displayName(user)),
      avatarType: AvatarType.EXTERNAL,
      avatarProps: { url: user.avatar_url ?? '' },
      city: '',
      comments: 0,
      channels: 0,
      attachments: 0,
      personUuid: uuid
    })
  }
}

/**
 * Attaches the GitLab identity of a user who connected GitLab to their own Huly person, so GitLab issues and notes
 * they author map to them instead of a placeholder. `confirmed` also merges an account-level placeholder person
 * created earlier by the sync; earlier assignments to the workspace placeholder are left for Huly's person merge.
 */
export async function linkGitlabIdentity (
  client: TxOperations,
  accounts: Pick<AccountClient, 'addSocialIdToPerson'>,
  personUuid: PersonUuid,
  host: string,
  user: GitlabUserRef,
  now: number
): Promise<void> {
  const value = gitlabSocialValue(host, user.id)
  const socialId = await accounts.addSocialIdToPerson(personUuid, SocialIdType.GITLAB, value, true, user.username)
  const person = await client.findOne(contact.class.Person, { personUuid })
  if (person === undefined) return
  const local = await client.findOne(contact.class.SocialIdentity, { _id: socialId as SocialIdentityRef })
  if (local === undefined) {
    await client.addCollection(
      contact.class.SocialIdentity,
      contact.space.Contacts,
      person._id,
      contact.class.Person,
      'socialIds',
      {
        type: SocialIdType.GITLAB,
        value,
        key: buildSocialIdString({ type: SocialIdType.GITLAB, value }),
        displayValue: user.username,
        verifiedOn: now
      },
      socialId as SocialIdentityRef
    )
  } else if (local.attachedTo !== person._id) {
    await client.update(local, { attachedTo: person._id, verifiedOn: now })
  }
}
