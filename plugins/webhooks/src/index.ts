// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import type { AccountUuid, Class, Doc, Ref, Space, Timestamp, Tx } from '@hcengineering/core'
import type { Asset, IntlString, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

/**
 * @public
 *
 * Plugin-contributed event source descriptor. Each registered source
 * declares a semantic event (its `kind`) that fires on a particular
 * Doc class. Plugins register sources at model-build time with
 * `builder.createDoc(webhooks.class.WebhookEventSource, ...)`. The
 * webhooks service matches a source Tx against subscriptions by
 * joining on `kind` + hierarchy check on `sourceClass`.
 *
 * The core webhooks plugin ships three generic CUD sources
 * (`webhooks:event:Create`, `webhooks:event:Update`, `webhooks:event:Remove`)
 * that fire for ANY Doc class a subscription's `classFilter` matches.
 * Semantic sources (e.g. `tracker:event:IssueStatusChange`,
 * `card:event:CardArchived`) are contributed by the owning plugin
 * when they land.
 *
 * See `docs/webhooks/DESIGN.md` section "Event sources" for the full
 * contract.
 */
export interface WebhookEventSource extends Doc {
  // Stable identifier the subscription references. Namespaced by the
  // contributing plugin, e.g. `tracker:event:IssueStatusChange`.
  kind: string
  // The Doc class this event is about. The service enforces hierarchy
  // at match time, so a `tracker.class.Issue` source also fires for a
  // subclass unless `classFilter` on the trigger narrows further.
  sourceClass: Ref<Class<Doc>>
  // Human-friendly label for the subscription UI.
  label: IntlString
  // Optional icon in the UI picker.
  icon?: Asset
  // Hidden sources are reserved for service-internal use (e.g. test
  // events); the UI picker filters them out.
  hidden?: boolean
}

/**
 * @public
 *
 * One of the built-in target presets. A preset ships fully resolved
 * templates at pick time; the stored subscription keeps those templates
 * so a later preset bump does not change a live subscription silently.
 * `generic` is the bare path (user writes templates themselves).
 */
export type WebhookPreset = 'apprise' | 'slack' | 'discord' | 'generic'

/**
 * @public
 *
 * One trigger rule on a subscription. Generic over source class via
 * `classFilter`; status / enum / membership filters are expressed via
 * `attributeFilter`.
 */
export interface WebhookTrigger {
  // Must match a registered `WebhookEventSource.kind`. If no matching
  // source is registered at delivery time, the trigger is treated as
  // if disabled and audited as `skipped`.
  eventKind: string
  // Scope: a specific space, or "all spaces the service can see for the
  // subscription owner". `allSpaces` on a kind that has a space-local
  // meaning (e.g. tracker issue status changes) must be paired with a
  // `classFilter` that narrows to a class whose status model is stable
  // across spaces, OR must drop any `attributeFilter` on status - the
  // save step refuses incoherent combinations.
  scope:
  | { kind: 'space', space: Ref<Space> }
  | { kind: 'allSpaces' }
  // Narrow the source class to this subclass or mixin. Hierarchy and
  // mixins are honoured by the match step.
  classFilter?: Ref<Class<Doc>>
  // Attribute predicate: fire only when the named attribute on the
  // source doc has one of `values`. The `on` side chooses pre-image or
  // post-image. For CUD events the pre-image is the stored doc and the
  // post-image is the applied doc; for a Create event, `previous` is
  // empty and the predicate is skipped on that side.
  attributeFilter?: {
    attr: string
    on: 'previous' | 'new'
    values: unknown[]
  }
}

/**
 * @public
 *
 * One header template on a target. `requiresSecret` lets a preset mark
 * the whole header as "drop if this named secret has no value" so an
 * Apprise install without a bearer renders without an empty
 * `Authorization` header. See the "Apprise optional Authorization" fix
 * in `docs/webhooks/DESIGN.md`.
 */
export interface WebhookHeaderTemplate {
  name: string
  valueTemplate: string
  requiresSecret?: string
}

/**
 * @public
 *
 * Target config: templated method, URL, headers and body. The design
 * doc describes the binding + rendering rules in detail; see
 * `docs/webhooks/DESIGN.md`.
 */
export interface WebhookTarget {
  preset?: WebhookPreset
  method: 'POST' | 'PUT'
  urlTemplate: string
  headerTemplates: WebhookHeaderTemplate[]
  bodyTemplate?: string
  useMinimalBody?: boolean
  contentType?: string

  /**
   * sha256 over the approved CONFIG (method, content type, URL template,
   * header names and value templates, body template, sorted list of
   * referenced secret names). Service-maintained; a client Tx that tries
   * to set this is refused by the permission middleware. Rendered
   * destination constraints (SSRF, host literal, header validity) are a
   * separate per-attempt validation.
   */
  configDigest: string
  configDigestAlg: 'sha256'
  boundAt: Timestamp
}

/**
 * @public
 *
 * Retry policy, with a per-subscription override on the global replay
 * horizon. See `docs/webhooks/DESIGN.md` for the delivery pipeline
 * contract.
 */
export interface WebhookRetryPolicy {
  maxRetries: number
  initialBackoffMs: number
  backoffFactor: number
  jitterMs: number
  timeoutMs: number
  /**
   * Subscription-level override of the service-global replay horizon
   * advertised to receivers in `X-Huly-Replay-Window`. Can only LOWER
   * the horizon; a value above the service ceiling is clamped.
   */
  replayHorizonSeconds?: number
}

/**
 * @public
 *
 * Metadata about a named secret stored for a subscription. The actual
 * value lives in the `TWebhookSecret` collection, service-write only,
 * encrypted with AEAD whose associated data is reconstructed from the
 * authenticated context on every decrypt (not from any field on the
 * row). The design doc describes the full scheme.
 *
 * NOTE: no `lastFour` field. A secret of four characters or fewer would
 * be fully leaked by a suffix; the UI shows name + rotation time only.
 */
export interface WebhookSecretMeta {
  name: string
  lastRotatedAt: Timestamp
}

/**
 * @public
 *
 * A webhook subscription attached to a workspace. See the design doc
 * for the authorization model (permission middleware refuses non-Owner
 * writes before storage), the destination binding, and the delivery
 * pipeline (journal + outbox + lease).
 *
 * Immutable fields enforced by the permission middleware: `space`,
 * `owner`, `revision`, `target.configDigest`, `target.boundAt`,
 * `secretsMeta`, `lastDelivery*`. Those are service-maintained.
 */
export interface WebhookSubscription extends Doc {
  // The subscription lives in the workspace's dedicated settings
  // space. The space itself is pinned (service-only writable); the
  // service never routes by this field, routing uses the authenticated
  // WorkspaceUuid.
  space: Ref<Space>

  name: string

  /**
   * The account whose source-read permissions gate every delivery and
   * every destination-changing management action on this subscription.
   * Immutable after create. Owner B without source access to A's
   * project cannot change A's destination; see the design doc section
   * "Owner-authorized destination changes".
   */
  owner: AccountUuid

  target: WebhookTarget

  /**
   * Monotonic revision. Service-incremented on every destination-
   * changing save. Jobs carry this at enqueue; delivery refuses an
   * attempt whose revision is older than the current one.
   */
  revision: number

  secretsMeta: WebhookSecretMeta[]

  triggers: WebhookTrigger[]

  retryPolicy?: WebhookRetryPolicy

  enabled: boolean

  /**
   * Opt-in: receiver response body persisted in audit (default false).
   * Reset to false on every destination-changing save so a URL swap
   * does not accidentally start retaining credential-echo responses.
   * Permission middleware treats this as destination-changing (stored
   * owner required) to match that semantic.
   */
  storeResponseBody: boolean

  lastDeliveryAt?: Timestamp
  lastDeliveryStatus?: 'ok' | 'error' | 'skipped'
  lastDeliveryHttpCode?: number
  lastDeliveryError?: string
}

/**
 * @public
 *
 * Named secret stored for a subscription. Service-write only. The row
 * holds only the ciphertext and the key identifiers; the AAD is NOT
 * read from the row on decrypt. See the design doc section "Secrets".
 */
export interface WebhookSecret extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  name: string
  masterKeyId: string
  dekVersion: number
  ciphertext: Buffer
  nonce: Buffer
  tag: Buffer
  lastRotatedAt: Timestamp
}

