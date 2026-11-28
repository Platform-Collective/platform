// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import {
  AccountRole,
  DOMAIN_MODEL,
  type AccountUuid,
  type Class,
  type Doc,
  type Domain,
  type Ref,
  type Space,
  type Timestamp,
  type Tx
} from '@hcengineering/core'
import { Mixin, Model, Prop, TypeBoolean, TypeNumber, TypeString, UX, type Builder } from '@hcengineering/model'
import core, { TClass, TDoc } from '@hcengineering/model-core'
import setting from '@hcengineering/model-setting'
import webhooks, {
  type WebhookAuditBlob,
  type WebhookCleanupTask,
  type WebhookDeliveryAttempt,
  type WebhookEventSource,
  type WebhookJournal,
  type WebhookOutboxJob,
  type WebhookRetryPolicy,
  type WebhookSecret,
  type WebhookSecretMeta,
  type WebhookSubscribable,
  type WebhookSubscription,
  type WebhookSubscriptionLease,
  type WebhookTarget,
  type WebhookTrigger
} from '@hcengineering/webhooks'

export { webhooksId } from '@hcengineering/webhooks'
export { default } from '@hcengineering/webhooks'

/** @public */
export const DOMAIN_WEBHOOKS = 'webhooks' as Domain

/**
 * @public
 *
 * Opt-in mixin applied by plugins to `core.class.Class` for the Doc
 * classes they want to expose to the webhooks sweeper. Rev 6: no
 * class is subscribable without this mixin (A1).
 */
@Mixin(webhooks.mixin.WebhookSubscribable, core.class.Class)
export class TWebhookSubscribable extends TClass implements WebhookSubscribable {
  events?: WebhookSubscribable['events']
  excludedAttributes?: string[]
  semanticSources?: Array<Ref<WebhookEventSource>>
}

/**
 * @public
 *
 * Plugin-contributed event source. Lives in `DOMAIN_MODEL` so the
 * sweeper can resolve it synchronously. The doc `_id` IS the kind
 * (no separate `kind` field).
 */
@Model(webhooks.class.WebhookEventSource, core.class.Doc, DOMAIN_MODEL)
export class TWebhookEventSource extends TDoc implements WebhookEventSource {
  semantic!: boolean
  sourceClass?: Ref<Class<Doc>>
  detectOn?: Ref<Class<Doc>>
  label!: WebhookEventSource['label']
  icon?: WebhookEventSource['icon']
  hidden?: boolean
  match!: WebhookEventSource['match']
  variables!: WebhookEventSource['variables']
  renderMinimalBody!: WebhookEventSource['renderMinimalBody']
  eligibility?: WebhookEventSource['eligibility']
}

/**
 * @public
 *
 * The user-visible subscription doc. Pinned to the dedicated private
 * webhooks space; the permission middleware refuses any client Tx
 * that tries to move it.
 */
@Model(webhooks.class.WebhookSubscription, core.class.Doc, DOMAIN_WEBHOOKS)
@UX(webhooks.string.Webhooks, webhooks.icon.Webhooks)
export class TWebhookSubscription extends TDoc implements WebhookSubscription {
  @Prop(TypeString(), webhooks.string.Webhooks)
  name!: string

  @Prop(TypeString(), webhooks.string.Webhooks)
  owner!: AccountUuid

  target!: WebhookTarget

  @Prop(TypeNumber(), webhooks.string.Webhooks)
  revision!: number

  secretsMeta!: WebhookSecretMeta[]

  triggers!: WebhookTrigger[]

  retryPolicy?: WebhookRetryPolicy

  @Prop(TypeBoolean(), webhooks.string.Webhooks)
  enabled!: boolean

  @Prop(TypeBoolean(), webhooks.string.Webhooks)
  storeResponseBody!: boolean

  lastDeliveryAt?: Timestamp
  lastDeliveryStatus?: 'ok' | 'error' | 'skipped'
  lastDeliveryHttpCode?: number
  lastDeliveryError?: string
}

/**
 * @public
 *
 * Named secret, service-write only. The row holds only the
 * ciphertext and the key identifiers; AAD is reconstructed from the
 * authenticated context at decrypt time, NOT read from this row.
 */
