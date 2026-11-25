// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import { AccountRole, DOMAIN_SPACE, type AccountUuid, type Space, type WorkspaceMemberInfo } from '@hcengineering/core'
import { type MigrationClient } from '@hcengineering/model'
import webhooks, { webhooksId } from '@hcengineering/webhooks'
import { migrationInternal, webhooksOperation, WebhooksMigrationIncompleteError } from '../migration'

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

// --------------------------------------------------------------------
// webhooksOperation.migrate tests (Michael review 2026-11-25).
//
// These exercise the full `tryMigrate` + `seedWebhooksSpaceMembers`
// path with a hand-rolled MigrationClient stub. They verify that
// every incomplete-pass branch throws `WebhooksMigrationIncompleteError`
// so `tryMigrate` leaves `seedOwnerMembers-v1` unset, and that a later
// retry after the transient condition clears records the state and
// writes the Owner members. The pure-helper tests above cannot catch
// this state transition because they never touch `tryMigrate`.
// --------------------------------------------------------------------

type FindFn = (domain: string, query: any) => Promise<any[]>
type UpdateFn = (domain: string, query: any, ops: any) => Promise<void>
type CreateFn = (domain: string, doc: any) => Promise<void>
type GetMembersFn = () => Promise<WorkspaceMemberInfo[]>

interface StubClientHandles {
  client: MigrationClient
  find: jest.Mock<ReturnType<FindFn>, Parameters<FindFn>>
  update: jest.Mock<ReturnType<UpdateFn>, Parameters<UpdateFn>>
  create: jest.Mock<ReturnType<CreateFn>, Parameters<CreateFn>>
  getWorkspaceMembers: jest.Mock<ReturnType<GetMembersFn>, Parameters<GetMembersFn>>
  logMessages: Array<{ msg: string, data: any }>
}

function makeMigrationClient (overrides?: {
  findRows?: Array<Partial<Space>>
  members?: WorkspaceMemberInfo[]
  findImpl?: FindFn
  membersImpl?: GetMembersFn
  initialState?: Set<string>
}): StubClientHandles {
  const logMessages: Array<{ msg: string, data: any }> = []

  const defaultFind: FindFn = async () => (overrides?.findRows ?? []) as any[]
  const defaultMembers: GetMembersFn = async () => overrides?.members ?? []

  const find = jest.fn<ReturnType<FindFn>, Parameters<FindFn>>(overrides?.findImpl ?? defaultFind)
  const update = jest.fn<ReturnType<UpdateFn>, Parameters<UpdateFn>>(async () => {})
  const create = jest.fn<ReturnType<CreateFn>, Parameters<CreateFn>>(async () => {})
  const getWorkspaceMembers = jest.fn<ReturnType<GetMembersFn>, Parameters<GetMembersFn>>(
    overrides?.membersImpl ?? defaultMembers
  )

  const migrateState = new Map<string, Set<string>>()
  if (overrides?.initialState !== undefined) {
    migrateState.set(webhooksId, new Set(overrides.initialState))
  }

  const client: MigrationClient = {
    find,
    update,
    create,
    accountClient: { getWorkspaceMembers } as any,
    migrateState,
    logger: {
      log (msg, data) {
        logMessages.push({ msg, data })
      },
      error (msg, err) {
        logMessages.push({ msg, data: err })
      }
    },
    // The surface below is not touched by seedWebhooksSpaceMembers but
    // must exist on the typed interface. Casts keep the stub minimal.
    hierarchy: {} as any,
    model: {} as any,
    storageAdapter: {} as any,
    wsIds: {} as any,
    ctx: {} as any,
    groupBy: (async () => new Map()) as any,
    traverse: async () => ({ next: async () => null, close: async () => {} }),
    bulk: async () => {},
    move: async () => {},
    delete: async () => {},
    deleteMany: async () => {},
    domainExists: async () => true,
    fullReindex: async () => {},
    reindex: async () => {}
  }

  return { client, find, update, create, getWorkspaceMembers, logMessages }
}

function spaceRow (members: AccountUuid[] = []): Partial<Space> {
  return {
    _id: webhooks.space.Webhooks,
    members
  }
}

function member (n: number, role: AccountRole = AccountRole.Owner): WorkspaceMemberInfo {
  return { person: uuid(n), role }
}

async function readRecordedStates (client: MigrationClient): Promise<string[]> {
  // tryMigrate persists by calling client.create(DOMAIN_MIGRATION, st);
  // the stub captures that call in the `create` mock. Translate to the
  // state-names recorded during this invocation.
  const create = client.create as unknown as jest.Mock
  const states: string[] = []
  for (const callArgs of create.mock.calls) {
    const doc = callArgs[1]
    if (doc?.plugin === webhooksId && typeof doc?.state === 'string') states.push(doc.state)
  }
  return states
}

