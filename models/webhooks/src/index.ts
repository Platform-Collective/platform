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
import { Model, Prop, TypeBoolean, TypeNumber, TypeRef, TypeString, UX, type Builder } from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import setting from '@hcengineering/model-setting'
import webhooks, {
  CoreEventKinds,
  type WebhookAuditBlob,
  type WebhookCleanupTask,
  type WebhookDeliveryAttempt,
  type WebhookEventSource,
  type WebhookJournal,
  type WebhookOutboxJob,
  type WebhookRetryPolicy,
  type WebhookSecret,
  type WebhookSecretMeta,
  type WebhookSourceChange,
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
 * Plugin-contributed event source. Lives in `DOMAIN_MODEL` so sources
 * ship with the model build and the webhooks service can resolve them
 * without a model query. See `docs/webhooks/DESIGN.md` section "Event
 * sources".
 */
@Model(webhooks.class.WebhookEventSource, core.class.Doc, DOMAIN_MODEL)
export class TWebhookEventSource extends TDoc implements WebhookEventSource {
  kind!: string
  sourceClass!: Ref<Class<Doc>>
  label!: WebhookEventSource['label']
  icon?: WebhookEventSource['icon']
  hidden?: boolean
}

/**
 * @public
 *
 * The user-visible subscription doc. Complex nested fields (`target`,
 * `triggers`, `secretsMeta`, `retryPolicy`) are stored as JSON on the
 * doc rather than per-field `@Prop` modeling - the delivery service
 * reads the whole doc by `_id` and never queries into those shapes, and
 * the TypeScript interface in `plugins/webhooks/src/index.ts` is
 * authoritative. The permission middleware validates shape at write
 * time; the delivery service validates again at render time. Matches
 * the same convention `TWorkflowRule` uses for `forwardMap` /
 * `allowedLoops` in #238.
 */
@Model(webhooks.class.WebhookSubscription, core.class.Doc, DOMAIN_WEBHOOKS)
@UX(webhooks.string.Webhooks, webhooks.icon.Webhooks)
export class TWebhookSubscription extends TDoc implements WebhookSubscription {
  @Prop(TypeString(), webhooks.string.Webhooks)
  name!: string

  @Prop(TypeString(), webhooks.string.Webhooks)
  owner!: AccountUuid

  // Nested JSON. The permission middleware refuses client writes to
  // `configDigest`, `boundAt`, `preset` and the inner templates
  // without the service co-signing them (see docs/webhooks/DESIGN.md,
  // "Authorization").
  target!: WebhookTarget

  @Prop(TypeNumber(), webhooks.string.Webhooks)
  revision!: number

  // Nested JSON; service-maintained.
  secretsMeta!: WebhookSecretMeta[]

  // Nested JSON. Each trigger is {eventKind, scope, classFilter?,
  // attributeFilter?}; the service joins eventKind + sourceClass +
  // scope + filters at match time.
  triggers!: WebhookTrigger[]

  // Nested JSON; optional per-subscription override of the delivery
  // policy.
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
 * Named secret, service-write only. The row holds only the ciphertext
 * and the key identifiers; the AAD is reconstructed from the
 * authenticated context at decrypt time (NOT read from this row). See
 * `docs/webhooks/DESIGN.md` section "Secrets" for the full scheme.
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
 * Pre-image + matched subscriptions captured in the Tx middleware for
 * every eligible source Tx. Generic over source class: `sourceClass`,
 * `sourceDoc`, `sourceSpace`, and a `changes` array in place of the
 * earlier Issue-specific `issueRef` / `projectRef` / status refs.
 * `sourceEventId` is the stable dedup component - a single
 * `TxApplyIf` can contain several transitions, so dedup is NOT on
 * `txId` alone. See `docs/webhooks/DESIGN.md` section "Durable outbox".
 */
@Model(webhooks.class.WebhookJournal, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookJournal extends TDoc implements WebhookJournal {
  state!: 'pending' | 'in_realization' | 'realized' | 'failed'
  sourceTx!: WebhookJournal['sourceTx']
  matchedSubscriptions!: WebhookJournal['matchedSubscriptions']
  attemptCount!: number
  lastAttemptAt!: Timestamp | null
  createdAt!: Timestamp
}

/**
 * @public
 *
 * One outbox row per `(subscription, eventKind, sourceEventId)`. The
 * dedup key allows one source Tx to produce multiple events (e.g. a
 * `TxApplyIf` with several status changes) and still land as separate,
 * independently-tracked outbox rows. Service-write only.
 */
@Model(webhooks.class.WebhookOutboxJob, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookOutboxJob extends TDoc implements WebhookOutboxJob {
  subscription!: Ref<WebhookSubscription>
  revision!: number
  eventKind!: string
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
 * Audit metadata row. Carries identifiers + outcome + error reason.
 * Sensitive rendered content lives in `TWebhookAuditBlob`, read-gated
 * per-row on current source access to the referenced source doc.
 * Generic over source class via `sourceClass` + `sourceDoc`.
 */
@Model(webhooks.class.WebhookDeliveryAttempt, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookDeliveryAttempt extends TDoc implements WebhookDeliveryAttempt {
  subscription!: Ref<WebhookSubscription>
  deliveryId!: string
  attempt!: number
  eventKind!: string | 'test' | 'skipped' | 'rotated' | 'bindingChanged'
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
}

/**
 * @public
 *
 * Encrypted audit payload (rendered URL / headers / body + response
 * body when opted in). Non-broadcast domain; the AAD is reconstructed
 * from the authenticated context on every decrypt. See
 * `docs/webhooks/DESIGN.md` section "Audit".
 */
@Model(webhooks.class.WebhookAuditBlob, core.class.Doc, DOMAIN_WEBHOOKS)
export class TWebhookAuditBlob extends TDoc implements WebhookAuditBlob {
  subscription!: Ref<WebhookSubscription>
  deliveryId!: string
  attempt!: number
  blobId!: string
  masterKeyId!: string
  dekVersion!: number
  ciphertext!: Buffer
  nonce!: Buffer
  tag!: Buffer
  at!: Timestamp
}

/**
 * @public
 *
 * Subscription-wide lease. Only the lease-holder processes outbox rows
 * for that subscription (see `docs/webhooks/DESIGN.md` section
 * "Ordering, claiming, backlog"). Lease TTL is renewed while the
 * worker is actively processing; a crashed worker's lease expires and
 * another worker takes over.
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
 * Durable cleanup intent. Recorded before any delete so a crash
 * between `TxRemoveDoc` success and history-prune success does not
 * strand confidential history indefinitely. See
 * `docs/webhooks/DESIGN.md` section "Cleanup worker".
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

  // Generic CUD event sources. Plugins contribute semantic sources
  // (e.g. tracker's IssueStatusChange, card's CardArchived) through
  // their own model packages. The generic three cover every Doc class
  // whose author wires in webhooks without defining a new eventKind.
  builder.createDoc(
    webhooks.class.WebhookEventSource,
    core.space.Model,
    {
      kind: CoreEventKinds.Create,
      sourceClass: core.class.Doc,
      label: webhooks.string.Webhooks
    },
    ('webhooks:eventSource:Create' as unknown) as Ref<Doc>
  )
  builder.createDoc(
    webhooks.class.WebhookEventSource,
    core.space.Model,
    {
      kind: CoreEventKinds.Update,
      sourceClass: core.class.Doc,
      label: webhooks.string.Webhooks
    },
    ('webhooks:eventSource:Update' as unknown) as Ref<Doc>
  )
  builder.createDoc(
    webhooks.class.WebhookEventSource,
    core.space.Model,
    {
      kind: CoreEventKinds.Remove,
      sourceClass: core.class.Doc,
      label: webhooks.string.Webhooks
    },
    ('webhooks:eventSource:Remove' as unknown) as Ref<Doc>
  )

  // Workspace Settings navigator entry. Only workspace Owners see it;
  // the permission middleware refuses writes below Owner regardless, so
  // the role gate here just hides the tab for everyone else.
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
