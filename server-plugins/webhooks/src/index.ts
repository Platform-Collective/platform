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
  type Doc,
  type DocumentUpdate,
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
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import webhooks, { type WebhookSubscription } from '@hcengineering/webhooks'

/** @public */
export const serverWebhooksId = 'server-webhooks' as Plugin

/**
 * Fields the service maintains on `TWebhookSubscription`. A client Tx
 * targeting any of these is refused regardless of role, because they
 * are not user-editable; the service writes them through its own
 * token.
 */
const SERVICE_MAINTAINED_FIELDS = new Set<string>([
  'owner',
  'revision',
  'secretsMeta',
  'lastDeliveryAt',
  'lastDeliveryStatus',
  'lastDeliveryHttpCode',
  'lastDeliveryError'
])

/**
 * Fields nested under `target` that the service maintains. The
 * `target` object is nested JSON so the middleware walks it when
 * `target` appears in an update's operations.
 */
const SERVICE_MAINTAINED_TARGET_FIELDS = new Set<string>([
  'configDigest',
  'configDigestAlg',
  'boundAt'
])

/**
 * Fields nested under `target` that are destination-changing. A
 * client-authored change to any of these must come from the
 * subscription's stored owner, not just any current workspace Owner.
 * See `docs/webhooks/DESIGN.md` section "Owner-authorized destination
 * changes" for the rationale.
 */
const DESTINATION_CHANGING_TARGET_FIELDS = new Set<string>([
  'method',
  'urlTemplate',
  'headerTemplates',
  'bodyTemplate',
  'useMinimalBody',
  'contentType',
  'preset'
])