describe('webhooksOperation.migrate (fresh install)', () => {
  it('creates the dedicated space + seeds Owner members + records state on the first pass', async () => {
    // Fresh workspace: DOMAIN_SPACE starts empty. First-pass
    // migration must create the row AND seed its members AND record
    // the state in a single successful pass, so a later upgrade is a
    // no-op. Michael's Nov 25 review: the previous shape returned
    // normally when the space was missing, so `tryMigrate` recorded
    // the seed as complete even though no Owner was added.
    const h = makeMigrationClient({
      findRows: [],
      members: [member(1), member(2, AccountRole.Maintainer), member(3)]
    })

    await webhooksOperation.migrate(h.client, 'upgrade')

    // One create for the dedicated space itself, one for the
    // MigrationState record `tryMigrate` emits on success.
    const spaceCreates = h.create.mock.calls.filter(
      ([domain, doc]) => domain === DOMAIN_SPACE && doc?._id === webhooks.space.Webhooks
    )
    expect(spaceCreates).toHaveLength(1)
    const [, createdSpace] = spaceCreates[0]
    const createdSpaceDoc = createdSpace as Partial<Space>
    expect(createdSpaceDoc).toMatchObject({
      _id: webhooks.space.Webhooks,
      name: 'Webhooks',
      description: 'Dedicated private space for webhook subscriptions',
      private: true,
      archived: false,
      members: []
    })

    // Owner seed landed in the same pass on the newly-created row.
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update.mock.calls[0][0]).toBe(DOMAIN_SPACE)
    expect(h.update.mock.calls[0][1]).toEqual({ _id: webhooks.space.Webhooks })
    expect(h.update.mock.calls[0][2].members.sort()).toEqual([uuid(1), uuid(3)].sort())

    expect(await readRecordedStates(h.client)).toEqual(['seedOwnerMembers-v1'])
  })

  it('is idempotent across two passes on the same migrateState map', async () => {
    // Simulate two consecutive calls to the operation with the same
    // in-memory migrateState (as would happen if the caller did not
    // reload DOMAIN_MIGRATION between passes). Pass 1 creates + seeds
    // + records state; pass 2 sees the DOMAIN_SPACE row already
    // exists and re-seeds without re-creating. No duplicate rows.
    //
    // The stateful find/create stub mirrors a real DB: once the space
    // is created, subsequent finds return it.
    let spaceRowStored: Array<Partial<Space>> = []
    const h = makeMigrationClient({
      findImpl: async () => spaceRowStored,
      members: [member(1)]
    })
    h.create.mockImplementation(async (domain, doc) => {
      if (domain === DOMAIN_SPACE && doc?._id === webhooks.space.Webhooks) {
        spaceRowStored = [doc as Partial<Space>]
      }
    })

    await webhooksOperation.migrate(h.client, 'upgrade')
    const spaceCreatesPass1 = h.create.mock.calls.filter(
      ([domain, doc]) => domain === DOMAIN_SPACE && doc?._id === webhooks.space.Webhooks
    )
    expect(spaceCreatesPass1).toHaveLength(1)
    expect(h.update).toHaveBeenCalledTimes(1)
    const pass1States = await readRecordedStates(h.client)
    expect(pass1States).toEqual(['seedOwnerMembers-v1'])

    // Simulate persistence of the migrationState between runs the way
    // the caller would after a successful pass: load the recorded
    // state into migrateState for the next upgrade. `tryMigrate` then
    // short-circuits without running the migration function at all,
    // so no further create/update calls fire.
    h.client.migrateState.set(webhooksId, new Set(['seedOwnerMembers-v1']))

    await webhooksOperation.migrate(h.client, 'upgrade')
    const spaceCreatesPass2 = h.create.mock.calls.filter(
      ([domain, doc]) => domain === DOMAIN_SPACE && doc?._id === webhooks.space.Webhooks
    )
    expect(spaceCreatesPass2).toHaveLength(1) // unchanged from pass 1
    expect(h.update).toHaveBeenCalledTimes(1) // unchanged from pass 1
  })
})

