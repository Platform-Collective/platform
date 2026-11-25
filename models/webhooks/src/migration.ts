// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import core, {
  AccountRole,
  DOMAIN_SPACE,
  type AccountUuid,
  type Ref,
  type Space,
  type WorkspaceMemberInfo
} from '@hcengineering/core'
import {
  tryMigrate,
  type MigrateMode,
  type MigrateOperation,
  type MigrationClient,
  type MigrationUpgradeClient
} from '@hcengineering/model'
import webhooks, { webhooksId } from '@hcengineering/webhooks'

/**
 * Thrown by the webhooks migration when a pass cannot complete. The
 * class is distinct so operators can grep for it in logs, and so
 * tests can assert the branch that tripped. Every subclass throws
 * BEFORE any `client.update` call, so partial writes are impossible.
 *
 * `tryMigrate` catches any throw from a migration function and
 * `continue`s past the state-record `create()` at the end of its
 * loop body (`foundations/core/packages/model/src/migration.ts:187-207`).
 * Thrown-from paths therefore leave `seedOwnerMembers-v1` unset, and
 * the next upgrade retries. Addresses MichaelUray's Nov 25 review.
 */
/** @public */
export class WebhooksMigrationIncompleteError extends Error {
  readonly reason: 'account-service-failed' | 'dedicated-space-collides'

  constructor (
    reason: 'account-service-failed' | 'dedicated-space-collides',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'WebhooksMigrationIncompleteError'
    this.reason = reason
  }
}

/**
 * Seed `webhooks.space.Webhooks.members` with the current set of
 * workspace Owners.
 *
 * Addresses MichaelUray's Nov 3 review follow-up on #255: the
 * dedicated private webhooks space ships with `members: []`, which
 * means no Owner can read the Settings surface or any webhook doc
 * until seeded. Michael asked for both (a) a trigger that keeps this
 * list in sync on role changes and (b) an upgrade migration that
 * seeds it for existing workspaces.
 *
 * This file is the (b) half. The (a) half is handled by the self-heal
 * path in `server-plugins/webhooks` (`WebhookPermissionsMiddleware`)
 * because `Account` is a UUID identity owned by the accounts service,
 * NOT a workspace Doc with a Tx stream to trigger on (see
 * `foundations/core/packages/core/src/classes.ts:73-79`). Promoting
 * or demoting an account does not emit any in-workspace Tx, so no
 * server-plugin trigger can observe the change.
 *
 * Membership flow end-to-end:
 *
 *  1. Migration (this file): create the dedicated space row in
 *     DOMAIN_SPACE idempotently on first install, then seed its
 *     `members` with the current workspace Owners. Re-runs are a
 *     no-op: an existing row is read back unchanged and the Owner
 *     union is skipped when every Owner is already present.
 *  2. Self-heal (server-plugin): the first authenticated Owner Tx
 *     that reaches `WebhookPermissionsMiddleware.tx` adds the caller
 *     if they are not already a member. Covers the "promote to Owner
 *     after migration ran" case.
 *  3. Management RPC (future PR): on first subscription create,
 *     adds the caller to members as a side effect (per DESIGN.md
 *     rev 8, "Members = current workspace Owners + the webhooks
 *     service").
 *  4. Background reconciliation (future delivery service PR): a
 *     periodic sweep inside pod-webhooks removes AccountUuids whose
 *     role is no longer Owner, so a demoted Owner stops receiving
 *     the space's broadcast. Not shipped in this PR.
 *
 * Idempotency and retry: re-running this migration is a no-op. The
 * migration state key is per-workspace, the dedicated-space create
 * is skipped when a row already exists, and the member write is
 * skipped when the seeded set is already a subset of the current
 * `members` list. The migration preserves any existing non-Owner
 * members (e.g. the service account) because it unions rather than
 * replaces. Any branch that cannot complete the seed throws
 * `WebhooksMigrationIncompleteError` so `tryMigrate` leaves the
 * state key unset and the next upgrade retries.
 */
async function seedWebhooksSpaceMembers (client: MigrationClient): Promise<void> {
  // Create the dedicated space row in DOMAIN_SPACE if it does not
  // exist yet, then seed its members in the same pass. The model
  // builder at `models/webhooks/src/index.ts` writes the space to
  // `core.space.Model` (DOMAIN_MODEL_TX), which is NOT where runtime
  // Space rows live; on a fresh workspace, DOMAIN_SPACE has no entry
  // for `webhooks.space.Webhooks` until this migration creates it
  // (Michael, Nov 25 review).
  const current = await ensureWebhooksSpaceExists(client)

  let members: WorkspaceMemberInfo[]
  try {
    members = await client.accountClient.getWorkspaceMembers()
  } catch (err: unknown) {
    // Treat an account-service failure as transient. Throwing here
    // leaves the state key unset so the next upgrade retries once
    // the account service is reachable again (Michael, Nov 25).
    throw new WebhooksMigrationIncompleteError(
      'account-service-failed',
      'webhooks: accountClient.getWorkspaceMembers failed; leaving migration unset so the next upgrade retries',
      { cause: err }
    )
  }

  const owners = toOwnerSet(members)
  const next = unionMembers(current.members, owners)
  if (next.added.length === 0) {
    client.logger.log('webhooks: dedicated space already has every Owner as member; no update', {
      total: current.members.length
    })
    return
  }

  await client.update<Space>(DOMAIN_SPACE, { _id: current._id }, { members: next.result })
  client.logger.log('webhooks: seeded Owner members on dedicated space', {
    added: next.added.length,
    total: next.result.length
  })
}

interface WebhooksSpaceSnapshot {
  _id: Ref<Space>
  members: AccountUuid[]
}

