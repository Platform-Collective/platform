// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import type {
  AccountUuid,
  Class,
  Doc,
  Mixin,
  PersonId,
  Ref,
  Space,
  Timestamp,
  Tx,
  TxCUD
} from '@hcengineering/core'
import type { Asset, IntlString, Plugin, Resource } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

/**
 * @public
 *
 * Opt-in mixin applied by plugins to the Doc classes they want to
 * expose to the webhooks service. A class without this mixin is NOT
 * subscribable, so the webhooks sweeper never reads its Txes.
 *
 * Rev 5's "generic CUD source rooted on `core.class.Doc`" was too
 * broad: it would stream webhook classes themselves (feedback loop),
 * high-volume derived docs (activity messages, notifications, user
 * statuses), and sensitive docs (preferences, credential-bearing
 * integrations, account identity rows). Rev 6 flips to an opt-in
 * mixin.
 *
 * Hard-excluded regardless of this mixin: webhook classes themselves,
 * and anything in `DOMAIN_MODEL`, `DOMAIN_TRANSIENT` or `DOMAIN_TX`.
 */
export interface WebhookSubscribable extends Class<Doc> {
  // Which of the three generic CUD source kinds this class exposes.
  // Defaults to all three if unset.
  events?: Array<'Create' | 'Update' | 'Remove'>
  // Attribute paths that are excluded from `changedAttrs` and
  // `attributeFilter`, because they are large (markup), opaque
  // (blobs), or sensitive even to a reader of the class.
  excludedAttributes?: string[]
  // Semantic sources this class carries, named by their
  // `WebhookEventSource._id`. Must have been declared by the owning
  // plugin's model.
  semanticSources?: Array<Ref<WebhookEventSource>>
}

/**
 * @public
 *
 * Plugin-contributed event source descriptor. The source's `_id`
 * is its kind (there is no separate `kind` field); plugins pass the
 * id as the third argument to `builder.createDoc`.
 *
 * Core webhooks plugin ships three generic CUD sources
 * (`webhooks:eventSource:Create`, `Update`, `Remove`), each with
 * `semantic: false` and no `sourceClass`; they apply to any class
 * carrying the `WebhookSubscribable` mixin.
 *
 * Semantic sources (`semantic: true`) carry a `sourceClass` and are
 * contributed by the owning plugin (tracker, card, process, ...)
 * through their own server-plugin profile.
 *
 * See `docs/webhooks/DESIGN.md` section "Event-source registry" for
 * the full contract.
 */
export interface WebhookEventSource extends Doc {
  // Semantic sources carry a `sourceClass`; generic CUD sources
  // match wherever the subscribable mixin is applied.
  semantic: boolean
  sourceClass?: Ref<Class<Doc>>
  // Optional: the class on whose Tx the match hook runs. Defaults
  // to `sourceClass`. Process events are detected on an
  // `ExecutionLog` create (not the source class), so the hook
  // asks to run on that class instead.
  detectOn?: Ref<Class<Doc>>
  label: IntlString
  icon?: Asset
  // Internal attempt kinds (`test`, `skipped`, `rotated`,
  // `bindingChanged`) are reserved string values on
  // `TWebhookDeliveryAttempt.eventKind`, NOT `WebhookEventSource`
  // ids. `hidden` sources are reserved for service-internal use.
  hidden?: boolean
  // Server-side resource references. The sweeper looks them up
  // through the plugin resource registry. See
  // `plugins/webhooks/src/types.ts` for the function signatures.
  match: Resource<WebhookMatchFn>
  variables: Resource<WebhookVariablesFn>
  renderMinimalBody: Resource<WebhookRenderBodyFn>
  // Optional per-event eligibility. Default: subscription owner
  // has read access to the source doc, which the sweeper checks
  // regardless.
  eligibility?: Resource<WebhookEligibilityFn>
}

/**
 * @public
 *
 * One event the sweeper's match hook has detected on a source Tx.
 * The journal records one entry per matched subscription for every
 * `SourceEvent`.
 */
export interface SourceEvent {
  // Stable id for dedup: `(subscription, eventKind, sourceEventId)`
  // is the dedup triple. The sweeper composes `${txId}:${sourceDoc}`
  // by default; a hook that produces multiple events from one Tx
  // (e.g. ExecutionLog carrying several transitions) appends a
  // suffix.
  sourceEventId: string
  eventKind: Ref<WebhookEventSource>
  sourceClass: Ref<Class<Doc>>
  sourceDoc: Ref<Doc>
  sourceSpace: Ref<Space>
  // Attribute names only. Values are read from the live source doc
  // at render time (rev 6, A4), so plain values never land in
  // `DOMAIN_TX` / Kafka / backups.
  changedAttrs: string[]
  actorPersonId: PersonId
  capturedAt: Timestamp
}

// Server-side resource function type signatures. The sweeper (in
// server-plugins/webhooks, PR 2) imports these; the client bundle
// imports only the Resource ids.
/** @public */
export type WebhookMatchFn = (
  ctx: WebhookMatchContext,
  tx: TxCUD<Doc>,
  preImage: Doc | undefined
) => Promise<SourceEvent[]>

