// SPDX-License-Identifier: EPL-2.0

import core, { type PersonId } from '@hcengineering/core'
import { getUnresolvedPersonIds, isSystemPersonId } from './person-id-filter'

describe('getUnresolvedPersonIds', () => {
  it('keeps distinct ids for contacts created by different system identities', () => {
    const systemPersonId = 'system' as PersonId
    const automationPersonId = 'automation' as PersonId
    const socialIdentityId = 'social-identity' as PersonId

    expect(
      getUnresolvedPersonIds(
        [systemPersonId, automationPersonId, systemPersonId, socialIdentityId, undefined],
        [{ _id: socialIdentityId }]
      )
    ).toEqual([systemPersonId, automationPersonId])
  })

  it('filters unresolved ids using the active name search', () => {
    const systemPersonId = 'core:account:System' as PersonId
    const automationPersonId = 'automation' as PersonId

    expect(getUnresolvedPersonIds([systemPersonId, automationPersonId], [], 'system')).toEqual([systemPersonId])
  })
})

describe('isSystemPersonId', () => {
  it('treats the system and configuration accounts as system identities', () => {
    expect(isSystemPersonId(core.account.System)).toBe(true)
    expect(isSystemPersonId(core.account.ConfigUser)).toBe(true)
    expect(isSystemPersonId('social-identity' as PersonId)).toBe(false)
  })
})