/**
 * Idempotent create-or-read of the dedicated webhooks space row in
 * `DOMAIN_SPACE`. The model declaration at
 * `models/webhooks/src/index.ts:316-327` writes the space to
 * `core.space.Model` (DOMAIN_MODEL_TX), but runtime Space rows live
 * in DOMAIN_SPACE. On a fresh workspace, the migration must create
 * the DOMAIN_SPACE row itself; on an existing workspace, this returns
 * the persisted row unchanged. Writes to disk only when the row is
 * actually missing, so re-running the migration is a no-op.
 *
 * Propagates `WebhooksMigrationIncompleteError('dedicated-space-collides')`
 * if the persisted state contains more than one row for the same `_id`:
 * operators must resolve that before the migration can proceed. Keeps
 * the state key unset so the next upgrade retries once the collision
 * is resolved.
 */
async function ensureWebhooksSpaceExists (client: MigrationClient): Promise<WebhooksSpaceSnapshot> {
  const current = await readWebhooksSpace(client)
  if (current !== undefined) return current

  // Shape mirrors the model declaration at
  // `models/webhooks/src/index.ts:316-327` so the runtime row matches
  // what the model intends. `members: []` on first create; the seed
  // step below adds Owners in the same pass. `core.account.System` is
  // the only principal available to a migration.
  const now = Date.now()
  await client.create<Space>(DOMAIN_SPACE, {
    _id: webhooks.space.Webhooks,
    _class: core.class.Space,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn: now,
    createdBy: core.account.System,
    createdOn: now,
    name: 'Webhooks',
    description: 'Dedicated private space for webhook subscriptions',
    private: true,
    archived: false,
    members: []
  })
  client.logger.log('webhooks: created dedicated space row in DOMAIN_SPACE', {
    _id: webhooks.space.Webhooks
  })
  return { _id: webhooks.space.Webhooks, members: [] }
}

async function readWebhooksSpace (client: MigrationClient): Promise<WebhooksSpaceSnapshot | undefined> {
  // Use limit: 2 to detect data-integrity surprises per the repo rules
  // (platform-contributions-rules.md #6). `_id` is a documented
  // constant (`webhooks.space.Webhooks`) that MUST resolve to exactly
  // one row; anything else is malformed state and this migration
  // refuses to touch it.
  const rows = await client.find<Space>(DOMAIN_SPACE, { _id: webhooks.space.Webhooks }, { limit: 2 })
  if (rows.length === 0) return undefined
  if (rows.length > 1) {
    // Treat duplicate dedicated-space rows as a data-integrity
    // problem the operator must address. Throwing here keeps the
    // state key unset so a later pass retries after the state is
    // fixed, rather than recording the seed as successful and
    // locking out all future runs (Michael, Nov 25).
    throw new WebhooksMigrationIncompleteError(
      'dedicated-space-collides',
      `webhooks: ${rows.length} docs collide on the dedicated space _id; leaving migration unset so the next upgrade retries once operators resolve the collision`
    )
  }
  const row = rows[0]
  const members = sanitizeMembers(row.members)
  return { _id: row._id, members }
}

/**
 * Keep only entries that look like `AccountUuid` strings (defence
 * against malformed rows per platform-contributions-rules.md #1).
 */
export function sanitizeMembers (raw: unknown): AccountUuid[] {
  if (!Array.isArray(raw)) return []
  const out: AccountUuid[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) continue
    if (seen.has(entry)) continue
    seen.add(entry)
    out.push(entry as AccountUuid)
  }
  return out
}

/**
 * Extract the `AccountUuid` of every member whose role is Owner,
 * ignoring malformed rows. Pure function; exported for tests.
 */
export function toOwnerSet (members: readonly WorkspaceMemberInfo[]): Set<AccountUuid> {
  const out = new Set<AccountUuid>()
  for (const m of members) {
    if (m === null || typeof m !== 'object') continue
    if (m.role !== AccountRole.Owner) continue
    if (typeof m.person !== 'string' || m.person.length === 0) continue
    out.add(m.person)
  }
  return out
}

export interface MembershipUnionResult {
  result: AccountUuid[]
  added: AccountUuid[]
}

/**
 * Union the current `members` list with `owners`, preserving the
 * original order and de-duplicating. Returns the merged result and
 * the subset of `owners` that was not already present. Pure function;
 * exported for tests.
 */
export function unionMembers (current: readonly AccountUuid[], owners: ReadonlySet<AccountUuid>): MembershipUnionResult {
  const result: AccountUuid[] = []
  const seen = new Set<AccountUuid>()
  for (const uuid of current) {
    if (seen.has(uuid)) continue
    seen.add(uuid)
    result.push(uuid)
  }
  const added: AccountUuid[] = []
  for (const uuid of owners) {
    if (seen.has(uuid)) continue
    seen.add(uuid)
    result.push(uuid)
    added.push(uuid)
  }
  return { result, added }
}

/** @public */
export const webhooksOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode: MigrateMode): Promise<void> {
    await tryMigrate(mode, client, webhooksId, [
      {
        state: 'seedOwnerMembers-v1',
        func: seedWebhooksSpaceMembers
      }
    ])
  },
  // Upgrade-time hook intentionally empty: the seed above runs in
  // both `create` and `upgrade` modes through `migrate`, and relies
  // only on the low-level MigrationClient. A high-level client pass
  // would need a service-token Tx, which this PR does not ship (that
  // belongs with the management RPC in a later PR).
  async upgrade (_state: Map<string, Set<string>>, _client: () => Promise<MigrationUpgradeClient>): Promise<void> {}
}

// Re-exported pure helpers for unit testing without pulling the
// MigrationClient surface into the spec.
export const migrationInternal = {
  sanitizeMembers,
  toOwnerSet,
  unionMembers
}
