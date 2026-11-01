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
  type Class,
  type Doc,
  type DocumentQuery,
  type DocumentUpdate,
  type FindOptions,
  type FindResult,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Space,
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
import webhooks from '@hcengineering/webhooks'

/** @public */
export const serverWebhooksId = 'server-webhooks' as Plugin

/**
 * The service identifier the webhook delivery service puts in its token
 * extras: `generateToken(systemAccountUuid, workspace, { service: 'webhooks' })`.
 * The system-account bypass requires this match, so a token belonging to
 * another internal service (github, gmail, process, ...) does NOT inherit
 * webhook authority.
 */
const WEBHOOKS_SERVICE_TOKEN: string = 'webhooks'

/**
 * Fields on `TWebhookSubscription` that only the webhooks service's own
 * token may write. Writes in ANY form (top-level, dotted path, inside
 * any update operator, as either side of `$rename`) are refused for
 * every non-service caller.
 *
 * Rev 6 expands the service-only set: ALL destination-level fields are
 * now service-only too, so a destination change can only land through
 * the management RPC (service-authored Tx). The RPC recomputes
 * `revision` + `configDigest` and re-enters secrets in one atomic
 * step; a client-authored direct Tx cannot leave a stale digest
 * (addresses ArtyomSavchenko's rev-5 blocking #3).
 */
const SERVICE_ONLY_PATHS = new Set<string>([
  // Pin: space is the dedicated private webhooks space; no actor
  // other than the service may move the doc.
  'space',
  // Stored-owner identity + service-maintained metadata.
  'owner',
  'revision',
  'secretsMeta',
  'lastDeliveryAt',
  'lastDeliveryStatus',
  'lastDeliveryHttpCode',
  'lastDeliveryError',
  // Destination-level fields (rev 6: RPC-only). The management RPC
  // writes these under the service's own token.
  'target',
  'triggers',
  'retryPolicy',
  'storeResponseBody',
  // Nested service-only destination fields. The top-level `target`
  // entry above covers these too, but listing them explicitly keeps
  // the exact-path check working for any client-authored dotted key
  // that reaches storage.
  'target.configDigest',
  'target.configDigestAlg',
  'target.boundAt'
])

/**
 * Fields a current workspace Owner may change through a direct client
 * Tx. The containment allowlist: enable, disable, rename, no more.
 * Anything else (destination-level, service-only) requires the service
 * token.
 */
const CONTAINMENT_WRITABLE_TOP_FIELDS = new Set<string>(['enabled', 'name'])

/**
 * Known top-level attribute keys on `TWebhookSubscription` that a
 * client Tx can legally mention at all. An attribute not in this set
 * OR in `SERVICE_ONLY_PATHS` is unknown and the write is refused
 * (closed-world).
 */
const KNOWN_CLIENT_WRITABLE_TOP_FIELDS = CONTAINMENT_WRITABLE_TOP_FIELDS

const KNOWN_OPERATORS = new Set<string>(['$push', '$pull', '$update', '$inc', '$unset', '$rename'])

