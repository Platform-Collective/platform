// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import core, {
  AccountRole,
  hasAccountRole,
  systemAccountUuid,
  TxProcessor,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type DocumentUpdate,
  type FindOptions,
  type FindResult,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  type TxUpdateDoc
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status, type Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import webhooks, { type WebhookSubscription } from '@hcengineering/webhooks'

/** @public */
export const serverWebhooksId = 'server-webhooks' as Plugin

/**
 * The service identifier the webhook delivery service puts in its token
 * extras (`generateToken(systemAccountUuid, workspace, { service: 'webhooks' })`).
 * The system-account bypass requires this match so a token belonging to
 * another internal service (github, gmail, process, ...) does NOT inherit
 * webhook authority.
 */
const WEBHOOKS_SERVICE_TOKEN: string = 'webhooks'

/**
 * Service-only fields on `TWebhookSubscription`. Writes to any of these
 * are refused for every non-service caller - in every form, top-level,
 * dotted, or inside any operator payload. The service writes them under
 * its own token.
 *
 * Dotted paths are matched exactly; a prefix match covers nested fields
 * (e.g. `target.configDigest` is service-only, but `target` as a whole
 * is NOT - stored owners can replace the target object).
 */
const SERVICE_ONLY_PATHS = new Set<string>([
  // Pinned at the top level
  'space',
  'owner',
  'revision',
  'secretsMeta',
  'lastDeliveryAt',
  'lastDeliveryStatus',
  'lastDeliveryHttpCode',
  'lastDeliveryError',
  // Pinned inside `target`
  'target.configDigest',
  'target.configDigestAlg',
  'target.boundAt'
])

/**
 * Fields a NON-STORED-OWNER current workspace Owner may change. This is
 * the containment-only allowlist (enable/disable + rename). Anything
 * else - including any `$`-operator, any dotted key, any sub-object -
 * requires the subscription's stored owner.
 */
const CONTAINMENT_WRITABLE_TOP_FIELDS = new Set<string>(['enabled', 'name'])

/**
 * The complete set of top-level attribute keys a client Tx may ever
 * touch, in any form, on a `TWebhookSubscription`. An attribute not in
 * this set is unknown and the write is refused.
 *
 * (`space`, `owner`, service-maintained fields are in `SERVICE_ONLY_PATHS`
 * and so are refused independently of this list.)
 */
const KNOWN_CLIENT_WRITABLE_TOP_FIELDS = new Set<string>([
  'name',
  'target',
  'triggers',
  'retryPolicy',
  'enabled',
  'storeResponseBody'
])

/**
 * Top-level TWebhookSubscription attributes whose MODIFICATION is a
 * destination change. A client Tx must come from the stored owner.
 * `space` is not listed here because it is pinned entirely
 * (service-only).
 */
const DESTINATION_LEVEL_TOP_FIELDS = new Set<string>([
  'target',
  'triggers',
  'retryPolicy',
  'storeResponseBody'
])