/** @public */
export interface WebhookMatchContext {
  // Reserved for the sweeper to pass workspace + hierarchy helpers.
  // Full shape lives in server-plugins/webhooks in PR 2.
}

/** @public */
export type WebhookVariablesFn = (
  ctx: WebhookRenderContext,
  sourceDoc: Doc
) => Promise<Record<string, unknown>>

/** @public */
export type WebhookRenderBodyFn = (
  ctx: WebhookRenderContext,
  sourceDoc: Doc,
  changedAttrs: string[]
) => Promise<Record<string, unknown>>

/** @public */
export interface WebhookRenderContext {
  // Reserved for render-time workspace + locale helpers.
}

/** @public */
export type WebhookEligibilityFn = (
  ctx: WebhookEligibilityContext,
  subscription: WebhookSubscription,
  event: SourceEvent
) => Promise<boolean>

/** @public */
export interface WebhookEligibilityContext {
  // Reserved.
}

/**
 * @public
 *
 * One of the built-in target presets.
 */
export type WebhookPreset = 'apprise' | 'slack' | 'discord' | 'generic'

/**
 * @public
 *
 * One trigger rule on a subscription. Generic over source class;
 * status / enum / membership filters are expressed via
 * `attributeFilter`.
 */
export interface WebhookTrigger {
  // Must match a registered `WebhookEventSource._id`. If no matching
  // source is registered at delivery time, the trigger is treated
  // as if disabled and audited as `skipped`.
  eventKind: Ref<WebhookEventSource>
  scope:
  | { kind: 'space', space: Ref<Space> }
  | { kind: 'allSpaces' }
  // Narrow the source class to this subclass or mixin. Hierarchy
  // and mixins are honoured by the match step. For a `WebhookEventSource`
  // without `sourceClass` (generic CUD), the save step validates
  // `classFilter` is a class carrying `WebhookSubscribable`.
  classFilter?: Ref<Class<Doc>>
  // Fire only when the named attribute has one of `values`. `attr`
  // is a dotted path; mixin attributes are addressed as
  // `<MixinRef>.<attr>`.
  //
  // Filter semantics (see DESIGN.md A5):
  //  - equality strict for primitives / refs
  //  - arrays: `contains` (an element of `values` appears in the
  //    attribute); array equality not supported in v1
  //  - markup / blob attributes refused in `attributeFilter` at save
  //  - `null` matches `null` only, not missing / undefined
  //  - `on: 'previous'` on a Create does NOT match (false)
  //  - `on: 'new'` on a Remove does NOT match (false)
  attributeFilter?: {
    attr: string
    on: 'previous' | 'new'
    values: unknown[]
  }
  // Opt in to automation-authored Txes (process service, inbound
  // webhook service, workflow-rules mirror). Default false — a
  // Tx whose `modifiedBy` resolves to a known service account is
  // refused by the sweeper so an outbound → external → inbound →
  // change → outbound loop cannot form.
  includeAutomation?: boolean
}

/**
 * @public
 *
 * One header template on a target. `requiresSecret` lets a preset
 * mark the whole header as "drop if this named secret has no value".
 */
export interface WebhookHeaderTemplate {
  name: string
  valueTemplate: string
  requiresSecret?: string
}

/**
 * @public
 *
 * Target config: templated method, URL, headers and body.
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
   * sha256 over the APPROVED CONFIG (templates, method, content
   * type, URL template, header names and value templates, body
   * template, sorted list of referenced secret names). NOT over
   * rendered values. Service-maintained.
   */
  configDigest: string
  configDigestAlg: 'sha256'
  boundAt: Timestamp
}

/**
 * @public
 *
 * Retry policy with a per-subscription override on the global replay
 * horizon.
 */
export interface WebhookRetryPolicy {
  maxRetries: number
  initialBackoffMs: number
  backoffFactor: number
  jitterMs: number
  timeoutMs: number
  /**
   * Can only LOWER the service-global replay horizon.
   */
  replayHorizonSeconds?: number
}

/**
 * @public
 *
 * Metadata about a named secret. The actual value lives in the
 * `TWebhookSecret` collection, service-write only, AEAD-encrypted
 * with AAD reconstructed from the authenticated context on every
 * decrypt.
 */
export interface WebhookSecretMeta {
  name: string
  lastRotatedAt: Timestamp
}

/**
 * @public
 *
 * A webhook subscription attached to a workspace. See the design
 * doc for the authorization model (permission middleware refuses
 * destination-level writes before storage; destination changes go
 * through the service-authored management RPC only), the
 * destination binding, and the Tx-log sweeper delivery pipeline.
 *
 * Pinned to the dedicated private webhooks space (`webhooks.space.Webhooks`).
 *
 * Immutable fields enforced by the permission middleware (service
 * token only): `space`, `owner`, `revision`, `target.*`, `triggers`,
 * `retryPolicy`, `storeResponseBody`, `secretsMeta`, `lastDelivery*`.
 */