describe('webhooksOperation.migrate (retriable failure cases)', () => {
  it('throws for a transient account-service failure and does NOT record state', async () => {
    const h = makeMigrationClient({
      findRows: [spaceRow([])],
      membersImpl: async () => {
        throw new Error('ECONNREFUSED accounts.svc:3000')
      }
    })

    await webhooksOperation.migrate(h.client, 'upgrade')

    expect(h.update).not.toHaveBeenCalled()
    expect(await readRecordedStates(h.client)).toEqual([])
  })

  it('throws for a duplicate dedicated-space row and does NOT record state', async () => {
    const h = makeMigrationClient({
      findRows: [spaceRow([]), spaceRow([])]
    })

    await webhooksOperation.migrate(h.client, 'upgrade')

    expect(h.update).not.toHaveBeenCalled()
    expect(await readRecordedStates(h.client)).toEqual([])
  })

  it('retries a transient account-service failure on the next pass; space create is idempotent across both passes', async () => {
    // Fresh workspace. Pass 1 creates the dedicated space row, then
    // the account service fails before the Owner seed completes;
    // tryMigrate catches the throw so `seedOwnerMembers-v1` stays
    // unset. Pass 2 sees the row from pass 1 (idempotent create does
    // NOT fire again), retrieves Owners successfully, and seeds +
    // records state. Michael's exact concern: verify the full
    // round-trip with no duplicate space rows.
    let spaceRowStored: Array<Partial<Space>> = []
    let attempt = 0
    const h = makeMigrationClient({
      findImpl: async () => spaceRowStored,
      membersImpl: async () => {
        attempt++
        if (attempt === 1) throw new Error('ECONNREFUSED accounts.svc:3000')
        return [member(1), member(2, AccountRole.Maintainer)]
      }
    })
    h.create.mockImplementation(async (domain, doc) => {
      if (domain === DOMAIN_SPACE && doc?._id === webhooks.space.Webhooks) {
        spaceRowStored = [doc as Partial<Space>]
      }
    })

    await webhooksOperation.migrate(h.client, 'upgrade')
    // Pass 1: space was created, then account service failed.
    const pass1SpaceCreates = h.create.mock.calls.filter(
      ([domain, doc]) => domain === DOMAIN_SPACE && doc?._id === webhooks.space.Webhooks
    )
    expect(pass1SpaceCreates).toHaveLength(1)
    expect(h.update).not.toHaveBeenCalled()
    expect(await readRecordedStates(h.client)).toEqual([])

    // Second upgrade pass on the SAME stub. Account service recovers.
    await webhooksOperation.migrate(h.client, 'upgrade')
    const pass2SpaceCreates = h.create.mock.calls.filter(
      ([domain, doc]) => domain === DOMAIN_SPACE && doc?._id === webhooks.space.Webhooks
    )
    expect(pass2SpaceCreates).toHaveLength(1) // no second create; idempotent
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update.mock.calls[0][0]).toBe(DOMAIN_SPACE)
    expect(h.update.mock.calls[0][2]).toEqual({ members: [uuid(1)] })
    expect(await readRecordedStates(h.client)).toEqual(['seedOwnerMembers-v1'])
  })

  it('retries a duplicate dedicated-space row on the next pass and records state once resolved', async () => {
    let rows: Array<Partial<Space>> = [spaceRow([]), spaceRow([])]
    const h = makeMigrationClient({
      findImpl: async () => rows,
      members: [member(1)]
    })

    await webhooksOperation.migrate(h.client, 'upgrade')
    expect(await readRecordedStates(h.client)).toEqual([])

    rows = [spaceRow([])]
    await webhooksOperation.migrate(h.client, 'upgrade')
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(await readRecordedStates(h.client)).toEqual(['seedOwnerMembers-v1'])
  })

  it('records state when a successful no-op pass finds every Owner already present', async () => {
    const h = makeMigrationClient({
      findRows: [spaceRow([uuid(1)])],
      members: [member(1)]
    })

    await webhooksOperation.migrate(h.client, 'upgrade')

    // No update call (nothing to add) but state recorded so future
    // upgrades skip the no-op work.
    expect(h.update).not.toHaveBeenCalled()
    expect(await readRecordedStates(h.client)).toEqual(['seedOwnerMembers-v1'])
  })
})

describe('WebhooksMigrationIncompleteError', () => {
  it('carries a structured reason field for each incomplete-pass branch', () => {
    const svc = new WebhooksMigrationIncompleteError('account-service-failed', 'x')
    const dup = new WebhooksMigrationIncompleteError('dedicated-space-collides', 'x')

    expect(svc.reason).toBe('account-service-failed')
    expect(dup.reason).toBe('dedicated-space-collides')
    expect(svc.name).toBe('WebhooksMigrationIncompleteError')
  })

  it('preserves the upstream cause when provided', () => {
    const cause = new Error('ECONNREFUSED accounts.svc:3000')
    const err = new WebhooksMigrationIncompleteError('account-service-failed', 'wrapped', { cause })
    expect((err as any).cause).toBe(cause)
  })
})