/**
 * `WebhookPermissionsMiddleware`
 *
 * This is a core authorization middleware wired into the pipeline (same
 * slot as `GuestPermissionsMiddleware`) - NOT a plugin-contributed
 * trigger. A trigger would be too late: `TriggersMiddleware.tx` runs
 * `provideTx` first and catches trigger exceptions, so a non-authorized
 * Tx a trigger would reject still lands in storage.
 *
 * The authorization contract (see `docs/webhooks/DESIGN.md` section
 * "Authorization"):
 *
 *  - Only workspace Owners can act on `TWebhookSubscription`.
 *  - A non-stored-owner Owner can enable/disable or rename a sub
 *    (containment); a destination change needs the subscription's own
 *    stored owner.
 *  - The service-maintained fields (owner, revision, secretsMeta,
 *    lastDelivery*, space, target.configDigest, target.boundAt,
 *    target.configDigestAlg) are refused in any client form - top
 *    level, dotted path, or inside any update operator (`$push`,
 *    `$pull`, `$update`, `$inc`, `$unset`, `$rename`).
 *  - Dotted keys and `$`-operators are also refused from a
 *    non-stored-owner caller even on destination-level fields (the
 *    non-stored-owner allowlist is top-level `enabled` and `name` only).
 *  - `TxCreateDoc` requires the attributes' `owner` to equal the
 *    caller.
 *  - `TxApplyIf` is walked recursively.
 *  - `TxMixin` on any webhook class is refused unconditionally.
 *  - The internal classes (secret, journal, outbox, delivery attempt,
 *    audit blob, lease, cleanup task) accept no client Tx of any kind.
 *
 * Reads are gated separately via `findAll`:
 *
 *  - `TWebhookSubscription`: visible only to workspace Owners (or the
 *    service).
 *  - All service-internal classes: visible only to the service.
 *
 * System-account bypass is narrow: the caller must have
 * `account.uuid === systemAccountUuid` AND the request must carry the
 * webhooks service token (`ctx.contextData.service === 'webhooks'`).
 * This stops other system services (github, gmail, telegram, process,
 * ...) from inheriting webhook authority through their own system
 * tokens.
 */
