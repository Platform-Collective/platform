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
 * One of three issue events v1 supports. See `docs/webhooks/DESIGN.md`
 * for the full event roster planned for v2 (Doc, Membership) and the
 * variable set each event ships.
 */
export type WebhookEvent = 'IssueCreated' | 'IssueUpdated' | 'IssueStatusChange'

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
 * Which status side a `statusFilter` matches against. The issue carries
 * both at delivery time, so the filter is explicit.
 */
export type WebhookStatusSide = 'previous' | 'new'

/**
 * @public
 *
 * One trigger rule on a subscription. `projectScope` is explicit: either
 * a specific project OR the all-projects marker. The design doc refuses
 * `allProjects` + a `statusFilter` at save because status refs are
 * per-TaskType and cannot be matched consistently across TaskTypes.
 */
export interface WebhookTrigger {
  event: WebhookEvent
  projectScope:
  | { kind: 'project', projectId: Ref<Doc> } // Ref<Project>; typed via Doc to avoid a plugin cycle
  | { kind: 'allProjects' }
  statusFilter?: {
    on: WebhookStatusSide
    statuses: Array<Ref<Doc>> // Ref<IssueStatus>; see above
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
 * Immutable fields enforced by the permission middleware: `owner`,
 * `revision`, `target.configDigest`, `target.boundAt`, `secretsMeta`,
 * `lastDelivery*`. Those are service-maintained.
 */
export interface WebhookSubscription extends Doc {
  // Doc.space is Ref<Space> by Platform's typing. The subscription's
  // space is the workspace's dedicated settings space. The service
  // NEVER routes by this field; routing uses the authenticated
  // WorkspaceUuid.
  space: Ref<Space>

  name: string

  /**
   * The account whose source-read permissions gate every delivery and
   * every management action that targets this subscription. Immutable
   * after create. Owner B without source access to A's project cannot
   * mutate A's destination; see the design doc section
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
 * Captured in the Tx middleware for every eligible source Tx. The
 * pre-image is read inside the pipeline before the apply, so a crash
 * before realization still leaves the journal entry visible to the
 * sweeper. See the design doc section "Durable outbox".
 */
export interface WebhookJournal extends Doc {
  space: Ref<Space>
  state: 'pending' | 'in_realization' | 'realized' | 'failed'
  sourceTx: {
    txId: Ref<Tx>
    event: WebhookEvent
    issueRef: Ref<Doc>
    projectRef: Ref<Doc>
    actorPersonId: string
    previousStatusRef: Ref<Doc> | null
    newStatusRef: Ref<Doc> | null
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
 * One outbox row per `(subscriptionId, event, txId)`. Dedup key is the
 * full triple so a Tx firing both `IssueUpdated` and
 * `IssueStatusChange` produces two distinct jobs. The rendered request
 * bytes are frozen here at realize time; retries reuse those exact
 * bytes.
 */
export interface WebhookOutboxJob extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  revision: number
  event: WebhookEvent
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
 * gated on current source access to the referenced issue.
 */
export interface WebhookDeliveryAttempt extends Doc {
  space: Ref<Space>
  subscription: Ref<WebhookSubscription>
  deliveryId: string
  attempt: number
  event: WebhookEvent | 'test' | 'skipped' | 'rotated' | 'bindingChanged'
  txId: Ref<Tx>
  issueRef: Ref<Doc>
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
 * payloads. Non-broadcast; AEAD-encrypted with AAD reconstructed from
 * the authenticated context on every decrypt. See the design doc
 * section "Audit".
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
 * processes outbox rows for that subscription. The lease has a short
 * TTL (default 30 s) and is renewed while the worker is actively
 * processing. See the design doc section "Ordering, claiming,
 * backlog".
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
    WebhookCleanupTask: '' as Ref<Class<WebhookCleanupTask>>
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