/**
 * @public
 *
 * One field change observed in a source Tx. `attr` is a dotted path
 * into the source doc; `prev` is the pre-image value and `next` is the
 * post-image. For a Create event, every observed attribute has an
 * undefined `prev`; for a Remove event, every attribute has an
 * undefined `next`. For an Update event, only the attributes that
 * actually changed appear here.
 */
export interface WebhookSourceChange {
  attr: string
  prev: unknown
  next: unknown
}

/**
 * @public
 *
 * Captured in the Tx middleware for every eligible source Tx. The
 * pre-image is read inside the pipeline before the apply, so a crash
 * before realization still leaves the journal entry visible to the
 * sweeper. See the design doc section "Durable outbox".
 *
 * `sourceEventId` is the service-assigned stable identifier for this
 * event. For a plain Tx-sourced event it is `${txId}:${sourceDoc}` so
 * a single process-service `TxApplyIf` holding multiple inner CUDs
 * generates distinct sourceEventIds even though they share a `txId`.
 * The delivery dedup key is `(subscription, eventKind, sourceEventId)`.
 */
export interface WebhookJournal extends Doc {
  space: Ref<Space>
  state: 'pending' | 'in_realization' | 'realized' | 'failed'
  sourceTx: {
    sourceEventId: string
    txId: Ref<Tx>
    eventKind: string
    sourceClass: Ref<Class<Doc>>
    sourceDoc: Ref<Doc>
    sourceSpace: Ref<Space>
    actorPersonId: string
    changes: WebhookSourceChange[]
    txModifiedOn: Timestamp
  }
  matchedSubscriptions: Array<{ subscriptionId: Ref<WebhookSubscription>, revision: number }>
  attemptCount: number
  lastAttemptAt: Timestamp | null
  createdAt: Timestamp
}