/**
 * `WebhookPermissionsMiddleware`
 *
 * Core authorization middleware wired into the pipeline (same slot as
 * `GuestPermissionsMiddleware`). NOT a plugin-contributed trigger: a
 * trigger would be too late because `TriggersMiddleware.tx` runs
 * `provideTx` first and catches trigger exceptions, so a direct Tx
 * from a non-Owner would still land in storage.
 *
 * Rules (see `docs/webhooks/DESIGN.md` rev 6, section "Authorization"):
 *
 *  - **Owner-only on `TWebhookSubscription` CUD.** Below-Owner callers
 *    refused.
 *  - **Destination-level writes refused for every client.** `target`,
 *    `triggers`, `retryPolicy`, `storeResponseBody`, `secretsMeta`,
 *    and every nested `target.*` field are service-only. The
 *    management RPC (service-authored Tx) is the only write path
 *    (rev 6, blocking #3).
 *  - **Service-maintained metadata refused for every client.** `space`,
 *    `owner`, `revision`, `lastDelivery*` can only be written by the
 *    service. The `space` pin covers the "move the sub into a
 *    broadly readable space" vector.
 *  - **Containment-only allowlist for current Owners.** `enabled` and
 *    `name` as plain top-level keys, no `$`-operator, no dotted key.
 *  - **No `$set` operator.** This codebase uses `$push`, `$pull`,
 *    `$update`, `$inc`, `$unset`, `$rename`. An unknown operator is
 *    refused.
 *  - **Service-internal classes refused for every client.**
 *    `TWebhookSecret`, `TWebhookJournal`, `TWebhookOutboxJob`,
 *    `TWebhookDeliveryAttempt`, `TWebhookAuditBlob`,
 *    `TWebhookSubscriptionLease`, `TWebhookCleanupTask`.
 *  - **`TxMixin` on `TWebhookSubscription` refused unconditionally.**
 *  - **`TxApplyIf` walked recursively** so a forbidden write cannot
 *    be smuggled through a collection.
 *  - **`TxCreateDoc.objectSpace` pinned to `webhooks.space.Webhooks`.**
 *    The dedicated private space holds every webhook doc; a client
 *    create targeted at any other space is refused.
 *
 * Read gating (`findAll`):
 *
 *  - Direct `findAll` on any webhook class: refused for non-Owners
 *    (returns empty `FindResult`). Service-internal classes also
 *    refused for Owners (service-only). This is defence in depth;
 *    the primary read gate is `SpaceSecurityMiddleware` filtering
 *    on membership of `webhooks.space.Webhooks`.
 *  - `findAll(core.class.Tx, { objectClass: <any webhook class> })`:
 *    refused for every non-service caller. Covers the Tx-history
 *    leak ArtyomSavchenko flagged in rev-5 (`findAll(core.class.Tx,
 *    { objectClass: webhooks.class.WebhookSubscription })` returns
 *    the create/update Txes themselves, with URL and header
 *    templates).
 *
 * System-account bypass is narrow: `account.uuid === systemAccountUuid`
 * AND `ctx.contextData.service === 'webhooks'`. Other internal
 * services do not inherit webhooks authority.
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
      if (!this.canReadWebhookClass(ctx, _class)) {
        return this.emptyResult<T>(options)
      }
    } else if (this.context.hierarchy.isDerived(_class, core.class.Tx)) {
      if (this.queryTargetsWebhookClass(query as DocumentQuery<Doc>) && !this.isService(ctx)) {
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

  private canReadWebhookClass (ctx: MeasureContext<SessionData>, _class: Ref<Class<Doc>>): boolean {
    if (this.isService(ctx)) return true
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

  private queryTargetsWebhookClass (query: DocumentQuery<Doc>): boolean {
    const q = query as Record<string, unknown>
    const oc = q.objectClass
    if (typeof oc === 'string') {
      return this.isWebhookClass(oc as Ref<Class<Doc>>)
    }
    if (oc !== null && typeof oc === 'object') {
      const inArr = (oc as Record<string, unknown>).$in
      if (Array.isArray(inArr)) {
        for (const entry of inArr) {
          if (typeof entry === 'string' && this.isWebhookClass(entry as Ref<Class<Doc>>)) return true
        }
      }
    }
    return false
  }

  private emptyResult<T extends Doc>(options?: FindOptions<T>): FindResult<T> {
    return Object.assign([] as T[], { total: options?.total === true ? 0 : -1 }) as FindResult<T>
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

    if (cud._class === core.class.TxMixin) {
      throw forbidden()
    }

    if (!hasAccountRole(account, AccountRole.Owner)) {
      throw forbidden()
    }

    if (cud._class === core.class.TxCreateDoc) {
      await this.processCreate(ctx, cud as TxCreateDoc<Doc>, account)
      return
    }
    if (cud._class === core.class.TxUpdateDoc) {
      await this.processUpdate(ctx, cud as TxUpdateDoc<Doc>, account)
      return
    }
    // TxRemoveDoc: Owner role is enough. Removal is containment.
  }

  private async processCreate (
    ctx: MeasureContext<SessionData>,
    tx: TxCreateDoc<Doc>,
    account: Account
  ): Promise<void> {
    // Space pin: subscription must be created in the dedicated
    // private webhooks space. Any other objectSpace is refused.
    if (tx.objectSpace !== (webhooks.space.Webhooks as Ref<Space>)) {
      throw forbidden()
    }

    const attrs = tx.attributes as Record<string, unknown>
    if (attrs.owner === undefined) throw forbidden()
    if (attrs.owner !== account.uuid) throw forbidden()

    // Allowlist on the attribute set. Only containment-writable keys
    // plus `owner` are accepted. The service seeds destination-level
    // fields on first realize; a client-authored create cannot
    // pre-populate them.
    for (const key of Object.keys(attrs)) {
      if (key === 'owner') continue
      if (!KNOWN_CLIENT_WRITABLE_TOP_FIELDS.has(key)) {
        throw forbidden()
      }
    }
  }

  private async processUpdate (
    ctx: MeasureContext<SessionData>,
    tx: TxUpdateDoc<Doc>,
    account: Account
  ): Promise<void> {
    const ops = tx.operations as DocumentUpdate<Doc> & Record<string, unknown>

    // Collect the set of paths this update touches, in every form the
    // storage layer accepts: top-level keys, dotted-path keys
    // (setObjectValue splits on `.`), and the keys inside every known
    // operator payload. `$rename` records BOTH source and destination.
    const touched = new Set<string>()
    const hasOperator = Object.keys(ops).some((key) => key.startsWith('$'))

    for (const [key, value] of Object.entries(ops)) {
      if (key.startsWith('$')) {
        if (!KNOWN_OPERATORS.has(key)) throw forbidden()
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

    if (touched.size === 0) throw forbidden()

    // Classify every recorded path. Service-only in any form →
    // refuse. Unknown top-level root → refuse. Containment-writable
    // fields must be plain top-level keys with no `$`-operator and
    // no dotted suffix (A5: a dotted key over `enabled` is NOT in
    // the containment allowlist).
    for (const path of touched) {
      if (SERVICE_ONLY_PATHS.has(path)) throw forbidden()
      const topField = topLevel(path)
      if (SERVICE_ONLY_PATHS.has(topField)) throw forbidden()
      if (!KNOWN_CLIENT_WRITABLE_TOP_FIELDS.has(topField)) throw forbidden()
      if (path !== topField) throw forbidden()
    }

    if (hasOperator) throw forbidden()
  }

  private registerPath (touched: Set<string>, raw: string): void {
    if (raw.length === 0) throw forbidden()
    touched.add(raw)
  }
}

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