export class WebhookPermissionsMiddleware extends BaseMiddleware implements Middleware {
  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<WebhookPermissionsMiddleware> {
    return new WebhookPermissionsMiddleware(context, next)
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    if (!this.isService(ctx)) {
      const account = ctx.contextData.account
      for (const tx of txes) {
        await this.processTx(ctx, tx, account)
      }
    }
    return await this.provideTx(ctx, txes)
  }

  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    if (this.isWebhookClass(_class)) {
      if (!this.canRead(ctx, _class)) {
        // Caller lacks read authority - return an empty, well-shaped
        // FindResult so the client sees "no rows" rather than an error.
        return this.emptyResult<T>(options)
      }
    }
    return await this.provideFindAll(ctx, _class, query, options)
  }

  private isService (ctx: MeasureContext<SessionData>): boolean {
    const account = ctx.contextData.account
    const service = ctx.contextData.service
    return account.uuid === systemAccountUuid && service === WEBHOOKS_SERVICE_TOKEN
  }

  private canRead (ctx: MeasureContext<SessionData>, _class: Ref<Class<Doc>>): boolean {
    if (this.isService(ctx)) return true
    // Only the subscription class is readable by non-service callers,
    // and only by Owners. Every other webhook class is service-only.
    if (_class !== webhooks.class.WebhookSubscription) return false
    return hasAccountRole(ctx.contextData.account, AccountRole.Owner)
  }

  private isWebhookClass (_class: Ref<Class<Doc>>): boolean {
    const h = this.context.hierarchy
    return (
      h.isDerived(_class, webhooks.class.WebhookSubscription) ||
      h.isDerived(_class, webhooks.class.WebhookSecret) ||
      h.isDerived(_class, webhooks.class.WebhookJournal) ||
      h.isDerived(_class, webhooks.class.WebhookOutboxJob) ||
      h.isDerived(_class, webhooks.class.WebhookDeliveryAttempt) ||
      h.isDerived(_class, webhooks.class.WebhookAuditBlob) ||
      h.isDerived(_class, webhooks.class.WebhookSubscriptionLease) ||
      h.isDerived(_class, webhooks.class.WebhookCleanupTask)
    )
  }

  private emptyResult<T extends Doc>(options?: FindOptions<T>): FindResult<T> {
    const empty = Object.assign([] as T[], { total: options?.total === true ? 0 : -1 }) as FindResult<T>
    return empty
  }

  private async processTx (
    ctx: MeasureContext<SessionData>,
    tx: Tx,
    account: Account
  ): Promise<void> {
    if (tx._class === core.class.TxApplyIf) {
      const applyTx = tx as TxApplyIf
      for (const inner of applyTx.txes) {
        await this.processTx(ctx, inner, account)
      }
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return

    const cud = tx as TxCUD<Doc>
    const h = this.context.hierarchy

    // Service-internal classes: no client Tx of any kind.
    if (
      h.isDerived(cud.objectClass, webhooks.class.WebhookSecret) ||
      h.isDerived(cud.objectClass, webhooks.class.WebhookJournal) ||
      h.isDerived(cud.objectClass, webhooks.class.WebhookOutboxJob) ||
      h.isDerived(cud.objectClass, webhooks.class.WebhookDeliveryAttempt) ||
      h.isDerived(cud.objectClass, webhooks.class.WebhookAuditBlob) ||
      h.isDerived(cud.objectClass, webhooks.class.WebhookSubscriptionLease) ||
      h.isDerived(cud.objectClass, webhooks.class.WebhookCleanupTask)
    ) {
      throw forbidden()
    }

    if (!h.isDerived(cud.objectClass, webhooks.class.WebhookSubscription)) return

    // Mixin writes on a subscription: refused. The subscription class is
    // security-sensitive and has no mixin surface.
    if (cud._class === core.class.TxMixin) {
      throw forbidden()
    }

    // Any management action requires Owner.
    if (!hasAccountRole(account, AccountRole.Owner)) {
      throw forbidden()
    }

    if (cud._class === core.class.TxCreateDoc) {
      await this.processCreate(ctx, cud as TxCreateDoc<WebhookSubscription>, account)
      return
    }
    if (cud._class === core.class.TxUpdateDoc) {
      await this.processUpdate(ctx, cud as TxUpdateDoc<WebhookSubscription>, account)
      return
    }
    // TxRemoveDoc: Owner role is enough. Removal is containment.
  }

  private async processCreate (
    ctx: MeasureContext<SessionData>,
    tx: TxCreateDoc<WebhookSubscription>,
    account: Account
  ): Promise<void> {
    const attrs = tx.attributes as Partial<WebhookSubscription> & Record<string, unknown>
    // `owner` must be the caller: a workspace Owner cannot create a
    // subscription owned by someone else, and ownership transfer is not
    // part of create.
    if (attrs.owner === undefined) throw forbidden()
    if (attrs.owner !== account.uuid) throw forbidden()

    // Closed-world allowlist on the attribute set itself: only known
    // client-writable keys plus `owner` are accepted. Service-only
    // fields and unknown fields are both refused.
    for (const key of Object.keys(attrs)) {
      if (key === 'owner') continue
      if (!KNOWN_CLIENT_WRITABLE_TOP_FIELDS.has(key)) {
        throw forbidden()
      }
    }
    // Nested check on `target`: service-only subfields are refused.
    // Unknown target keys are accepted at this layer; the delivery
    // service is responsible for shape validation at bind time (see
    // DESIGN.md section "Target binding").
    const target = attrs.target as Record<string, unknown> | undefined
    if (target !== undefined) {
      for (const key of Object.keys(target)) {
        if (SERVICE_ONLY_PATHS.has('target.' + key)) {
          throw forbidden()
        }
      }
    }
  }

  private async processUpdate (
    ctx: MeasureContext<SessionData>,
    tx: TxUpdateDoc<WebhookSubscription>,
    account: Account
  ): Promise<void> {
    const ops = tx.operations as DocumentUpdate<WebhookSubscription> & Record<string, unknown>

    // Collect the set of top-level fields this update touches, by
    // walking every form the storage layer accepts: top-level keys,
    // dotted-path keys (`setObjectValue` splits on `.`), and the keys
    // inside every known operator payload.
    const touched = new Set<string>()

    for (const [key, value] of Object.entries(ops)) {
      if (key.startsWith('$')) {
        if (!KNOWN_OPERATORS.has(key)) {
          // An unknown `$`-operator is a bug or a bypass attempt;
          // refuse rather than silently ignore.
          throw forbidden()
        }
        // Operator payload shape (`{ field: ... }`) always keys by
        // top-level field name. `$rename` targets both the source and
        // the destination.
        if (!isPlainObject(value)) throw forbidden()
        const payload = value as Record<string, unknown>
        for (const payloadKey of Object.keys(payload)) {
          this.registerPath(touched, payloadKey)
          if (key === '$rename') {
            const renameTo = payload[payloadKey]
            if (typeof renameTo !== 'string') throw forbidden()
            this.registerPath(touched, renameTo)
          }
        }
      } else {
        this.registerPath(touched, key)
      }
    }

    if (touched.size === 0) {
      // An empty operations payload is a no-op; refuse rather than let
      // it pass as "nothing to do". An intentional no-op has no
      // business being a Tx.
      throw forbidden()
    }

    // Classify the fields.
    let hasDestinationChange = false
    for (const path of touched) {
      // Rule 1: unknown field - refuse (closed-world allowlist).
      const topField = topLevel(path)
      if (!KNOWN_CLIENT_WRITABLE_TOP_FIELDS.has(topField) && !SERVICE_ONLY_PATHS.has(topField)) {
        throw forbidden()
      }

      // Rule 2: service-only field in any form - refuse.
      if (SERVICE_ONLY_PATHS.has(path) || SERVICE_ONLY_PATHS.has(topField)) {
        throw forbidden()
      }
      // A nested service-only path reached via `target.` + something
      // not in SERVICE_ONLY_PATHS does not slip past rule 2; the exact
      // membership test above catches it. But a wild dotted path like
      // `target` alone, replacing the entire object, is not
      // service-only - rule 3 catches that case because `target` is
      // destination-level.

      // Rule 3: destination-level field - requires stored owner.
      if (DESTINATION_LEVEL_TOP_FIELDS.has(topField)) {
        hasDestinationChange = true
      }
    }

    // Rule 4: non-stored-owner caller - must have touched ONLY the
    // containment-allowlist, and only in top-level form (no operators,
    // no dotted keys).
    //
    // A touched set containing a destination-level field falls into
    // the stored-owner gate below. A touched set that is pure
    // containment-allowlist in top-level form is allowed for any
    // Owner.
    const containmentOnly =
      !hasDestinationChange &&
      Array.from(touched).every(
        (path) => path === topLevel(path) && CONTAINMENT_WRITABLE_TOP_FIELDS.has(path)
      )

    const hasOperator = Object.keys(ops).some((key) => key.startsWith('$'))
    const hasDottedKey = Array.from(touched).some((path) => path.includes('.'))

    if (containmentOnly && !hasOperator && !hasDottedKey) {
      // Any Owner, containment update - allowed.
      return
    }

    // Otherwise, the update needs the stored owner.
    const stored = await this.loadSubscription(ctx, tx.objectId as Ref<WebhookSubscription>)
    if (stored === undefined) throw forbidden()
    if (stored.owner !== (account.uuid as AccountUuid)) throw forbidden()
  }

  private registerPath (touched: Set<string>, raw: string): void {
    if (raw.length === 0) throw forbidden()
    touched.add(raw)
  }

  private async loadSubscription (
    ctx: MeasureContext<SessionData>,
    id: Ref<WebhookSubscription>
  ): Promise<WebhookSubscription | undefined> {
    const found = await this.findAll<WebhookSubscription>(
      ctx,
      webhooks.class.WebhookSubscription,
      { _id: id },
      {}
    )
    return found[0]
  }
}

const KNOWN_OPERATORS = new Set<string>(['$push', '$pull', '$update', '$inc', '$unset', '$rename'])

function topLevel (path: string): string {
  const i = path.indexOf('.')
  return i === -1 ? path : path.slice(0, i)
}

function isPlainObject (v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function forbidden (): PlatformError {
  return new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
}

/** @public */
export default plugin(serverWebhooksId, {})