/**
 * @public
 *
 * One outbox row per `(subscription, eventKind, sourceEventId)`. Dedup
 * is on the triple so a Tx that generates two eventKinds for the same
 * source doc produces two rows, and a `TxApplyIf` that applies several
 * inner Txes against the same source class produces one row per inner
 * Tx. The rendered request bytes are frozen here at realize time;
 * retries reuse those exact bytes.
 */
export interface WebhookOutboxJob extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  revision: number
  eventKind: string
  sourceEventId: string
  deliveryId: string
  journal: Ref<WebhookJournal>
  txId: Ref<Tx>
  frozenRequest: {
    method: 'POST' | 'PUT'
    url: string
    headers: Array<{ name: string, value: string }>
    bodyBytes: Buffer
    bodyBytesHash: string
    configDigestAtRealize: string
    renderedAt: Timestamp
  }
  state: 'pending' | 'in_flight' | 'done' | 'failed' | 'quarantined'
  attempts: number
  nextAttemptAt: Timestamp | null
  terminalReason: string | null
  claimedUnderLease: string | null
}

/**
 * @public
 *
 * Audit metadata row. Carries identifiers + outcome + error reason.
 * The sensitive rendered content lives in `WebhookAuditBlob`, read-
 * gated on current source access to the referenced source doc.
 *
 * Generic over source class: `sourceClass` + `sourceDoc` identify what
 * fired. The delivery service re-resolves to the concrete class when
 * it needs to check current source access.
 */
