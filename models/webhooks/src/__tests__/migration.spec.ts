// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import { AccountRole, type AccountUuid, type WorkspaceMemberInfo } from '@hcengineering/core'
import { migrationInternal } from '../migration'

const { sanitizeMembers, toOwnerSet, unionMembers } = migrationInternal

function uuid (n: number): AccountUuid {
  return `uuid-${n}` as AccountUuid
}

describe('sanitizeMembers', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeMembers(undefined)).toEqual([])
    expect(sanitizeMembers(null)).toEqual([])
    expect(sanitizeMembers('abc')).toEqual([])
    expect(sanitizeMembers(42)).toEqual([])
    expect(sanitizeMembers({})).toEqual([])
  })

  it('drops non-string, empty, and duplicate entries', () => {
    const raw = ['a', '', 'b', 'a', null, undefined, 42, {}, 'c'] as unknown
    expect(sanitizeMembers(raw)).toEqual(['a', 'b', 'c'] as AccountUuid[])
  })
})

describe('toOwnerSet', () => {
  it('returns Owners only', () => {
    const rows: WorkspaceMemberInfo[] = [
      { person: uuid(1), role: AccountRole.Owner },
      { person: uuid(2), role: AccountRole.Maintainer },
      { person: uuid(3), role: AccountRole.Owner },
      { person: uuid(4), role: AccountRole.User },
      { person: uuid(5), role: AccountRole.Guest }
    ]
    const owners = toOwnerSet(rows)
    expect([...owners].sort()).toEqual([uuid(1), uuid(3)].sort())
  })

  it('skips malformed rows without throwing', () => {
    const rows = [
      { person: uuid(1), role: AccountRole.Owner },
      null,
      undefined,
      { role: AccountRole.Owner },
      { person: '', role: AccountRole.Owner },
      { person: uuid(9), role: AccountRole.Owner }
    ] as unknown as WorkspaceMemberInfo[]
    const owners = toOwnerSet(rows)
    expect([...owners].sort()).toEqual([uuid(1), uuid(9)].sort())
  })

  it('returns an empty set when there are no Owners', () => {
    const rows: WorkspaceMemberInfo[] = [
      { person: uuid(1), role: AccountRole.User },
      { person: uuid(2), role: AccountRole.Maintainer }
    ]
    expect(toOwnerSet(rows).size).toBe(0)
  })
})

describe('unionMembers', () => {
  it('appends new owners while preserving existing order', () => {
    const current: AccountUuid[] = [uuid(10), uuid(11)]
    const owners = new Set<AccountUuid>([uuid(1), uuid(2)])
    const { result, added } = unionMembers(current, owners)
    expect(result).toEqual([uuid(10), uuid(11), uuid(1), uuid(2)])
    expect(added.sort()).toEqual([uuid(1), uuid(2)].sort())
  })

  it('reports no additions when every owner already present', () => {
    const current: AccountUuid[] = [uuid(1), uuid(2), uuid(3)]
    const owners = new Set<AccountUuid>([uuid(1), uuid(2)])
    const { result, added } = unionMembers(current, owners)
    expect(result).toEqual([uuid(1), uuid(2), uuid(3)])
    expect(added).toEqual([])
  })

  it('de-duplicates within the current list', () => {
    const current: AccountUuid[] = [uuid(1), uuid(1), uuid(2)]
    const owners = new Set<AccountUuid>()
    const { result, added } = unionMembers(current, owners)
    expect(result).toEqual([uuid(1), uuid(2)])
    expect(added).toEqual([])
  })

  it('preserves non-Owner members (service account, etc.)', () => {
    // The service account that will one day live in the members list
    // is not reported by `getWorkspaceMembers` (it is not a workspace
    // member in the account service sense). The migration must NOT
    // clobber it.
    const serviceAcct = uuid(99)
    const current: AccountUuid[] = [serviceAcct]
    const owners = new Set<AccountUuid>([uuid(1)])
    const { result, added } = unionMembers(current, owners)
    expect(result).toEqual([serviceAcct, uuid(1)])
    expect(added).toEqual([uuid(1)])
  })

  it('is idempotent across repeated applications', () => {
    const current: AccountUuid[] = [uuid(1)]
    const owners = new Set<AccountUuid>([uuid(1), uuid(2)])
    const first = unionMembers(current, owners)
    const second = unionMembers(first.result, owners)
    expect(second.result).toEqual(first.result)
    expect(second.added).toEqual([])
  })

  it('handles empty inputs on both sides', () => {
    const { result, added } = unionMembers([], new Set<AccountUuid>())
    expect(result).toEqual([])
    expect(added).toEqual([])
  })

  it('ignores duplicate entries inside the owners set projection', () => {
    // A real Set never duplicates, but the pure function is tested
    // against arbitrary iterables elsewhere; this pins the invariant.
    const current: AccountUuid[] = []
    const owners = new Set<AccountUuid>([uuid(1), uuid(1), uuid(2)])
    const { result, added } = unionMembers(current, owners)
    expect(result.sort()).toEqual([uuid(1), uuid(2)].sort())
    expect(added.sort()).toEqual([uuid(1), uuid(2)].sort())
  })
})