@Model(webhooks.class.WebhookSecret, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookSecret extends TDoc implements WebhookSecret {
  subscription!: Ref<WebhookSubscription>
  name!: string
  masterKeyId!: string
  dekVersion!: number
  ciphertext!: Buffer
  nonce!: Buffer
  tag!: Buffer
  lastRotatedAt!: Timestamp
}

/**
 * @public
 *
 * Journal entry. Written by the Tx-log sweeper (PR 2) in
 * `DOMAIN_WEBHOOKS` — single-domain atomic. Stores
 * identifiers and attribute NAMES only; values are read from the
 * live source doc at render time (rev 6, A4).
 */
@Model(webhooks.class.WebhookJournal, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookJournal extends TDoc implements WebhookJournal {
  state!: 'pending' | 'in_realization' | 'realized' | 'failed'
  sourceEvent!: WebhookJournal['sourceEvent']
  matchedSubscriptions!: WebhookJournal['matchedSubscriptions']
  attemptCount!: number
  lastAttemptAt!: Timestamp | null
  createdAt!: Timestamp
}

/**
 * @public
 *
 * One outbox row per `(subscription, eventKind, sourceEventId)`.
 * `frozenRequest` stores the diagnostic `[SECRET:<name>]` form;
 * secrets are substituted at send time (rev 6, B2). Ordering by
 * capture-time sequence, not `nextAttemptAt`.
 */
@Model(webhooks.class.WebhookOutboxJob, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookOutboxJob extends TDoc implements WebhookOutboxJob {
  subscription!: Ref<WebhookSubscription>
  revision!: number
  eventKind!: Ref<WebhookEventSource>
  sourceEventId!: string
  deliveryId!: string
  journal!: Ref<WebhookJournal>
  txId!: Ref<Tx>
  frozenRequest!: WebhookOutboxJob['frozenRequest']
  state!: 'pending' | 'in_flight' | 'done' | 'failed' | 'quarantined'
  attempts!: number
  nextAttemptAt!: Timestamp | null
  terminalReason!: string | null
  claimedUnderLease!: string | null
}

/**
 * @public
 *
 * Audit metadata row. Carries identifiers + outcome + error
 * reason + body-hash. The sensitive rendered content lives in the
 * blob store (`blobId`), NOT inline. Generic over source class
 * (`sourceClass` + `sourceDoc`); rev 4's `issueRef` is gone.
 */
@Model(webhooks.class.WebhookDeliveryAttempt, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookDeliveryAttempt extends TDoc implements WebhookDeliveryAttempt {
  subscription!: Ref<WebhookSubscription>
  deliveryId!: string
  attempt!: number
  eventKind!: Ref<WebhookEventSource> | 'test' | 'skipped' | 'rotated' | 'bindingChanged'
  txId!: Ref<Tx>
  sourceClass!: Ref<Class<Doc>>
  sourceDoc!: Ref<Doc>
  sourceSpace!: Ref<Space>
  at!: Timestamp
  outcome!: 'ok' | 'error' | 'skipped' | 'denied'
  httpCode?: number
  errorReason?: string
  blobId?: string
  omittedHeaders?: string[]
  bodyBytesHash?: string
}

/**
 * @public
 *
 * Audit payload row. The audit JSON itself lives in the workspace
 * blob adapter (object storage) at `blobId`; this row carries only
 * the key material and size. Rev 4's inline `ciphertext` field is
 * dropped (a Tx-written TDoc with inline ciphertext is still in Tx
 * history, defeating the purpose).
 */
@Model(webhooks.class.WebhookAuditBlob, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookAuditBlob extends TDoc implements WebhookAuditBlob {
  subscription!: Ref<WebhookSubscription>
  deliveryId!: string
  attempt!: number
  blobId!: string
  blobBytes!: number
  masterKeyId!: string
  dekVersion!: number
  nonce!: Buffer
  tag!: Buffer
  at!: Timestamp
}

/**
 * @public
 *
 * Subscription-wide lease for ordered delivery.
 */
@Model(webhooks.class.WebhookSubscriptionLease, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookSubscriptionLease extends TDoc implements WebhookSubscriptionLease {
  subscription!: Ref<WebhookSubscription>
  holder!: string
  expiresAt!: Timestamp
}

/**
 * @public
 *
 * Durable cleanup intent.
 */
@Model(webhooks.class.WebhookCleanupTask, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookCleanupTask extends TDoc implements WebhookCleanupTask {
  targets!: WebhookCleanupTask['targets']
  state!: 'pending' | 'documentsRemoved' | 'historyPruned' | 'done'
  attempts!: number
  lastError?: string
  createdAt!: Timestamp
}

export function createModel (builder: Builder): void {
  builder.createModel(
    TWebhookSubscribable,
    TWebhookEventSource,
    TWebhookSubscription,
    TWebhookSecret,
    TWebhookJournal,
    TWebhookOutboxJob,
    TWebhookDeliveryAttempt,
    TWebhookAuditBlob,
    TWebhookSubscriptionLease,
    TWebhookCleanupTask
  )

  // Dedicated private space for every webhook doc (rev 6, A2).
  //
  // Must be `core.class.Space` with `private: true`, NOT
  // `core.class.SystemSpace`: `SpaceSecurityMiddleware` puts
  // SystemSpaces into its `systemSpaces` set and adds them to every
  // member's allowed-spaces list, so `private: true` has no effect
  // on a SystemSpace. Michael caught this in review of e5f9650 - a
  // regular workspace member could then read the webhook Tx history
  // (`findAll(core.class.Tx, { objectSpace: webhooks.space.Webhooks })`)
  // and receive the create/update Txes live over broadcast.
  //
  // With `core.class.Space` + `private: true`:
  //  - `SpaceSecurityMiddleware` filters findAll by membership
  //  - Tx-history queries on `objectSpace: webhooks.space.Webhooks`
  //    are filtered the same way
  //  - Live broadcast only reaches members
  //  - The webhooks service's system token bypasses the filter
  //    via `isSystem(account, ctx)` short-circuit
  //
  // Members are seeded empty here. In PR 1 the Settings UI is a
  // placeholder and no subscriptions exist, so no reads need to
  // succeed yet. PR 2 ships:
  //  (a) a server-side trigger on `TxUpdateDoc<Account>` that syncs
  //      workspace Owners into this space's members list on role
  //      changes
  //  (b) a migration that seeds existing workspace Owners at
  //      install time
  //  (c) the management RPC also adds its caller to the members
  //      list as a side effect of creating a subscription
  builder.createDoc(
    core.class.Space,
    core.space.Model,
    {
      name: 'Webhooks',
      description: 'Dedicated private space for webhook subscriptions',
      private: true,
      archived: false,
      members: []
    },
    webhooks.space.Webhooks
  )

  // Workspace Settings navigator entry. Only workspace Owners see
  // it; the permission middleware refuses writes below Owner
  // regardless.
  builder.createDoc(setting.class.WorkspaceSettingCategory, core.space.Model, {
    name: 'webhooks',
    label: webhooks.string.ConfigLabel,
    icon: webhooks.icon.Webhooks,
    component: webhooks.component.WebhooksSettings,
    group: 'settings-editor',
    role: AccountRole.Owner,
    order: 2200
  })
}