export interface WebhookDeliveryAttempt extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  deliveryId: string
  attempt: number
  eventKind: string | 'test' | 'skipped' | 'rotated' | 'bindingChanged'
  txId: Ref<Tx>
  sourceClass: Ref<Class<Doc>>
  sourceDoc: Ref<Doc>
  sourceSpace: Ref<Space>
  at: Timestamp
  outcome: 'ok' | 'error' | 'skipped' | 'denied'
  httpCode?: number
  errorReason?: string
  blobId?: string
  omittedHeaders?: string[]
}

/**
 * @public
 *
 * Encrypted blob holding rendered-request + rendered-response audit
 * payloads. Non-broadcast domain; the AAD is reconstructed from the
 * authenticated context on every decrypt. See the design doc section
 * "Audit".
 */
export interface WebhookAuditBlob extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  deliveryId: string
  attempt: number
  blobId: string
  masterKeyId: string
  dekVersion: number
  ciphertext: Buffer
  nonce: Buffer
  tag: Buffer
  at: Timestamp
}

/**
 * @public
 *
 * Subscription-wide lease for ordered delivery. Only the lease-holder
 * processes outbox rows for that subscription (see
 * `docs/webhooks/DESIGN.md` section "Ordering, claiming, backlog").
 * Lease TTL is renewed while the worker is actively processing; a
 * crashed worker's lease expires and another worker takes over.
 */
export interface WebhookSubscriptionLease extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  holder: string
  expiresAt: Timestamp
}

/**
 * @public
 *
 * Durable cleanup intent. Recorded before any delete; retained until
 * both the document and its history pruning complete. Guards against
 * leaving confidential history indefinitely when a `TxRemoveDoc`
 * succeeds but the history-prune step fails. See the design doc
 * section "Cleanup worker".
 */
export interface WebhookCleanupTask extends Doc {
  space: Ref<Space>
  targets: Array<{ collection: string, docId: Ref<Doc> }>
  state: 'pending' | 'documentsRemoved' | 'historyPruned' | 'done'
  attempts: number
  lastError?: string
  createdAt: Timestamp
}

/** @public */
export const webhooksId = 'webhooks' as Plugin

/**
 * @public
 *
 * Reserved event kinds the core webhooks plugin ships. Plugin-
 * contributed sources use their own namespaced kinds
 * (e.g. `'tracker:event:IssueStatusChange'`).
 */
export const CoreEventKinds = {
  // Generic CUD; fires on any Doc class a trigger's `classFilter`
  // selects.
  Create: 'webhooks:event:Create',
  Update: 'webhooks:event:Update',
  Remove: 'webhooks:event:Remove',
  // Reserved internal kinds used in audit attempts (never bound to a
  // trigger).
  Test: 'test',
  Skipped: 'skipped',
  Rotated: 'rotated',
  BindingChanged: 'bindingChanged'
} as const

/** @public */
const webhooks = plugin(webhooksId, {
  class: {
    WebhookSubscription: '' as Ref<Class<WebhookSubscription>>,
    WebhookSecret: '' as Ref<Class<WebhookSecret>>,
    WebhookJournal: '' as Ref<Class<WebhookJournal>>,
    WebhookOutboxJob: '' as Ref<Class<WebhookOutboxJob>>,
    WebhookDeliveryAttempt: '' as Ref<Class<WebhookDeliveryAttempt>>,
    WebhookAuditBlob: '' as Ref<Class<WebhookAuditBlob>>,
    WebhookSubscriptionLease: '' as Ref<Class<WebhookSubscriptionLease>>,
    WebhookCleanupTask: '' as Ref<Class<WebhookCleanupTask>>,
    WebhookEventSource: '' as Ref<Class<WebhookEventSource>>
  },
  string: {
    Webhooks: '' as IntlString,
    ConfigLabel: '' as IntlString,
    ConfigDescription: '' as IntlString
  },
  icon: {
    Webhooks: '' as Asset
  },
  component: {
    WebhooksSettings: '' as AnyComponent
  }
})

/** @public */
export default webhooks