/**
 * @public
 *
 * Plugin-contributed permission middleware. Enforces the authorization
 * rules in `docs/webhooks/DESIGN.md` BEFORE the storage write
 * (`provideTx`), same slot as `GuestPermissionsMiddleware` in the
 * pipeline. A trigger would be too late: `TriggersMiddleware.tx` calls
 * `provideTx` first and catches trigger exceptions, so a non-Owner Tx
 * that a trigger would reject would still land in storage.
 *
 * Rules:
 *
 *  - **Owner-only management of `TWebhookSubscription`.** Create, update
 *    and remove require the caller to be `AccountRole.Owner` in the
 *    current workspace. A caller below Owner is refused with
 *    `platform.status.Forbidden`.
 *  - **No direct `TWebhookSecret` CUD.** The service's management RPC
 *    is the only write path; a client-authored Tx on this class is
 *    refused regardless of role, so plaintext never reaches a
 *    persisted Tx body.
 *  - **Service-maintained fields are read-only to clients.** `owner`,
 *    `revision`, `secretsMeta`, `lastDelivery*` and the service-side
 *    `target.configDigest` / `boundAt` are refused in any client
 *    update.
 *  - **Destination-changing fields require the STORED owner.** Any
 *    current Owner can enable, disable, or delete a subscription
 *    (containment), but only the subscription's own stored `owner`
 *    may change its destination, headers, body, filter, or secret
 *    layout. The middleware looks up the stored subscription for
 *    every update that touches a destination-changing field; if the
 *    caller's resolved `AccountUuid` does not match
 *    `subscription.owner`, the update is refused.
 *  - **Service-internal classes.** `TWebhookJournal`, `TWebhookOutboxJob`,
 *    `TWebhookDeliveryAttempt`, `TWebhookAuditBlob`,
 *    `TWebhookSubscriptionLease`, and `TWebhookCleanupTask` are all
 *    service-write only; a client Tx on any of them is refused.
 *  - **Compound Txes walked recursively.** A `TxApplyIf` cannot
 *    smuggle a forbidden write through a collection.
 *
 * The system account (`core.account.System` by `modifiedBy`, or
 * `systemAccountUuid` by resolved account) bypasses all checks; that
 * is how the service writes service-maintained fields and manages the
 * secret / journal / outbox / audit / lease / cleanup collections.
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
    const account = ctx.contextData.account
    // System account bypass: the webhooks service runs as the system
    // account and this is how it maintains the service-only fields and
    // the service-only collections.
    if (account.uuid !== systemAccountUuid) {
      for (const tx of txes) {
        await this.processTx(ctx, tx, account)
      }
    }
    return await this.provideTx(ctx, txes)
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

    // Service-internal classes: no client Tx is ever allowed.
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

    // Any management action on a subscription requires Owner. Enable,
    // disable, delete all pass through this check (containment); the
    // STORED-owner check below adds a per-field refinement for
    // destination-changing updates.
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
    // TxRemoveDoc + TxMixin: Owner role is enough. The stored-owner
    // refinement does not apply because destruction / mixin are not
    // destination changes.
  }

  private async processCreate (
    ctx: MeasureContext<SessionData>,
    tx: TxCreateDoc<WebhookSubscription>,
    account: Account
  ): Promise<void> {
    const attrs = tx.attributes as Partial<WebhookSubscription>
    // `owner` must be set at create and must match the caller. A
    // workspace Owner cannot create a subscription owned by someone
    // else; ownership transfer is a separate RPC. Also stops a
    // second Owner from creating a sub owned by a first Owner they do
    // not want targeted.
    if (attrs.owner === undefined) throw forbidden()
    if (attrs.owner !== account.uuid) throw forbidden()
    // `revision`, `configDigest`, `boundAt`, `lastDelivery*`,
    // `secretsMeta` are service-maintained; a client-authored create
    // that tries to set them to a non-default value is refused. The
    // service seeds them when it processes the create.
    if ((attrs as any).revision !== undefined && (attrs as any).revision !== 0) throw forbidden()
    if (attrs.secretsMeta !== undefined && attrs.secretsMeta.length !== 0) throw forbidden()
    if (
      attrs.lastDeliveryAt !== undefined ||
      attrs.lastDeliveryStatus !== undefined ||
      attrs.lastDeliveryHttpCode !== undefined ||
      attrs.lastDeliveryError !== undefined
    ) {
      throw forbidden()
    }
    const target: any = attrs.target
    if (
      target !== undefined &&
      (target.configDigest !== undefined || target.boundAt !== undefined)
    ) {
      throw forbidden()
    }
  }

  private async processUpdate (
    ctx: MeasureContext<SessionData>,
    tx: TxUpdateDoc<WebhookSubscription>,
    account: Account
  ): Promise<void> {
    const ops = tx.operations as DocumentUpdate<WebhookSubscription> & Record<string, any>

    // Service-maintained top-level fields are refused in any client
    // update.
    for (const key of Object.keys(ops)) {
      if (SERVICE_MAINTAINED_FIELDS.has(key)) throw forbidden()
    }

    // If `target` is in the update, walk its keys. Service-maintained
    // nested fields are refused. Destination-changing nested fields
    // trigger the STORED-owner check.
    let hasDestinationChange = false
    const target = ops.target as Record<string, unknown> | undefined
    if (target !== undefined) {
      for (const key of Object.keys(target)) {
        if (SERVICE_MAINTAINED_TARGET_FIELDS.has(key)) throw forbidden()
        if (DESTINATION_CHANGING_TARGET_FIELDS.has(key)) hasDestinationChange = true
      }
    }
    // $set on nested target.* is also valid; walk it too.
    const nestedSet = (ops as any).$set as Record<string, unknown> | undefined
    if (nestedSet !== undefined) {
      for (const key of Object.keys(nestedSet)) {
        if (key === 'owner' || SERVICE_MAINTAINED_FIELDS.has(key)) throw forbidden()
        if (key.startsWith('target.')) {
          const nested = key.slice('target.'.length)
          if (SERVICE_MAINTAINED_TARGET_FIELDS.has(nested)) throw forbidden()
          if (DESTINATION_CHANGING_TARGET_FIELDS.has(nested)) hasDestinationChange = true
        }
      }
    }
    // `triggers` is destination-changing shape as well: a filter change
    // decides what fires, which the stored owner must co-sign.
    if ('triggers' in ops) hasDestinationChange = true

    // `enabled`, `storeResponseBody`, `name` and `retryPolicy` are the
    // only containment-level fields a current Owner can change
    // without being the stored owner. Everything else routes through
    // the stored-owner check.
    if (hasDestinationChange) {
      const stored = await this.loadSubscription(ctx, tx.objectId as Ref<WebhookSubscription>)
      if (stored === undefined) throw forbidden()
      if (stored.owner !== (account.uuid as AccountUuid)) {
        throw forbidden()
      }
    }
  }

  private async loadSubscription (
    ctx: MeasureContext<SessionData>,
    id: Ref<WebhookSubscription>
  ): Promise<WebhookSubscription | undefined> {
    const found = await this.findAll<WebhookSubscription>(ctx, webhooks.class.WebhookSubscription, { _id: id }, {})
    return found[0]
  }
}

function forbidden (): PlatformError {
  return new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
}

/** @public */
export default plugin(serverWebhooksId, {})