export interface WebhookSubscription extends Doc {
  space: Ref<Space>

  name: string

  /**
   * The account whose source-read permissions gate every delivery
   * and every destination-changing management action. Immutable
   * after create.
   */
  owner: AccountUuid

  target: WebhookTarget

  /**
   * Monotonic revision. Service-incremented on every destination-
   * changing RPC save.
   */
  revision: number

  secretsMeta: WebhookSecretMeta[]

  triggers: WebhookTrigger[]

  retryPolicy?: WebhookRetryPolicy

  enabled: boolean

  /**
   * Opt-in: receiver response body persisted in audit (default
   * false). The management RPC resets this to false on every
   * destination-changing save so a URL swap does not accidentally
   * start retaining credential-echo responses.
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
 * Named secret stored for a subscription. Service-write only.
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
 * Journal entry. Written by the Tx-log sweeper (`DOMAIN_WEBHOOKS`,
 * single-domain atomic). Stores identifiers and attribute NAMES
 * only; values are read from the live source doc at render time
 * (rev 6, A4), so plain values never land in `DOMAIN_TX` / Kafka /
 * backups.
 */
export interface WebhookJournal extends Doc {
  space: Ref<Space>
  state: 'pending' | 'in_realization' | 'realized' | 'failed'
  sourceEvent: {
    sourceEventId: string
    txId: Ref<Tx>
    eventKind: Ref<WebhookEventSource>
    sourceClass: Ref<Class<Doc>>
    sourceDoc: Ref<Doc>
    sourceSpace: Ref<Space>
    actorPersonId: PersonId
    changedAttrs: string[]
    capturedAt: Timestamp
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
 * One outbox row per `(subscription, eventKind, sourceEventId)`.
 * The rendered request bytes are stored in diagnostic
 * `[SECRET:<name>]` form; the delivery worker substitutes secrets
 * just before the HTTP call (rev 6, B2), so plain secret values
 * never reach `DOMAIN_TX` / Kafka / backups.
 */
export interface WebhookOutboxJob extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  revision: number
  eventKind: Ref<WebhookEventSource>
  sourceEventId: string
  deliveryId: string
  journal: Ref<WebhookJournal>
  txId: Ref<Tx>
  frozenRequest: {
    method: 'POST' | 'PUT'
    // Diagnostic form only. The URL template has already been
    // rendered against the source doc; secret slots keep their
    // `[SECRET:<name>]` placeholder, substituted at send time.
    url: string
    headers: Array<{ name: string, value: string }>
    bodyBytes: Buffer
    configDigestAtRealize: string
    renderedAt: Timestamp
    // Capture-time sequence number. Outbox ordering reads this, NOT
    // `nextAttemptAt`, so a job in backoff is not overtaken by a
    // newer job for the same subscription (rev 6, should-fix).
    captureSeq: number
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
 * The sensitive rendered content lives in the blob store
 * (`blobId`), NOT inline on this row.
 */
export interface WebhookDeliveryAttempt extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  deliveryId: string
  attempt: number
  // A reserved internal attempt kind (`test`, `skipped`, `rotated`,
  // `bindingChanged`) OR a registered `WebhookEventSource._id`.
  eventKind: Ref<WebhookEventSource> | 'test' | 'skipped' | 'rotated' | 'bindingChanged'
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
  // Body hash is computed AFTER secret substitution (at send time);
  // stored here so audit can verify integrity without re-sending.
  bodyBytesHash?: string
}

/**
 * @public
 *
 * Encrypted audit payload. Lives in the workspace blob adapter
 * (object storage), NOT inline on this row (rev 6 platform
 * assumption fix: a Tx-written TDoc with inline ciphertext IS in Tx
 * history, defeating the purpose). The row carries only the blob
 * key + nonce + tag + key ids + size for quota accounting.
 */
export interface WebhookAuditBlob extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  deliveryId: string
  attempt: number
  blobId: string
  blobBytes: number
  masterKeyId: string
  dekVersion: number
  nonce: Buffer
  tag: Buffer
  at: Timestamp
}

/**
 * @public
 *
 * Subscription-wide lease for ordered delivery.
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
 * both the document and its history pruning complete.
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
  mixin: {
    // Applied by plugins to `core.class.Class` on classes they want
    // webhooks to see (rev 6, A1).
    WebhookSubscribable: '' as Ref<Mixin<WebhookSubscribable>>
  },
  space: {
    // Dedicated private space holding every webhook doc for a
    // workspace. Members = current workspace Owners + the webhooks
    // service. Space-security covers read, Tx-history and broadcast
    // (rev 6, A2).
    Webhooks: '' as Ref<Space>
  },
  string: {
    Webhooks: '' as IntlString,
    ConfigLabel: '' as IntlString,
    ConfigDescription: '' as IntlString,
    CreateEvent: '' as IntlString,
    UpdateEvent: '' as IntlString,
    RemoveEvent: '' as IntlString
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
