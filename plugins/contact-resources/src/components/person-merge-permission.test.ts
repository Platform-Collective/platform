// SPDX-License-Identifier: EPL-2.0

import type { PersonUuid } from '@hcengineering/core'
import { isPersonMergePermissionCached, canMergePersonTypes } from './person-merge-permission'

describe('isPersonMergePermissionCached', () => {
  const primaryUuid = 'primary' as PersonUuid
  const secondaryUuid = 'secondary' as PersonUuid

  it('does not skip the initial permission check for two fresh talents', () => {
    expect(isPersonMergePermissionCached(undefined, undefined, undefined, undefined)).toBe(false)
  })

  it.each([
    [primaryUuid, undefined],
    [undefined, secondaryUuid],
    [undefined, undefined]
  ])('does not skip the local fallback for a repeated pair (%s, %s)', (primary, secondary) => {
    expect(isPersonMergePermissionCached(primary, secondary, primary, secondary)).toBe(false)
  })

  it('reuses the permission check for the same global persons', () => {
    expect(isPersonMergePermissionCached(primaryUuid, secondaryUuid, primaryUuid, secondaryUuid)).toBe(true)
  })

  it('checks permissions when either global person changes', () => {
    expect(isPersonMergePermissionCached(primaryUuid, secondaryUuid, undefined, undefined)).toBe(false)
    expect(isPersonMergePermissionCached(primaryUuid, secondaryUuid, secondaryUuid, secondaryUuid)).toBe(false)
    expect(isPersonMergePermissionCached(primaryUuid, secondaryUuid, primaryUuid, primaryUuid)).toBe(false)
    expect(isPersonMergePermissionCached(secondaryUuid, primaryUuid, primaryUuid, secondaryUuid)).toBe(false)
  })
})

describe('canMergePersonTypes', () => {
  it.each([
    [false, false],
    [false, true],
    [true, true]
  ])('allows source employee %s into target employee %s', (source, target) => {
    expect(canMergePersonTypes(source, target)).toBe(true)
  })
  it('blocks an employee into a local person before moving identities or references', () => {
    expect(canMergePersonTypes(true, false)).toBe(false)
  })
})
