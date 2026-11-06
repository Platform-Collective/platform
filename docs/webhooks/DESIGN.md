# Outbound webhook subscriptions

## Status: Design (rev 7)

This document is the design proposal for the outbound webhook feature
discussed in Platform-Collective/platform discussion #236 and issue #33.
No code lives on `feature/webhooks-design`; this doc is the whole PR.

The feature lets a workspace Owner subscribe an outbound HTTP endpoint
to Tx events in the workspace. Method, URL, headers and body are all
templated; named secrets go through a dedicated `{{ secrets.<name> }}`
namespace that never renders into logs, previews or audit rows. One
target kind (`generic`) handles every receiver via templates plus
built-in presets for `apprise`, `slack`, `discord` and bare `generic`.

Events are plugin-contributed through a `WebhookEventSource` registry.
A Doc class must opt in by applying the `WebhookSubscribable` mixin;
by default no Doc is subscribable, so the subscription registry does
NOT silently expose derived docs, notifications, user statuses, or
preference / credential rows. The core webhooks plugin ships three
generic CUD source kinds; a semantic event (tracker's
`IssueStatusChange`, card's `CardArchived`, process's
`StageTransition`) is a server-plugin profile with a `match` hook that
reads the Tx + pre-image and returns zero or more source events,
plus a `variables` schema and a `renderMinimalBody` function.

All webhook docs live in a dedicated private space
(`webhooks.space.Webhooks`, `SystemSpace`, `private: true`, members =
current workspace Owners + the webhooks service). Reads, Tx-history
queries, and live broadcast are all gated by the existing space
security; the permission middleware adds a defence-in-depth
class-level gate on top. Destination-level writes go only through a
service-owned management RPC — the middleware refuses them from any
client, including the stored owner. The RPC recomputes
`revision` + `configDigest` and enforces secret re-entry in one
atomic step, closing the "direct Tx leaves `configDigest` stale"
hole.

Delivery is driven by a Tx-log sweeper. `TxMiddleware` persists the
source Tx to `DOMAIN_TX` before the domain apply; the sweeper reads
Tx log tail-forward, resolves each Tx through the registered match
hooks, and writes idempotent outbox rows deduplicated by the event
identity `(subscription, eventKind, sourceEventId)`, with outbox
rows unique per `generation`. This closes the
cross-domain atomicity gap in rev 4's "same storage transaction"
story. Pre-image values live in a separate encrypted journal payload,
NOT inline in the journal row.

Secrets live in an AEAD-encrypted blob store whose AAD is
reconstructed from the authenticated context on every decrypt. The
frozen request stores a diagnostic form with `[SECRET:<name>]`
placeholders; secrets are substituted at send time, so secret
values never reach `DOMAIN_TX`, Kafka or backups. Signatures use a
formal versioned header grammar with repeated headers during key
rotation.

### Revision history

- **Rev 1** (`7831133506`): first draft. Separate `apprise` target
  kind; secret stored in the body.
- **Rev 2** (`cc250b7575`): collapsed `apprise` into a preset of
  `generic`; added named `{{ secrets.<name> }}` namespace with
  redaction; disabled redirects; HMAC v=2 covered timestamp +
  delivery id.
- **Rev 3** (`c46a6e4d98`): rebuilt around MichaelUray's rev-2
  review. AEAD secrets with HKDF-derived DEKs; destination binding
  replacing single-host comparison; per-attempt eligibility re-check;
  outbox job collection with full dedup key; placeholder-first
  redaction.
- **Rev 4** (`ac6f39f48a`): addresses MichaelUray's rev-3 review.
  8 must-fix items and 9 should-clarify items reshape Authorization,
  Secrets, Delivery, Signing, Audit and Restore. Three new open
  questions settled with his answers.
- **Rev 5** (`2366d2f270`): addresses ArtyomSavchenko's review. Two
  blocking authz-bypass items (dotted keys + operators bypass the
  stored-owner / service-only guard; no read-side gating) are fixed in
  the middleware shape. The model generalises off Issue-specific
  references: closed `WebhookEvent` union replaced with a plugin-
  contributed `WebhookEventSource` registry; `issueRef` /
  `projectRef` / `previousStatusRef` / `newStatusRef` replaced with
  `sourceClass` + `sourceDoc` + `sourceSpace` + a `changes` array;
  dedup key moved to `(subscription, eventKind, sourceEventId)`;
  `projectScope`/`statusFilter` replaced with a generic
  `scope` + `classFilter` + `attributeFilter` triple.
- **Rev 6** (this revision): addresses ArtyomSavchenko's rev-5
  review. The subscribable scope is narrowed from "any `Doc` by
  default" to an opt-in `WebhookSubscribable` mixin plugins apply
  per class; webhook classes, `DOMAIN_MODEL`, `DOMAIN_TRANSIENT`
  and `DOMAIN_TX` are hard-excluded regardless. All webhook docs
  move into a dedicated private space
  (`webhooks.space.Webhooks`), so Tx-history reads and live
  broadcast are gated by existing space security — the "non-
  broadcast domain" invention is dropped. The event-source registry
  gains server-side `match` + `variables` + `renderMinimalBody` +
  `eligibility` hooks (plugin-contributed through `server-plugins/*`);
  the Doc `_id` is the kind (no separate `kind` field). The journal
  stores attribute **names** only, values are re-read at realize
  time, so plain values never land in `DOMAIN_TX` / Kafka / backups.
  `frozenRequest` stores the diagnostic `[SECRET:<name>]` form;
  secrets substitute at send time only. Destination-level writes
  now go through the management RPC only — the middleware refuses
  them from every client including the stored owner, closing the
  stale-`configDigest` + skipped-secret-re-entry hole. Delivery is
  driven by a Tx-log sweeper on `DOMAIN_TX`, not a journal written
  in the pipeline. SSRF tables add NAT64 (`64:ff9b::/96`,
  `64:ff9b:1::/48`), `ff00::/8`, `2001:db8::/32`, `100::/64`, and
  switch to `ipaddr.js` `range() === 'unicast'`; `224.0.0.0/4`
  relabelled multicast. Ordering is by capture-time sequence
  rather than `nextAttemptAt`. Fan-out cap enforced at save, not
  at realize. Loop protection for automation-authored Txes
  (triggers, inbound webhook service, process service) is
  specified explicitly. Remaining Issue-specific sections (minimal
  body, template variables, "where previousStatus comes from",
  UI, Apprise preset) rewritten against a generic
  `{{ source.* }}` / `{{ doc.<attr> }}` / `{{ changes }}` namespace,
  with the tracker variables shipped as the tracker source's
  profile. `TWebhookAuditBlob` moves to an object-storage blob
  (`blobId` only, no inline ciphertext). Ownership transfer
  requires pausing + re-confirming destination + re-entering
  secrets. Replica agreement on active key before encrypt;
  retired keys stay decrypt-only.
- **Rev 7** (this revision): addresses MichaelUray's rev-6 review.
  Seven blocking delivery-contract items. (M1 L1268) delivery
  contract narrowed to **capture-at-realize fidelity** with the
  Tx log acting as a trigger, not an authoritative payload;
  platform assumption added that `DOMAIN_TX` only carries applied
  Txes; realize-time render detects source-doc / Tx-intent
  mismatches and skips with `source_mismatch`. (M2 L979) `Remove`
  events are explicitly **excluded from v1**; subscribers detect
  deletions by polling the source API or waiting for v2's
  tombstone support, pre-image snapshot storage deferred.
  (M3 L1392) Secret rotation now **cancels affected pending
  deliveries** (`terminalReason: 'secretRotated'`) and enqueues
  fresh outbox rows with new `deliveryId`s, preserving the L1167
  one-deliveryId-one-frozenRequest invariant. (M4 L1160)
  Signature freshness window (`replayHorizonSeconds`, default
  300 s) separated from **idempotency-ID retention**
  (`idempotencyIdRetentionHours`, default 25 h, must span max
  retry lifetime); both documented with sizing rules. (M5 L1448)
  Within-lease ordering is now `(captureSeq ASC, attempt ASC)`;
  `nextAttemptAt` is only a "not before" admission gate so a job
  in backoff is never overtaken by a newer job. (M6 L1644)
  Restore guard is **set FIRST**, before any data is restored,
  and a "paused for restore" marker is persisted per subscription;
  the restore proceeds, then the guard is released
  subscription-by-subscription as each is verified. (M7 L1465)
  Fan-out cap enforced at **subscription-save time**: the RPC
  rejects a create / update whose projected AGGREGATE matching
  cardinality (summed across every event kind the save's
  triggers could co-emit from a single source Tx, not per-kind
  in isolation) would exceed `maxFanoutPerTx`, with error code
  `fanout_cap_exceeded`; the realize-time fallback stays as a
  safety net and also sums across all kinds matched for the
  current Tx (M7, M7').

## Open questions, settled

| # | Question | Answer (from rev-3 review) |
|---|---|---|
| 1 | Service naming | `services/webhooks/pod-webhooks` |
| 2 | Settings tab | Workspace settings > Webhooks, Owner-only |
| 3 | Expression language | None in v1 |
| 4 | Second-Owner for destination changes | **Opt-in workspace policy, off by default**. Re-entering every referenced secret stays the default protection; many self-hosted workspaces have a single Owner, so a mandatory second approval would block them. |
| 5 | `WEBHOOKS_MASTER_KEY` | **Required at service start**. The service refuses to start without it; a one-line key-generation command in the deployment docs keeps the self-hoster path easy. |
| 6 | `replayHorizonSeconds` | **Default 300 s** (matches Stripe / Slack); subscription-level override allowed for sensitive receivers. |

## Why outbound

Teams run external integrations today by polling Huly's API from an
external worker with a long-lived token. Hoisting the outbound into
the platform removes the external component, keeps the subscription
set in the same backup as the workspace, and lets a non-engineer admin
maintain it from workspace settings.

## Scope

In scope for v1:

- Opt-in events on any Doc class a plugin applies the
  `WebhookSubscribable` mixin to. The core plugin applies no
  mixins; tracker, card, and process each ship their own in
  follow-up PRs. The generic CUD event kinds
  (`webhooks:eventSource:Create`, `Update`, `Remove`) plus any
  semantic sources those plugins contribute.
- Workspace Owner-managed subscriptions, per-workspace.
- Space and attribute filters per subscription (specific space OR
  explicit all-spaces marker, with hierarchy-aware `classFilter`
  and `attributeFilter`).
- One target kind `generic` (templated method / URL / headers / body)
  with built-in presets for `apprise`, `slack`, `discord` and bare
  `generic`.
- Named, write-only secrets with authenticated encryption; AAD
  reconstructed from authenticated context on every decrypt.
- SSRF protection: public-only by default; IP-literal normalization;
  every A/AAAA validated per attempt; connection pinned to the
  validated IP; proxy transport pinned to that IP as well; no
  implicit proxy; redirects disabled.
- Signatures use a versioned grammar with repeated headers during
  key rotation; payload is immutable per `deliveryId`.
- Delivery outside the transactor hot path: a Kafka-group consumer
  that acknowledges after durable outbox handoff (NOT after terminal
  HTTP), subscription-wide ordered leases over the outbox, bounded
  retry + quarantine, backlog + fan-out quotas.
- Audit payloads live outside ordinary Tx history (dedicated encrypted
  blob store); audit reads require current source access.
- Restore ALWAYS pauses subscriptions, regardless of UUID or key
  recovery.
- Per-subscription audit history and a Send-test-event action; test
  returns status + approved metadata only by default.

Explicitly out of v1: Doc + Membership events, per-user personal
subscriptions, cross-workspace fan-out, expression language, inbound
HTTP (#33).

## Coordination with #33 (inbound) and #238 (workflow-rules)

Three parallel features touch "events across the Huly boundary":

- **Outbound (this)** — Huly to external.
- **#33 (inbound)** — external to Huly. Draft at
  thomas-bouvier/platform:feat/webhook.
- **#238 (workflow-rules)** — project-to-project status mirror,
  internal only. In review.

Shared conventions (open to counter-proposal from @thomas-bouvier):

| Concern | Convention |
|---|---|
| Service layout | `services/<feature>/pod-<feature>` for both; no runtime cross-dependency. |
| Secret storage | The AEAD scheme in [Secrets](#secrets); shared by both. |
| UI home | Workspace settings; admin-only; NOT the per-user Integrations category. |
| Rate limits | Sliding window keyed on `(workspace, subscriptionId)` for outbound; analogous for inbound. |
| Audit storage | Dedicated encrypted blob store, outside ordinary Tx history. |
| Permission to manage | Workspace Owner for both; opt-in via Settings > Configure like #238. |

## Shape of a subscription

```ts
interface WebhookSubscription extends Doc {
  // Pinned to `webhooks.space.Webhooks`, a dedicated private
  // SystemSpace that holds every webhook doc (subscriptions,
  // secrets, journal, outbox, delivery attempts, audit blob rows,
  // lease, cleanup tasks). Members = current workspace Owners +
  // the webhooks service. The permission middleware refuses any
  // client Tx that tries to move a subscription out of this
  // space, in any form. Space-security covers Tx history reads
  // and live broadcast as a result (A2).
  space: Ref<Space>

  name: string

  // The account whose source-read permissions gate every delivery
  // and every management action that targets this subscription.
  // AccountUuid (not Ref<Account>; Account is UUID-based, not a Doc).
  // Immutable after create.
  owner: AccountUuid

  // Target config (templated method/URL/headers/body + binding).
  target: WebhookTarget

  // Monotonic revision. Incremented by the service on every
  // destination-changing save. Client Tx attempts to set this are
  // rejected by the permission middleware.
  revision: number

  // Named-secret metadata. No `lastFour`: a short secret would
  // leak fully. Only name + rotation time are exposed.
  secretsMeta: Array<{ name: string, lastRotatedAt: Timestamp }>

  triggers: WebhookTrigger[]

  retryPolicy?: WebhookRetryPolicy

  // Soft-off switch. Re-checked on every attempt.
  enabled: boolean

  // Opt-in: receiver response body stored in audit (default false).
  // Reset to false on every destination-changing save.
  storeResponseBody: boolean

  // Observability. Service-maintained; immutable from clients.
  lastDeliveryAt?: Timestamp
  lastDeliveryStatus?: 'ok' | 'error' | 'skipped'
  lastDeliveryHttpCode?: number
  lastDeliveryError?: string
}

interface WebhookTarget {
  preset?: 'apprise' | 'slack' | 'discord' | 'generic'
  method: 'POST' | 'PUT'
  urlTemplate: string
  headerTemplates: Array<{ name: string, valueTemplate: string }>
  bodyTemplate?: string
  useMinimalBody?: boolean
  contentType?: string

  // Configuration digest, computed over APPROVED CONFIG (the
  // templates, method, content type, URL template, header names and
  // value templates, body template, and the sorted list of secret
  // names each template references). NOT over rendered values.
  // See "Binding".
  configDigest: string
  configDigestAlg: 'sha256'
  boundAt: Timestamp
}

// Plugin-contributed event source. See "Event sources" below. Lives
// in DOMAIN_MODEL; plugins register their sources at model-build time
// with `builder.createDoc(webhooks.class.WebhookEventSource, ...)`.
interface WebhookEventSource extends Doc {
  // Namespaced identifier, e.g. 'tracker:event:IssueStatusChange',
  // 'card:event:CardArchived', 'webhooks:event:Update'.
  kind: string
  // The Doc class this event is about. Hierarchy honoured at match
  // time, so a `tracker.class.Issue` source also fires for subclasses
  // unless a trigger's `classFilter` narrows further.
  sourceClass: Ref<Class<Doc>>
  label: IntlString
  icon?: Asset
  // Internal kinds (used only in audit attempts) stay hidden.
  hidden?: boolean
}

interface WebhookTrigger {
  // Matches a registered `WebhookEventSource.kind`. If no matching
  // source is registered at delivery time, the trigger is treated as
  // if disabled and audited as `skipped`.
  eventKind: string

  // Explicit space selection OR explicit all-spaces marker. A single
  // space OR every space the subscription's owner can read.
  scope:
    | { kind: 'space', space: Ref<Space> }
    | { kind: 'allSpaces' }

  // Narrow the source class to this subclass or mixin.
  classFilter?: Ref<Class<Doc>>

  // Attribute predicate: fire only when the named attribute on the
  // source doc has one of `values`. `attr` is a dotted path into the
  // source doc; `on` chooses pre-image or post-image. For a Create
  // event, `previous` is empty and the predicate is skipped on that
  // side.
  attributeFilter?: {
    attr: string
    on: 'previous' | 'new'
    values: unknown[]
  }
}

interface WebhookRetryPolicy {
  maxRetries: number           // default 5
  initialBackoffMs: number     // default 2000
  backoffFactor: number        // default 2
  jitterMs: number             // default 500
  timeoutMs: number            // default 10000 (hard-capped at 30000)

  // Per-subscription override of the global replay horizon advertised
  // to receivers. Default 300 s (set globally); a subscription with
  // a sensitive receiver can lower this; a subscription cannot raise
  // it past a service-wide ceiling.
  replayHorizonSeconds?: number
}
```

## Event sources

Events are plugin-contributed. Nothing fires out of the box: a Doc
class is NOT subscribable until a plugin applies the
`WebhookSubscribable` mixin to it. Rev 5 made the registry generic
by having the core plugin ship CUD sources on `core.class.Doc`,
which was too broad — it would stream webhook classes themselves
(feedback loop), high-volume derived docs (activity messages,
notifications, user statuses), and sensitive docs (preferences,
credential-bearing integrations, account identity rows), and
would force a pre-image read on every workspace CUD. Rev 6 drops
that default.

### `WebhookSubscribable` mixin (A1)

A plugin opts a class in through a model-time mixin on
`core.class.Class`:

```ts
// tracker contributes its own subscription surface in a follow-up PR.
builder.mixin(tracker.class.Issue, core.class.Class, webhooks.mixin.WebhookSubscribable, {
  events: ['Create', 'Update', 'Remove'],
  // Attributes excluded from `changes` / `attributeFilter` because
  // they are large (markup), opaque (blobs), or sensitive even to a
  // reader of the class.
  excludedAttributes: ['description', 'contentPreview'],
  // Semantic sources this class carries, in addition to the three
  // generic CUD kinds. Each name resolves to a server-side profile
  // Resource registered by the owning plugin.
  semanticSources: ['tracker:event:IssueStatusChange']
})
```

A Tx on a class without the mixin matches no subscription, so
nothing is read, journalled or delivered. The core webhooks plugin
applies NO mixins; tracker, card and process each ship their own in
follow-up PRs.

Hard-excluded regardless of the mixin: every webhook class
(`TWebhookSubscription`, `TWebhookSecret`, `TWebhookJournal`,
`TWebhookOutboxJob`, `TWebhookDeliveryAttempt`, `TWebhookAuditBlob`,
`TWebhookSubscriptionLease`, `TWebhookCleanupTask`), and anything in
`DOMAIN_MODEL`, `DOMAIN_TRANSIENT` or `DOMAIN_TX`. The sweeper
refuses to resolve these at match time even if a stray mixin lands.

### Event-source registry (A3)

A `WebhookEventSource` doc is identified BY ITS `_id` — there is no
separate `kind` field. The id is the kind. Plugins contribute an
event source as:

```ts
// Core plugin: generic CUD sources (apply to any class with the
// WebhookSubscribable mixin; `semantic: false`).
builder.createDoc(webhooks.class.WebhookEventSource, core.space.Model, {
  semantic: false,
  // No sourceClass: generic sources match wherever the subscribable
  // mixin is applied.
  label: webhooks.string.CreateEvent,
  // Server-side profile: the sweeper calls `match(tx, preImage)` to
  // decide whether this source fires on a given Tx. Resource lives in
  // server-plugins/webhooks so no code lands in the client bundle.
  match: webhooks.resource.MatchCreate,
  variables: webhooks.resource.VariablesCreate,
  renderMinimalBody: webhooks.resource.RenderMinimalBodyCreate
}, 'webhooks:eventSource:Create' as Ref<WebhookEventSource>)
```

A SEMANTIC source (`semantic: true`) is contributed by the owning
plugin, same shape plus a `sourceClass` ref:

```ts
builder.createDoc(webhooks.class.WebhookEventSource, core.space.Model, {
  semantic: true,
  sourceClass: tracker.class.Issue,
  label: tracker.string.IssueStatusChanged,
  // Process events do not come from a CUD on the source class - they
  // come from an `ExecutionLog` create in DOMAIN_PROCESS_LOG. The
  // `match` hook sees every Tx on every subscribable class the
  // registered mixin covers PLUS the class the hook explicitly asks
  // for via `detectOn` (optional; defaults to `sourceClass`).
  detectOn: tracker.class.Issue,
  match: trackerServer.resource.MatchIssueStatusChange,
  variables: trackerServer.resource.VariablesIssue,
  renderMinimalBody: trackerServer.resource.RenderMinimalBodyIssue
}, 'tracker:eventSource:IssueStatusChange' as Ref<WebhookEventSource>)
```

The `WebhookEventSource` interface:

```ts
interface WebhookEventSource extends Doc {
  semantic: boolean
  // Required for semantic sources. For generic sources the match
  // function receives the Tx's objectClass as its source class.
  sourceClass?: Ref<Class<Doc>>
  // Optional override: the class on whose Tx the match hook runs
  // (e.g. ExecutionLog for process events). Defaults to sourceClass.
  detectOn?: Ref<Class<Doc>>
  label: IntlString
  icon?: Asset
  hidden?: boolean
  // Server-side resource references (Resource<FunctionType>). The
  // sweeper looks them up through the plugin resource registry.
  match: Resource<WebhookMatchFn>
  variables: Resource<WebhookVariablesFn>
  renderMinimalBody: Resource<WebhookRenderBodyFn>
  // Optional per-event eligibility - e.g. "subscription owner must
  // currently be a tracker lead on the issue's project". Default:
  // the subscription owner has read access to the source doc, which
  // the sweeper checks regardless.
  eligibility?: Resource<WebhookEligibilityFn>
}

// Server-side resource types (lib/server-webhooks exports). Pure
// server surface; no client bundle dependency.
type WebhookMatchFn = (
  ctx: MatchContext,
  tx: TxCUD<Doc>,
  preImage: Doc | undefined
) => SourceEvent[]

interface SourceEvent {
  // Stable id for dedup. Composed as `${txId}:${sourceDoc}:${suffix?}`.
  sourceEventId: string
  eventKind: Ref<WebhookEventSource>   // the kind IS the source _id
  sourceClass: Ref<Class<Doc>>
  sourceDoc: Ref<Doc>
  sourceSpace: Ref<Space>
  // Attribute names only (A4). Values are re-read at realize time.
  changedAttrs: string[]
  actorPersonId: PersonId
  capturedAt: Timestamp
}
```

Internal attempt kinds (`test`, `skipped`, `rotated`, `bindingChanged`)
are not `WebhookEventSource` ids; they are reserved string values on
`TWebhookDeliveryAttempt.eventKind` only, never bindable to a trigger.

### Scope + filters (A5)

A trigger has three selectors:

- `scope`: `{ kind: 'space', space }` OR `{ kind: 'allSpaces' }`.
  `allSpaces` matches every space the subscription's stored owner
  can currently read. The visible-spaces set is cached per
  `(ownerUuid, workspaceRev)` with a 5-second TTL and invalidated
  on membership change; the sweeper reads from that cache rather
  than reconstructing per event.
- `classFilter?`: a `Ref<Class<Doc>>` that MUST be the source's
  `sourceClass`, a subclass, or a mixin of either. The save step
  refuses an incoherent pair. `classFilter = <Mixin>` means **the
  doc currently has that mixin applied**. Adding or removing a
  mixin (a `TxMixin`, e.g. a card tag) fires the generic `Update`
  with `changedAttrs = ['<MixinRef>']`.
- `attributeFilter?`: `{ attr, on, values }`. Fires only when the
  named attribute has one of `values`. `attr` is a dotted path;
  mixin attributes are addressed as `<MixinRef>.<attr>`.

Filter semantics:

- Equality is strict `===` for primitives and refs. For arrays
  `contains` (any `values` element appears in the attribute);
  equality on arrays is not supported in v1.
- Markup and blob attributes are refused in `attributeFilter` at
  save time (they are also in `excludedAttributes` by convention).
- `null` matches `null`; it does NOT match `undefined` / missing.
- `on: 'previous'` on a **Create** does NOT match — the predicate
  evaluates to false (NOT skipped). Rev 5 wrote "skipped" which
  reads as "matches"; rev 6 pins it.
- `on: 'new'` on a **Remove** does NOT match either, for the same
  reason.

### Journal shape (A4)

The journal stores identifiers and attribute NAMES only, never
values. Values are re-read from the stored doc at realize time
with the subscription owner's effective permissions.

```ts
interface WebhookJournal extends Doc {
  space: Ref<Space>          // webhooks.space.Webhooks
  state: 'pending' | 'in_realization' | 'realized' | 'failed'
  sourceEvent: {
    sourceEventId: string    // dedup component
    txId: Ref<Tx>
    eventKind: Ref<WebhookEventSource>
    sourceClass: Ref<Class<Doc>>
    sourceDoc: Ref<Doc>
    sourceSpace: Ref<Space>
    actorPersonId: PersonId
    changedAttrs: string[]   // names only
    capturedAt: Timestamp    // ordering key, assigned by the sweeper
    txModifiedOn: Timestamp
  }
  matchedSubscriptions: Array<{ subscriptionId: Ref<WebhookSubscription>, revision: number }>
  attemptCount: number
  lastAttemptAt: Timestamp | null
  createdAt: Timestamp
}
```

Rev 4's inline `changes: Array<{attr, prev, next}>` is dropped:
putting plain pre/post values into a Tx-written doc meant plain
issue titles, markup and custom fields reached `DOMAIN_TX`, Kafka
and backups — the same content the audit store is supposed to
encrypt. Reading at realize time keeps the plain values on the
delivery path only.

The attempt row drops `issueRef` / `previousStatusRef` /
`newStatusRef`; the identifiers it carries are `sourceClass`,
`sourceDoc`, `sourceSpace`, and the attempt's own `eventKind`.

## Authorization

### Placement (fixing MichaelUray's point #1)

Rev 3 proposed a trigger. Rev 4 moved the enforcement into a
**permission middleware** wired into the pipeline BEFORE storage
writes, same slot as `guestPermissions` in
`foundations/server/packages/middleware/`. Rationale:
`TriggersMiddleware.tx` calls `provideTx` BEFORE `processDerived`, and
trigger exceptions are caught, so a direct `TxUpdateDoc` from a
non-Owner lands in storage even if a trigger would have rejected it.
A permission middleware refuses the Tx before `provideTx` and nothing
is persisted. The middleware is **core**, not plugin-contributed; it
is inserted into the pipeline alongside `GuestPermissionsMiddleware`
and lives at `server-plugins/webhooks` for packaging only.

### Allowlist shape (fixing ArtyomSavchenko's blocking #1)

A naive check that inspects the top-level `target` key or a `$set`
operator can be bypassed in several ways `core/tx` and the Postgres
adapter accept at write time:

- **Dotted keys** - `setObjectValue` splits non-`$` keys on `.`, so
  `{ 'target.urlTemplate': 'https://attacker/' }` retargets a
  subscription without ever naming the `target` object. The same
  trick writes `target.configDigest`, `target.boundAt`, `space`, or
  any nested service-only field.
- **Update operators** - this codebase accepts `$push`, `$pull`,
  `$update`, `$inc`, `$unset`, `$rename` (not `$set`). Each operator
  payload is `{ field: ... }` keyed by the top-level field name, so
  `{ $unset: { owner: '' } }`, `{ $rename: { owner: 'formerOwner' } }`,
  `{ $inc: { revision: 1 } }`, `{ $push: { secretsMeta: {...} } }`
  all land as mutations on service-maintained fields.
- **Empty whole-object replace** - `{ target: {} }` is a key the
  middleware sees but with no sub-keys, so a top-of-tree replace
  gets through if the check hangs off the sub-key list.

Rev 5 flips the middleware to an **allowlist**:

- **Service-only fields** - `space`, `owner`, `revision`,
  `secretsMeta`, `lastDeliveryAt`, `lastDeliveryStatus`,
  `lastDeliveryHttpCode`, `lastDeliveryError`, `target.configDigest`,
  `target.configDigestAlg`, `target.boundAt` - refused for every
  non-service caller, in every form: top-level, dotted path, inside
  any operator payload, as the source OR destination of a `$rename`.
- **Containment-writable fields** - `enabled`, `name` - may be
  changed by any current workspace Owner, but only as plain
  top-level keys. Any `$`-operator or dotted key moves the update
  out of the containment allowlist, so even an `{ $inc: { enabled: 1 } }`
  (nonsense but technically a mutation) is refused for a
  non-stored-owner.
- **Destination-level fields** - `target` (whole or any sub-key),
  `triggers`, `retryPolicy`, `storeResponseBody` - require the
  subscription's stored owner. `storeResponseBody` sits here
  because it opts into persisting receiver responses that may echo
  credentials and the design doc already resets it on destination
  change (rev 4); it is NOT containment.
- **Unknown fields** - refused (closed-world); a future bypass
  through a mis-typed attribute is excluded by construction.
- **Empty operations payload** - refused. A no-op update has no
  business being a Tx; letting it pass means a bypass vector that
  "writes nothing" is treated as success.

The middleware walks every form that reaches storage:

1. For each top-level key of `operations`, split on `.` and record
   the resulting path.
2. For each `$`-key, confirm it is one of the six accepted
   operators and walk its payload keys the same way. For
   `$rename`, record BOTH source and destination.
3. Classify every recorded path. Service-only in any form -
   refuse. Unknown top-level field - refuse. Destination-level -
   requires stored owner.
4. If the touched set is purely top-level `enabled` / `name` with
   no operator and no dotted key - allow for any current Owner.
   Otherwise require the stored owner.

### TxMixin refused

`TxMixin` on `TWebhookSubscription` is refused unconditionally. The
subscription class has no mixin surface and refusing it costs nothing;
it removes an unreviewed write path on a security-sensitive class.

### Service-internal classes refused for every client

`TWebhookSecret`, `TWebhookJournal`, `TWebhookOutboxJob`,
`TWebhookDeliveryAttempt`, `TWebhookAuditBlob`,
`TWebhookSubscriptionLease`, `TWebhookCleanupTask` - no client Tx of
any kind lands. The service's own management RPC is the only write
path. This includes `TxCreateDoc` wrapped inside `TxApplyIf` or any
other compound Tx.

### Read-side gating via dedicated private space (A2)

Rev 5's class-level `findAll` override covered direct queries on
webhook classes, but not:

- `findAll(core.class.Tx, { objectClass: webhooks.class.WebhookSubscription })`
  returns the create / update Txes themselves, with URL and header
  templates. `SpaceSecurityMiddleware` filters Txes by `objectSpace`,
  not by the targeted class.
- Live broadcast: `SpaceSecurityMiddleware` broadcasts Txes in
  system / main spaces to every workspace member.
- `$lookup`, full-text search, `loadDocs` and backup paths.

Rev 6 moves every webhook doc into a dedicated private space
`webhooks.space.Webhooks`:

- `SystemSpace`, `private: true`, created once per workspace at model
  init time.
- `members` = current workspace Owners plus the webhooks service's
  system account. A member-maintenance trigger syncs the list on
  `AccountRole` changes (joins add, demotions remove).
- `TWebhookSubscription` lives here, as do all service-internal
  classes (`TWebhookSecret`, `TWebhookJournal`, `TWebhookOutboxJob`,
  `TWebhookDeliveryAttempt`, `TWebhookAuditBlob`,
  `TWebhookSubscriptionLease`, `TWebhookCleanupTask`).
- Webhook classes are also excluded from fulltext indexing.
- The permission middleware pins the subscription's `space` to this
  ref: no client Tx may change it, even in operator form.

With the private space in place, every existing read path is covered
by `SpaceSecurityMiddleware`:

- Direct `findAll` on a webhook class: filtered to members (Owners
  only).
- `findAll(core.class.Tx, {...})`: Txes `objectSpace === webhooks.space.Webhooks`,
  filtered to members.
- Live broadcast: a Tx in a private space fans out only to its
  members, not to all workspace users.
- `$lookup` from another class: the join hop runs under the space
  filter.

The class-level `findAll` override from rev 5 stays as defence in
depth; a mis-space-ed webhook doc (should not happen, since the
middleware pins the space) is still refused for non-Owners.

Dropped as a result: the "non-broadcast domain" invention from rev
4. Platform's `broadcast.ts` has no such concept, and the private-
space story covers the same goal.

### System-account bypass is narrow

The system-account bypass requires BOTH
`account.uuid === systemAccountUuid` AND
`ctx.contextData.service === 'webhooks'`. Other internal services
(github, gmail, telegram, process, ...) all run under
`systemAccountUuid` for their own purposes; they do not inherit
webhooks authority. The service clause stops a cross-service token
from writing webhook state.

### Create-time rules

- `attributes.owner` must equal the authenticated caller. A
  workspace Owner cannot create a subscription owned by someone
  else; ownership transfer is a separate RPC (not in PR 1).
- `attributes` is also an allowlist: `owner` plus the containment /
  destination-writable set. Service-only fields pre-populated by a
  client are refused. Unknown attributes are refused.
- `attributes.target.configDigest`, `attributes.target.boundAt`,
  `attributes.target.configDigestAlg` are refused as sub-fields of
  `target` even in create; the service seeds them during the first
  realize pass.

### Compound transactions

`TxApplyIf` is walked recursively; a forbidden inner Tx inside an
`applyIf` is refused the same as if it had been submitted alone.
`collection`-wrapped CUD is handled identically because the
middleware classifies by the inner `TxCUD._class` and `objectClass`.

### Testing

The middleware ships with ~55 Jest unit tests. Coverage includes the
role gate, system-account bypass with the right AND the wrong service
token, each of the seven service-internal classes, each
service-only field in top-level / dotted / each-operator form,
`$rename` with service-only on either side, `target: {}` whole-object
replace, destination-change with the stored owner / with a different
current Owner / with no stored row, containment toggles from a
non-stored-owner Owner, `TxMixin` refusal, read gating for both the
subscription class and every service-internal class, and `TxApplyIf`
walking.

### Owner-authorized destination changes (fixing point #3)

Rev 3 required re-entering secrets on destination changes but did not
pin which Owner could authorize the change. A second workspace Owner
without source access to the subscription's source project could
redirect that subscription's delivery to their own receiver.

Rev 4 pinned destination-changing saves to the subscription's
stored owner, but allowed them to land as direct Txes AND through
the management RPC — two write paths for the same bytes. A direct-
Tx edit leaves `configDigest` stale (next job fails with
`bindingDrift`) and sidesteps the secret-re-entry rule the RPC
enforces (B3). Rev 6 collapses this to one path:

- The **middleware refuses ALL destination-level writes** from any
  client caller, including the stored owner. The destination-level
  set is `target`, `triggers`, `retryPolicy`, `storeResponseBody`,
  and `secretsMeta`. These writes are visible to the storage layer
  only from the webhooks service's own system token.
- A client Owner that wants to change a destination calls the
  **webhooks management RPC**. The RPC validates the stored-owner
  check, re-renders the target against submitted secrets, computes
  the new `configDigest`, bumps `revision`, resets
  `storeResponseBody` to `false`, and writes everything in one
  service-authored Tx atomically. The RPC is the only entry point
  that can both re-enter secrets AND recompute the digest; the
  middleware's blanket refusal of client destination writes
  guarantees the digest can never drift.
- Containment writes (`enabled`, `name`) land as direct client Txes
  through the middleware, same as rev 5.
- A stored owner who loses workspace Owner role can no longer
  destination-save; the RPC refuses with
  `errorReason: 'ownerIneligible'`. Any current Owner can still
  enable, disable or delete a subscription (containment).
- Ownership transfer is a dedicated RPC that pauses the
  subscription, requires re-confirming the destination, re-entering
  secrets and the new owner's acknowledgement BEFORE unpausing.
  If the stored owner leaves the workspace entirely, the
  subscription is paused; any current Owner can resume it only by
  going through the ownership-transfer flow.
- A workspace that wants a second-Owner co-sign enables the
  `requireSecondOwnerForDestinationChanges` policy (opt-in; off by
  default per rev-3 open question #4). With the policy on, the RPC
  additionally requires a short-lived authorization token issued by
  a different current Owner for that exact
  `(subscriptionId, proposedRevision, proposedConfigDigest)` triple.

The management RPC itself ships in PR 2. PR 1 lands only the
middleware's blanket refusal — before the RPC exists there is NO
way to change a destination through any client path, which is the
intended state for the authorization gate landing in isolation.

### Delivery eligibility (per attempt and per retry)

Right before every outbound HTTP call, including every retry and
every test event, the delivery service re-checks:

- Plugin is enabled in Settings > Configure (`PluginConfiguration.enabled === true`).
- Subscription doc still exists AND `enabled === true`.
- Subscription owner is still a workspace member AND still holds
  `AccountRole.Owner`.
- Subscription owner currently has read access to the source doc.
- Target project exists, is not archived, is not restricted.
- Job's `revision` and `configDigest` both match the subscription's
  current values (binding guard; see [Binding](#binding)).
- Rendered destination passes SSRF checks (independent from the
  configDigest, which hashes the approved config, not the rendered
  values; fixes point #10).

Failures drop the attempt with the matching `errorReason`. The job
transitions to `failed` for permanent reasons, `pending` with
exponential backoff for transient ones.

### Tests and previews (fixing point #3)

- A test or preview requires the caller to be the subscription's
  **stored owner** OR, when `requireSecondOwnerForDestinationChanges`
  is on, carry a token from a different current Owner.
- The chosen source doc for the preview must be readable by the
  caller AND by the stored owner. If either lacks read access, the
  action is refused with `errorReason: 'previewSourceUnauthorized'`.

## Secrets

Secrets are a separate concept from the subscription body and never
land in persisted Tx bodies.

### Storage

```ts
TWebhookSecret extends TDoc {
  space: Ref<Space>              // workspace settings space
  subscription: Ref<WebhookSubscription>
  name: string                   // matches secretsMeta[i].name
  masterKeyId: string            // which master key wraps this row
  dekVersion: number             // which HKDF derivation of that master key
  ciphertext: Buffer             // AES-256-GCM output: encrypted value only
  nonce: Buffer                  // 96-bit, random per encrypt
  tag: Buffer                    // 128-bit GCM auth tag
  lastRotatedAt: Timestamp
}
```

**AAD reconstruction (fixing point #6).** The row stores ciphertext,
nonce, tag, master key id, and DEK version. It does NOT store the
workspace uuid, subscription id or secret name as "authoritative"
inputs to decryption. On every decrypt, the AAD is reconstructed as:

```
aad = authenticatedWorkspaceUuid
   || requestedSubscriptionId
   || requestedSecretName
   || masterKeyId
   || dekVersion
```

where `authenticatedWorkspaceUuid` comes from the service's own
authenticated transactor connection, `requestedSubscriptionId` and
`requestedSecretName` come from the caller's current request, and
`masterKeyId` / `dekVersion` come from the row. Copying the whole row
into a different workspace does not grant decryption because the AAD
reconstructed from the destination context does not match the AAD the
original ciphertext was authenticated under. A row in workspace A's
backup, inserted into workspace B's secret collection, fails AEAD
authentication at first decrypt and the subscription auto-pauses with
`secretsUnreadable`.

The row's `space` is still a `Ref<Space>` because `TDoc` requires one;
space-security still restricts who can even query the collection, but
decryption no longer depends on any value the row controls.

### Encryption

- **Scheme:** AES-256-GCM with a 96-bit random nonce per encrypt. GCM
  gives confidentiality and integrity in one primitive and matches
  the stored auth tag.
- **Keys:**
  - **Master keys** are 32-byte values held by the service.
    Identified by opaque `masterKeyId` strings. The service holds a
    **key ring**: one `active` master key plus any number of
    retired/pending-retirement keys. Rotation adds a new `masterKeyId`
    to the ring and marks it `active`; existing rows keep their old
    `masterKeyId` until a background re-encrypt rolls them forward.
    A row encrypted under `masterKeyId: m1` stays readable as long as
    `m1` is in the ring, even after `m2` becomes `active`.
    See [Key succession](#key-succession) for the rotation runbook
    (fixing point #9).
  - **Workspace DEKs** are HKDF-derived per workspace from the row's
    master key: `HKDF(masterKey_m1, info = "webhooks-dek-v<N>|<workspaceUuid>")`.
    `dekVersion` identifies the derivation; a bump is a cheap way to
    retire a specific DEK without rotating the whole master key.
- **No plaintext in Tx bodies.** Secret writes go through a dedicated
  service RPC. The management RPC encrypts in-service and inserts
  via a service token. Client Tx that CUDs `TWebhookSecret` is
  refused by the permission middleware (see Authorization).
- **Service-only decryption.** The web client cannot decrypt and
  never sees master keys.

### Key succession (fixing point #9)

The service refuses to start without `WEBHOOKS_MASTER_KEY` set.
Rotation steps:

1. The self-hoster adds `WEBHOOKS_MASTER_KEY_NEXT=<new 32-byte value>`
   alongside the existing `WEBHOOKS_MASTER_KEY`, both in base64. The
   service recognizes both: `WEBHOOKS_MASTER_KEY` is in the ring as
   `m1` (`active`), the new one is loaded as `m2` (`pending`).
2. Admin triggers a rotation RPC. The service re-encrypts all rows
   from `m1` to `m2` as a background job, updating `masterKeyId`.
   The job pauses the subscription whose secrets it is actively
   re-encrypting (bounded; one subscription at a time).
3. When the sweep completes, the admin swaps the env vars:
   `WEBHOOKS_MASTER_KEY=<new value>`, drop `_NEXT`. The service
   restarts; `m2` becomes `active`, `m1` leaves the ring.
4. Backups taken during the rotation window have mixed `masterKeyId`
   values; restoring requires both keys to be in the ring for the
   restored period. The deployment docs call this out.

The implementation PR ships a `openssl rand -base64 32` snippet in
the deployment docs for self-hosters.

### Redaction (placeholder-first)

The service renders two parallel templates per attempt:

- **Request template:** real secret values substituted, context-escaped,
  HMACed, sent on the wire.
- **Diagnostic template:** `[SECRET:<name>]` substituted in place of
  each `{{ secrets.<name> }}` BEFORE any URL-component or JSON
  encoding. Stored in audit and shown in previews.

Rev 2's substring-match-on-rendered-bytes approach would have missed
URL-encoded forms (`a/b` → `a%2Fb`) and receiver echoes. Rev 3
switched to placeholder-first for the outgoing side; rev 4 extends
the same discipline to the INCOMING side: test / preview responses
are not stored or shown by default (see
[Send test event](#send-test-event)).

### No `lastFour`

A secret of four characters or fewer would be fully leaked by a
suffix. `secretsMeta` exposes name + `lastRotatedAt` only.

## Target

### Default: minimal body

A subscription with `useMinimalBody: true` and no `bodyTemplate`
sends the minimal JSON body with no template to write. Default when
the user picks the bare `generic` preset without customization.

### Minimal body (generic shape)

Every delivery, regardless of event kind, carries a common
envelope. The variable namespace is generic over source class; a
semantic source profile (tracker, card, process) adds its own
variables under `source.<classProfileKey>`.

```json
{
  "event": "<Ref<WebhookEventSource>>",
  "eventLabel": "Issue status changed",
  "txId": "<Ref<Tx>>",
  "deliveryId": "<uuid>",
  "timestamp": 1793235782113,
  "timestampIso": "2026-10-31T06:00:00.000Z",
  "workspace": { "uuid": "<WorkspaceUuid>", "name": "Pixelique" },
  "actor": {
    "accountUuid": "<AccountUuid>",
    "displayName": "Ahmad Ismail"
  },
  "source": {
    "class": "<Ref<Class<Doc>>>",
    "id": "<Ref<Doc>>",
    "space": "<Ref<Space>>",
    "url": "<workspace URL>/<deep link resolved by the source profile>"
  },
  "changes": [
    { "attr": "status", "prev": "<Ref<IssueStatus>>", "next": "<Ref<IssueStatus>>" }
  ],
  "profile": {
    // Shape owned by the source's `renderMinimalBody` function. For
    // the tracker's issue profile this is where `project`, `issue`,
    // `previousStatus`, `newStatus` go. For a card source, this is
    // where `card`, `space`, `tag` go.
  }
}
```

Values in `changes` and `profile` are read at RENDER time (A4),
NOT frozen in the journal. If the source doc has been removed
between capture and render, the outbox row terminates as `skipped`
with reason `source_removed_before_render` and no HTTP call fires.
Markup, blob and other `excludedAttributes` from the
`WebhookSubscribable` mixin are redacted (name retained, value
replaced with `[REDACTED]` or omitted per the source profile).

**Remove events are excluded from v1 (M2).** Rendering a payload
for a `Remove` requires a pre-image snapshot of the deleted doc;
`tx.meta` is stripped before Tx persist, so no snapshot is
available at realize time. Rev 7 defers pre-image snapshot storage
rather than ship a hollow "doc gone, nothing to tell you" event:

- The `WebhookEventSource` registry schema includes `events` with
  the enum `Create | Update | Remove`, but every bundled source
  profile in v1 declares `events: ['Create', 'Update']` only. The
  `WebhookSubscribable` mixin index refuses to register a source
  that lists `Remove` in v1; the registration fails at startup
  with `remove_events_not_supported_in_v1`.
- Subscribers who need to detect deletions in v1 poll the source
  API (listing endpoint; the subscription dropped out of the
  returned set indicates removal) or observe a related signal
  (e.g., archival status on `Space` is an attribute change, not
  a remove, and therefore IS covered).
- v2 lifts this restriction via a tombstone / pre-image path. The
  shape is sketched in [open questions for review](#open-questions-for-review);
  the storage spec (a `WebhookTombstone` doc capturing the final
  pre-remove state, kept for the longer of 7 days or
  `maxOutboxAgeSeconds`) is called out there so a future PR can
  move it forward without re-opening the v1 payload contract.

### Where pre-image values come from

The sweeper reconstructs the pre-image by replaying the Tx stream
for the source doc up to and NOT including the current Tx. For a
Create event the pre-image is empty; `on: 'previous'` filters do
not match (A5). `Remove` is excluded from v1 (see M2 above). `null`
in a `changes.prev` or `changes.next` means the attribute was
`null`; "field was missing" is distinguished by the attribute NOT
appearing in the `changes` array at all.

### Templates and variables

Variable set (generic namespace; the common envelope above):

| Variable | Value |
|---|---|
| `{{ event }}` | `Ref<WebhookEventSource>` (the kind id, e.g. `tracker:eventSource:IssueStatusChange`) |
| `{{ eventLabel }}` | the source's `label` resolved to the subscription locale |
| `{{ txId }}` | triggering Tx id |
| `{{ deliveryId }}` | delivery uuid |
| `{{ timestamp }}` | ms since epoch |
| `{{ timestampIso }}` | ISO-8601 UTC |
| `{{ workspace.uuid }}`, `{{ workspace.name }}` | workspace facts |
| `{{ actor.accountUuid }}`, `{{ actor.displayName }}` | the Tx author |
| `{{ source.class }}`, `{{ source.id }}`, `{{ source.space }}`, `{{ source.url }}` | generic source identifiers |
| `{{ doc.<attr> }}` | current (post-image) value of a doc attribute; resolved by the sweeper under the owner's permissions, markup / blob attributes redacted |
| `{{ changes }}` | iterable of `{attr, prev, next}` records; v1 does NOT support iteration (see "Rules" below) — use `{{ changes.<attr>.prev }}` and `{{ changes.<attr>.next }}` instead |
| `{{ changes.<attr>.prev }}`, `{{ changes.<attr>.next }}` | pre / post-image for a specific attribute; empty string if the attribute did not change in this event |
| `{{ profile.<...> }}` | source-profile-defined fields (see below) |
| `{{ secrets.<name> }}` | named secret |

Source profiles may add their own namespace. The tracker source
profile ships with:

| Variable | Value |
|---|---|
| `{{ profile.project.id }}`, `{{ profile.project.identifier }}`, `{{ profile.project.name }}` | project facts (same values rev 4 called `{{ project.* }}`) |
| `{{ profile.issue.id }}`, `{{ profile.issue.identifier }}`, `{{ profile.issue.title }}`, `{{ profile.issue.url }}` | issue facts (`{{ issue.* }}` in rev 4) |
| `{{ profile.previousStatus.id }}`, `{{ profile.previousStatus.name }}`, `{{ profile.previousStatus.categoryRef }}`, `{{ profile.previousStatus.categoryName }}` | prior status |
| `{{ profile.newStatus.id }}`, `{{ profile.newStatus.name }}`, `{{ profile.newStatus.categoryRef }}`, `{{ profile.newStatus.categoryName }}` | new status |

Rev 4's `{{ issue.* }}`, `{{ project.* }}`, `{{ previousStatus.* }}`,
`{{ newStatus.* }}` keep working as aliases of the tracker profile
variables above, for a release so existing receiver configurations
can migrate. Card and process profiles ship similar namespaces when
those plugins add their `WebhookSubscribable` mixins (follow-up PRs).

Rules (v1):

- Placeholders are literal. Missing variable → empty string +
  `templateMiss` warning.
- No conditionals, loops, expressions, nested placeholders.
- Context-aware escaping:
  - **URL template**: values URL-component-encoded; secrets URL-encoded.
  - **Header values**: values inserted raw; CR / LF / NUL in rendered
    value rejected as `headerInjection`.
  - **JSON body** (media type normalized per RFC 7231): placeholders
    only inside JSON string literals in the template; outside-string
    placeholder rejected at save. After render the body is parsed as
    JSON; parse failure → `templateError`.
  - **Other content types**: raw substitution.
- **URL scheme + host + port MUST be literal** in the template. Any
  `{{ ... }}` before the first `/` after scheme is rejected at save.
- Media type parsing: `application/json; charset=utf-8` normalizes to
  `application/json` for selecting structural substitution; parameters
  preserved on the wire.

### Binding (fixing point #10)

`target.configDigest` is a sha256 over the APPROVED CONFIG (the
templates, method, content type, URL template, header names and
value templates, body template, sorted list of referenced secret
names). It is NOT over rendered values.

Delivery compares the job's recorded `configDigest` against the
subscription's current `configDigest` on every attempt; a mismatch
is `bindingDrift` and no send happens. `{{ issue.title }}`
substituting different values does not break binding, because binding
hashes the TEMPLATE, not the RENDERED output.

Rendered destination constraints (SSRF, host literal, header
validity) are separate per-attempt validations that run before send;
they fail on bad renders without implicating binding.

### Reserved and generated headers (fixing point #16)

Reserved header names (case-insensitive) rejected at save:

- `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`,
  `Keep-Alive`, `Proxy-*`, `Trailer`, `TE`, `Upgrade`
- Any header name starting with `X-Huly-`
- **Generated names**: `Content-Type` and `User-Agent` (new in rev
  4; rev 3 let the user set `Content-Type` and the service appended
  its own, which allowed a mismatched header pair). The user picks
  a content type via the `target.contentType` field; the service
  owns the `Content-Type` header value exactly once.

Also rejected: duplicate header names at save; duplicate rendered
header names at render; empty-value rendered headers (dropped, with
`omittedHeaders` recorded in audit).

Full final header set (user + generated) is validated for uniqueness
and valid names/values before send.

### Service-generated headers

The service always emits exactly these, in addition to validated user
headers:

- `Content-Type: <normalized content type>`
- `User-Agent: huly-webhooks/<serviceVersion>`
- `X-Huly-Event: <event>`
- `X-Huly-Delivery: <deliveryId>`
- `X-Huly-Subscription: <subscriptionId>`
- `X-Huly-Replay-Window: <replayHorizonSeconds>` - SIGNATURE
  FRESHNESS window. Advertises how old the signature's `t` value
  may be before a conforming receiver MUST reject the request as
  an HMAC replay. This is NOT the receiver's dedup retention
  window; see `X-Huly-Idempotency-Retention` below. Rev 6 called
  this header "receiver dedup retention"; rev 8 fixes the label.
- `X-Huly-Idempotency-Retention: <idempotencyIdRetentionSeconds>`
  - RECEIVER DEDUP window. Advertises how long the receiver MUST
  remember a seen `X-Huly-Delivery` value before treating the next
  sighting as a new event rather than a retry. Must cover the full
  retry+reactivation lifetime the service may use; see "Replay
  horizon and idempotency retention" below. Fixes point #14
  (receiver dedup window advertised).
- One or more `X-Huly-Signature` headers (grammar below).

## Signatures (fixing points #15, #14)

### Grammar

Formal grammar for `X-Huly-Signature`:

```
signature-header   = signature-element *( "," OWS signature-element )
signature-element  = version SP ";" param *( ";" param )
version            = "v=" DIGIT
param              = key "=" value
key                = "t" / "id" / "s" / "kid"
value              = <ASCII, no CR/LF/,/;>
```

Required params for `v=2`:

- `v=2`
- `t=<unix-ms timestamp of this attempt>`
- `id=<deliveryId>`
- `s=<lowercase-hex HMAC-SHA256>`
- `kid=<signing key id>` (new in rev 4)

Signed string:

```
"v=2;t=<ms>;id=<deliveryId>;kid=<keyId>." + <bodyBytes>
```

The signed string explicitly covers `kid` so a receiver can look up
the right verifier key.

Receivers MUST accept both the repeated-header form (one
`X-Huly-Signature` per element) and the combined-header form
(elements comma-separated in one header). Both parse to the same
list. The service SHOULD emit the repeated-header form; some proxies
collapse to the combined form so receivers must handle it.

### Signing key per subscription

- Per-subscription random 32-byte key (CSPRNG). Not shared across
  subscriptions.
- Receivers obtain their verifier key out-of-band at subscription
  creation (shown once in the UI, same reveal-and-store flow as
  the first secret rotation).
- Rotation creates a new signing key with a new `kid` and marks the
  old one `pendingRetirement` for `signingKeyGracePeriod` (default
  600 s). During the grace window the service emits BOTH signatures
  under their respective `kid` values, so a receiver running old +
  new verifier keys does not drop deliveries.

### Replay horizon and idempotency retention

Two distinct windows cover two distinct properties (M4). Rev 6
collapsed them into one 300 s value, which is correct for
signature freshness but far too short to cover retries after a
multi-hour receiver outage. Rev 7 pins them separately.

**Signature freshness window (`replayHorizonSeconds`).**

- Bounds how old a signature's `t` timestamp may be before a
  conforming receiver MUST reject the request as a replay. The
  signature itself is bound to `t` and the body hash, so a
  tight window is the HMAC-replay defence.
- Service advertises `X-Huly-Replay-Window: <seconds>`.
- Default **300 s**. Subscription-level override
  (`replayHorizonSeconds`) can only LOWER the window
  (service-wide ceiling bounds the setting).
- Only the signature header is regenerated per attempt (fresh
  `t`), so a retry hours after the first attempt still carries a
  fresh signature.

**Idempotency-ID retention window
(`idempotencyIdRetentionHours`).**

- How long a receiver MUST remember a seen `X-Huly-Delivery`
  value before declaring the next sighting a new event rather
  than a retry. This is NOT about signature freshness; it is
  about the receiver's dedup table lifespan.
- The retention window MUST cover the FULL possible
  retry+reactivation lifetime, or a late delivery can look like
  a brand-new event to a receiver whose dedup entry has already
  aged out and the receiver double-processes. MichaelUray flagged
  rev 7's phrasing (M4'): a higher ceiling value does not extend
  what the service ACTUALLY advertises, so a manual reactivation
  past the advertised value duplicates. Rev 8 aligns the advertised
  value with the fully-bounded retry+reactivation lifetime.
- **Default** `idempotencyIdRetentionHours` is **25 h**
  (`maxRetryLifetime` default 24 h + 1 h safety buffer). Automatic
  retries are hard-bounded by `maxRetryLifetime`; a row that
  reaches `maxRetryLifetime` without a 2xx is marked `failed`
  (not quarantined for retry) with `terminalReason:
  'retryBudgetExhausted'` and the audit chain closes.
- **Per-delivery retention.** At render time, persist the effective
  `idempotencyIdRetentionHours` on the outbox row together with an
  immutable `deliveryExpiresAt = renderedAt + retention`. Every
  attempt advertises that persisted value. Later workspace or
  subscription changes affect newly rendered deliveries only.
- **Manual reactivation** (`reactivateOutboxRow(subscription, deliveryId)`)
  rejects with error code **`beyond_idempotency_retention`** once
  `deliveryExpiresAt` has passed. Raising the configured retention
  does not revive an expired deliveryId; a fresh test event (new
  `sourceEventId`, new `deliveryId`) is the way to resend.
- **Dispatch deadline.** Before every HTTP attempt, including
  reactivated work, the worker rechecks `deliveryExpiresAt` with a
  small margin for transit and clock skew, and makes expired work
  terminal without sending. Reactivation never resets the deadline.
- **Advertising.** The service emits
  `X-Huly-Idempotency-Retention: <seconds>` on every attempt,
  computed from the row's persisted `deliveryExpiresAt - now`
  (floored at 0). Subscription-level overrides RAISE the workspace
  default on newly rendered rows only (not on rows already in the
  outbox, and not on the retry budget). The retry budget is set by
  `maxRetryLifetime` separately. A receiver that persists
  `X-Huly-Delivery` for at least the advertised value rejects
  repeated deliveryIds within it and will not see a duplicate from
  any service-initiated retry or operator-initiated reactivation.

### Payload immutability per delivery (fixing point #14)

- A `deliveryId` is minted when the outbox row is created, not when
  the attempt runs.
- The outbox row stores the FINAL RENDERED REQUEST BYTES (URL,
  headers, body) alongside the deliveryId. All subsequent attempts
  for that deliveryId re-use those exact bytes. A re-render on a
  retry is forbidden.
- Only the signature and `X-Huly-Idempotency-Retention` headers are
  regenerated per attempt; all other request headers and the
  rendered URL and body remain frozen. The signature is fresh `t`,
  same `kid`, same `s` computation over the frozen bytes.
  `X-Huly-Idempotency-Retention` advertises the remaining retention
  derived from the immutable `deliveryExpiresAt`
  (`floor(max(deliveryExpiresAt - now, 0) in seconds)`). The
  receiver sees a stable payload under a stable deliveryId;
  signature freshness is purely for replay protection.
- A worker crash between a successful 2xx and the state write is
  retried with the same frozen payload; the receiver's dedup
  (within `X-Huly-Idempotency-Retention`) absorbs the duplicate.

The rendered-request store is a service-local blob in the audit
blob store (same AEAD scheme as secrets), scoped by workspace +
`deliveryId`. See [Audit](#audit) for retention.

## SSRF protection

Checks run on the **final rendered URL** (post-templating). Scheme +
host + port must be literal in the template, so event data cannot
steer the destination.

### Address and transport policy

- **Public-only by default.** The authoritative check is
  `ipaddr.js`'s `range()` function: a resolved address passes only
  when `range() === 'unicast'`. The explicit tables below are
  documented defence in depth; `ipaddr.js` adds coverage for
  ranges IANA may update later.
  - IPv4 non-public ranges (rejected): `127.0.0.0/8`,
    `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
    `169.254.0.0/16`, `100.64.0.0/10` (CGNAT), `0.0.0.0/8`,
    `224.0.0.0/4` (**multicast** — rev 5 labelled this
    "broadcast", which is incorrect; multicast is the correct
    name and the behaviour is the same, reject),
    `255.255.255.255/32` (limited broadcast), `240.0.0.0/4`
    (reserved), `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`,
    `198.51.100.0/24`, `203.0.113.0/24`.
  - IPv6 non-public ranges (rejected): `::1/128`, `fc00::/7`,
    `fe80::/10`, `::/128`, `100::/64` (discard prefix, RFC 6666),
    `2001:db8::/32` (documentation), `ff00::/8` (multicast),
    `64:ff9b::/96` and `64:ff9b:1::/48` (NAT64 well-known
    prefixes — reach IPv4 ranges after translation, so an NAT64
    reachable attacker-controlled dual-stack router could proxy
    the request into the internal IPv4 space; reject at the IPv6
    layer),
    IPv4-mapped `::ffff:0:0/96` with embedded IPv4 re-checked
    against the IPv4 table, IPv4-compatible `::0.0.0.0/96`,
    6to4 `2002::/16`, Teredo `2001::/32`.
- **IPv4-literal normalization.** `127.1`, `0x7f.0.0.1`, octal
  forms, and any other `net.isIP` representation are normalized
  before the range check.
- **Validate every A/AAAA.** The full RRset is validated per attempt;
  mixed public + private is rejected.
- **Connection pinning.** The HTTP client connects to the explicitly
  validated IP via a custom `lookup` function. TLS hostname
  verification stays against the subscription URL hostname.
- **Explicit proxy (fixing point #7).** When `WEBHOOK_EXPLICIT_PROXY`
  is set, the service does NOT delegate hostname resolution to the
  proxy. Instead, the service resolves the origin itself under the
  SSRF rules, then issues an HTTP CONNECT to the proxy targeting
  `<validated-origin-ip>:<port>` (not the hostname). This stops a
  proxy from resolving the hostname independently and connecting to
  a private address. TLS verification happens end-to-end against
  the origin hostname across the CONNECT tunnel. The proxy host
  itself is validated under the same SSRF rules at service start.
  Internal exceptions:
  - `WEBHOOK_ALLOWED_HOSTS` is a list of
    `host:port[,host:port...]` entries, matched exactly, bypassing
    the non-public range check for that host+port pair.
  - `WEBHOOK_ALLOWED_CIDRS` is a list of CIDR ranges + required
    port ranges, bypassing the non-public check for destinations
    inside those ranges. New in rev 4 because
    `WEBHOOK_ALLOWED_HOSTS` cannot cover a self-hoster who allows
    an entire internal subnet (e.g. a Docker overlay network).
- **No implicit proxy.** `HTTP_PROXY` / `HTTPS_PROXY` /
  `NO_PROXY` / system proxy / PAC are ignored. Only
  `WEBHOOK_EXPLICIT_PROXY` opts into a proxy.
- **Redirects disabled.** 3xx is a delivery error (`errorReason:
  'redirect'`).
- **HTTPS by default.** `http://` only when
  `WEBHOOK_ALLOW_HTTP=true` AND the host is in the allowlist.
- Timeout default 10 s, hard cap 30 s. Response body cap 8 KB.

## Durable delivery (B1, platform assumptions)

Rev 3 wrote the outbox in the same Tx as the apply and relied on
cross-domain atomicity. Rev 4 moved to a journal written in the Tx
middleware pipeline, which still crosses a commit boundary against
the source-domain apply: journal written before `provideTx` and
apply fails leaves a phantom journal; journal written after and a
crash in between loses the event. `tx.meta` is stripped before
persist, so the pre-image cannot ride on the Tx either.

Rev 6 drops in-pipeline journalling. Delivery is driven by a
**Tx-log sweeper**:

- `TxMiddleware` writes every CUD Tx to `DOMAIN_TX` BEFORE the
  domain apply (`foundations/server/packages/middleware/src/txPush.ts`:
  the `tx-push` await completes before `provideTx` returns, with
  no shared storage transaction and no rollback hook if `provideTx`
  then rejects). Rev 7's claim of a "single storage transaction"
  across the two was wrong and MichaelUray flagged it (M1'). Rev 8
  drops the apply-success invariant and narrows the delivery
  contract honestly.

  **Delivery contract (at-least-once after Tx-log durability).**
  The sweeper fires on every Tx that durably reached `DOMAIN_TX`.
  That is a WEAKER guarantee than "the mutation committed". Two
  gaps are explicit and documented:

  1. **Phantom Tx.** A crash or an exception between the Tx-log
     write and the end of `provideTx` leaves a stored Tx whose
     apply never committed. The sweeper picks it up on restart
     and attempts to realize it; see realize-time mismatch
     detection below for how such events terminate.
  2. **Stale rendered payload.** The payload the receiver sees
     reflects the LIVE source doc at realize time, not the
     intermediate state the Tx described. A later Tx that
     overwrites the touched attributes shifts the rendered body
     away from the triggering Tx's intent.

  A subscriber that needs apply-success semantics must consult
  the source doc via `txId` + the workspace API and treat a
  webhook as a hint, not a ledger entry. The delivery contract
  is "at-least-once delivery of a trigger notification keyed on
  `(workspace, txId, sourceEventId)`; the attached payload is a
  best-effort live snapshot and MAY disagree with the Tx that
  triggered it". Receiver code that tolerates the two gaps above
  is safe; receiver code that assumes "every webhook corresponds
  to a committed mutation that produced exactly this payload" is
  not.

  Closing either gap requires an after-apply hook in
  platform-core (a successful-commit signal the sweeper can
  subscribe to) and a shared storage transaction between
  `tx-push` and `provideTx`. Both are platform-level changes
  outside the scope of this docs-only PR; they are tracked as a
  follow-up in [Open questions for review](#open-questions-for-review).

  **Realize-time mismatch detection narrows (does not close) the
  gap.** The sweeper + delivery worker check that the Tx's intent
  is reflected in the live doc before firing. If the Tx was a
  `TxCreateDoc` but the doc no longer exists at realize time, OR
  a `TxUpdateDoc` whose touched attributes have been overwritten
  by a later Tx so the rendered body would be misleading, the
  outbox row is terminated with `terminalReason: 'source_mismatch'`
  and a `skipped` audit row recorded. This catches most phantom
  Txes before they reach the receiver, but a phantom whose live
  state coincidentally matches the (failed) Tx's intent is
  indistinguishable from a real event and WILL be delivered.
  Removes are the one case where "live doc missing" is the
  *expected* state; rev 7 excludes Removes from v1 (see M2), so
  this check does not fire on them.

  A crash before Tx-log insert means neither a stored Tx nor a
  delivered event; a crash after Tx-log insert and before apply
  commit has a stored Tx the sweeper picks up on restart and
  realize-time mismatch detection catches most of those; a crash
  after a successful commit has a stored Tx the sweeper picks up
  on restart and realizes normally.
- For each Tx, the sweeper resolves the applicable
  `WebhookEventSource` set by: (a) looking up the Tx's `objectClass`
  in the `WebhookSubscribable` mixin index; (b) running every
  registered match hook whose `detectOn` matches the Tx's class or
  one of its hierarchy. Each match hook returns zero or more
  `SourceEvent` records (`sourceEventId`, `changedAttrs`, ...).
- For each `SourceEvent`, the sweeper joins against subscriptions
  for the workspace, writes a journal row (attribute names only,
  per A4), then one outbox row per matched subscription. All writes
  live in the webhooks domain (`DOMAIN_WEBHOOKS`), a single-domain
  storage transaction, so atomicity on this side is normal.
- Outbox rows have a UNIQUE constraint on
  `(subscription, eventKind, sourceEventId, generation)`.
  The sweeper always inserts generation 0, making restart replay
  idempotent. Secret rotation inserts the next generation. There is
  no additional UNIQUE constraint on the three-field event identity
  in the outbox; cancelled and replacement generations must coexist.
- The pre-image is reconstructed by replaying the Tx stream for the
  source doc up to and including the Tx under consideration. For
  common cases (Create / Update) the Tx itself carries the post-
  image diff and the sweeper reads the stored doc one tick earlier
  from `DOMAIN_TX` reverse replay. The journal records attribute
  NAMES only; values are read from the stored source doc at realize
  time (A4), under the subscription owner's effective permissions.

The platform assumptions rev 4 relied on are dropped:

- "The journal is written in the same storage transaction as the
  source mutation" — not needed any more. The Tx log IS the single
  source of truth; the sweeper picks up only committed Txes.
- "Non-broadcast domain" — not needed; webhook docs live in the
  private webhooks space (A2) and `SpaceSecurityMiddleware` already
  limits broadcast to space members.
- "Outside the transactor hot path" — now literally true: the
  sweeper is a background worker, not a middleware. The in-
  pipeline matching that rev 4 implied is removed. The sweeper
  caches a per-workspace, per-class subscription index keyed on the
  workspace config revision.

### Journal row

```ts
interface WebhookJournal extends Doc {
  space: Ref<Space>          // webhooks.space.Webhooks
  state: 'pending' | 'in_realization' | 'realized' | 'failed'
  sourceEvent: {
    sourceEventId: string    // dedup component
    txId: Ref<Tx>
    eventKind: Ref<WebhookEventSource>
    sourceClass: Ref<Class<Doc>>
    sourceDoc: Ref<Doc>
    sourceSpace: Ref<Space>
    actorPersonId: PersonId
    changedAttrs: string[]   // names only (A4)
    capturedAt: Timestamp    // ordering key, monotonic per subscription
    txModifiedOn: Timestamp
  }
  matchedSubscriptions: Array<{ subscriptionId: Ref<WebhookSubscription>, revision: number }>
  attemptCount: number
  lastAttemptAt: Timestamp | null
  createdAt: Timestamp
}
```

### Outbox row

```ts
interface WebhookOutboxJob extends Doc {
  space: Ref<Space>          // webhooks.space.Webhooks
  subscription: Ref<WebhookSubscription>
  revision: number                 // frozen at realize time
  eventKind: Ref<WebhookEventSource>
  sourceEventId: string
  deliveryId: string               // uuid; minted at realize time
  journal: Ref<WebhookJournal>
  txId: Ref<Tx>
  // Diagnostic form only. Secret values are substituted at send
  // time, so plain secret values never reach DOMAIN_TX, Kafka or
  // backups (B2).
  frozenRequest: {
    method: 'POST' | 'PUT'
    url: string              // rendered with [SECRET:<name>] placeholders
    headers: Array<{ name: string, value: string }>  // same placeholders
    bodyBytes: Buffer        // body template rendered with [SECRET:<name>]
    bodyBytesHash: string    // sha256 of body AFTER secret substitution,
                             //   NOT of the diagnostic form; computed at
                             //   send time once per attempt and stored on
                             //   the audit row, not here
    configDigestAtRealize: string  // for bindingDrift re-check
    renderedAt: Timestamp
    // Retention frozen at render time; drives both the
    // `X-Huly-Idempotency-Retention` advertisement and the
    // `deliveryExpiresAt` deadline. Later workspace or subscription
    // changes affect newly rendered deliveries only.
    idempotencyRetentionHours: number
    // Hard deadline = renderedAt + idempotencyRetentionHours.
    // Checked at reactivation AND before every HTTP attempt, with a
    // small margin for transit and clock skew; expired work is made
    // terminal without sending. Immutable once set.
    deliveryExpiresAt: Timestamp
    // Capture-time sequence number; outbox ordering reads this,
    // NOT `nextAttemptAt`, so a job in backoff is not overtaken by a
    // newer job for the same subscription.
    captureSeq: number
  }
  state: 'pending' | 'in_flight' | 'done' | 'failed' | 'quarantined'
  attempts: number
  nextAttemptAt: Timestamp | null
  terminalReason: string | null
  claimedUnderLease: string | null
  // Monotonic per `(subscription, eventKind, sourceEventId)`. First
  // insert from the sweeper is 0; each cancel-and-reissue under
  // secret rotation bumps the counter. See M3' below for how this
  // separates event-dedup from delivery-generation under the
  // `UNIQUE(subscription, eventKind, sourceEventId, generation)`
  // constraint, so a replacement row can actually be inserted while
  // the cancelled row's seven-day retention still holds.
  generation: number
}
```

Realization steps for one journal entry:

1. Mark journal `in_realization` with an optimistic lock.
2. For each matched subscription, resolve the owner's current
   source access against the LIVE source doc. If revoked, write a
   `denied` audit row directly (no outbox row) and move on.
3. Read the source doc as it stands now, under the subscription
   owner's effective permissions. Render URL, headers and body
   templates with `[SECRET:<name>]` placeholders substituted into
   the secret slots (not the actual secret values). Compute
   `configDigestAtRealize` from the APPROVED CONFIG as before.
4. Insert the outbox row with `generation = 0`
   (`UNIQUE(subscription, eventKind, sourceEventId, generation)`).
   The sweeper inserts generation 0 for every new source event; the
   same tuple cannot be re-inserted at generation 0, which is what
   makes the sweeper idempotent on restart.
5. When all outbox rows for the journal entry are inserted, mark
   the journal `realized`.
6. A crash during realization leaves the journal `pending` /
   `in_realization`; another sweeper worker retries after lease
   expiry. The unique index makes re-insertion idempotent.

The delivery worker reads the outbox row and substitutes secrets
just before the HTTP call (B2), signs the final body hash, sends.

**Secret rotation vs delivery-id immutability (M3, M3').** The
L1180 invariant ("the same `deliveryId` always carries the same
frozen request bytes") prohibits re-rendering mid-retry. Rev 6's
wording "the worker re-reads the secret store so a rotation picks
up the new value" directly contradicted that invariant. Rev 7
resolved it with a cancel-and-reissue flow but left the dedup
primary key at `(subscription, eventKind, sourceEventId)`, so the
cancelled row's seven-day retention blocked the replacement INSERT
(MichaelUray flagged this as M3'). Rev 8 separates event-dedup
from delivery-generation:

- **Primary key** becomes
  `UNIQUE(subscription, eventKind, sourceEventId, generation)`.
  `sourceEventId` continues to be the event-dedup key (one real
  source event gets one `(subscription, eventKind, sourceEventId)`
  identity); `generation` is a monotonic counter inside that
  identity that bumps on every replacement issued by the rotation
  RPC. Sweeper inserts for new source events always use
  `generation = 0`, so sweeper restart idempotency is unchanged.
- **`deliveryId`** stays a uuid, minted per OUTBOX ROW (not per
  source event), so each generation carries a distinct deliveryId
  the receiver's dedup table sees as a new attempt stream. The
  audit chain binds `sourceEventId` + `generation` + `deliveryId`
  so an operator tracing a flow sees the full lineage.

The rotation RPC (`rotateSecret(subscription, name)`) then:

1. Writes the new ciphertext and bumps `secretsMeta[name].lastRotatedAt`
   plus `subscription.revision`.
2. In the same storage transaction, finds every outbox row in
   `state in ('pending', 'in_flight')` whose
   `frozenRequest.{url,headers,bodyBytes}` contains the
   `[SECRET:<name>]` placeholder for the rotated secret.
3. Flips each matched row to `state = 'failed'` with
   `terminalReason: 'secretRotated'` and writes a `rotatedSecret`
   audit row. A row in `in_flight` is left for its worker to
   observe the terminal state at write-back time; the receiver
   may double-process the old payload (acceptable: receiver dedup
   on `deliveryId` within `idempotencyIdRetentionHours` absorbs
   it).
4. For every cancelled row that still has `attempts == 0` AND the
   subscription is still `enabled`, inserts a FRESH outbox row with
   `generation = previous.generation + 1`, a new `deliveryId`, a
   new `captureSeq`, same `journal` + `sourceEventId`. The INSERT
   succeeds under the new UNIQUE constraint because
   `(subscription, eventKind, sourceEventId, generation)` is
   distinct. Cancelled rows with `attempts > 0` are NOT re-queued:
   the receiver already saw at least one attempt under the old
   deliveryId, and a second deliveryId for the same source event
   past the receiver's retention window would double-fire.
5. Master-key succession (`WEBHOOKS_MASTER_KEY_NEXT` ring, section
   [Key succession](#key-succession-fixing-point-9)) re-encrypts
   ciphertext under a new master key but does NOT change the
   plaintext secret, so the plaintext value substituted at send
   time is unchanged. Key succession therefore does NOT trigger
   cancel-and-reissue; only `rotateSecret` on a named secret
   does.

A secret marked compromised and rotated is NEVER replayed with
the old value because every pending deliveryId that was holding
a placeholder for it is already terminal, and the replacement
row at the next generation is rendered with the new secret.

### Dedup key

`(subscription, eventKind, sourceEventId)` is the full **event**
dedup key; the outbox row's primary key is
`(subscription, eventKind, sourceEventId, generation)` so that
cancel-and-reissue under secret rotation can insert a replacement
row while the cancelled row is still held in retention (M3'). A
receiver that dedups on `deliveryId` within
`idempotencyIdRetentionHours` is unaffected by the generation bump
because each generation mints its own `deliveryId`.
`sourceEventId` is composed as `${txId}:${sourceDoc}` for a plain
Tx-sourced event; a hook that generates several events from one
Tx (e.g. a `TxApplyIf` with multiple transitions, or a process
`ExecutionLog` carrying several stage changes) appends a suffix.
Rev 4's `(subscriptionId, event, txId)` collapsed batched
transitions into a single row — rev 6 keeps rev 5's fix.

### Kafka role

Kafka is the **wake-up signal** only. The sweeper is the source of
truth and runs on a short interval regardless of Kafka. Each Kafka
message carries one `(workspace, txId)` wake-up; the sweeper's work
on that message is to advance its cursor past `txId` if it was
behind. **Kafka ack happens immediately on receipt**, not after any
journal or HTTP step — a slow receiver on one subscription cannot
stall workspaces sharing a partition. Rev 4 described two
inconsistent ack points; rev 6 pins one.

### Automation-authored Txes (loop protection)

`TxMiddleware` does not persist `DerivedTx`-space Txes, so changes
authored by server-side triggers (the #238 workflow-rules mirror,
server-plugins' own triggers) do NOT normally fire webhooks. Rev
6 confirms that behaviour: a `DerivedTx` is NOT a sweeper input.

A **non-derived** Tx authored by an automation service (the
process service, the inbound-webhook service in #33) IS a Tx the
sweeper sees. To prevent `outbound → external → inbound → change
→ outbound` loops, the sweeper refuses to generate events on a Tx
whose `modifiedBy` resolves to a known service account (identified
by the same `ctx.contextData.service` convention used in the
authz middleware). The webhooks service itself writes under its
own token too; its Txes are also exempt. A subscription that
wants automation events opts in explicitly through a
`WebhookTrigger.includeAutomation` flag, defaulting to `false`.

## Ordering, claiming, backlog (fixing points #12, #13)

### Subscription-wide lease

The delivery service claims **a subscription**, not a single row.
When a worker takes `TWebhookSubscriptionLease` for subscription S,
it is the only worker that may process outbox rows for S until the
lease expires. The lease has a short TTL (default 30 s) and the
worker renews it while actively processing; crash + no renewal =
lease expires and another worker claims.

Within a lease the worker processes outbox rows for S in strict
`(captureSeq ASC, attempt ASC)` order (M5, M5'). Rev 6 used
`nextAttemptAt` as the sort key, which let a newly captured job
sail past a job in exponential backoff. Rev 7 promoted
`captureSeq` to the primary sort key but filtered out
`nextAttemptAt > now()` BEFORE the sort, which still let a newer
due row overtake an older row still in backoff (MichaelUray
flagged this as M5'). Rev 8 removes the pre-sort filter:

- **`captureSeq` is authoritative for ordering.** A monotonic
  per-subscription counter minted at outbox-insert time (part of
  `frozenRequest.captureSeq`, already present in the schema).
- **The claim query does NOT filter on `nextAttemptAt`.** It
  selects the oldest outstanding row in S by
  `(captureSeq ASC, attempt ASC)` over the set
  `state in ('pending', 'in_flight') AND terminalReason IS NULL`.
  `nextAttemptAt` is read from the selected row and inspected by
  the worker AFTER the claim query returns.
- **`nextAttemptAt` is a per-row admission gate.** If the
  selected row's `nextAttemptAt IS NULL OR nextAttemptAt <= now()`,
  the worker processes it. Otherwise the worker yields: it
  releases the claim without marking the row processed, waits
  `min(nextAttemptAt - now, pollInterval)`, and re-runs the claim
  query. The next run returns the same oldest row (because
  `captureSeq` is immutable), so the worker blocks on the oldest
  retrying job rather than racing past it with a newer `pending`
  one.
- A newer `pending` job in S cannot overtake an older job that is
  between retries unless the older job is `quarantined` (which
  removes it from the claim set explicitly). Fixes point #13: no
  row-level race, no retry overtaking without quarantine, strict
  captureSeq ordering even across the retry/backoff window.

### Backlog quotas (fixing point #12)

- **Per subscription backlog cap:** `maxOutboxPerSubscription`
  default 10 000 rows. When exceeded, new realizations for that
  subscription write a `denied` audit row with
  `errorReason: 'backlogFull'` and the subscription auto-pauses.
- **Per workspace backlog cap:** `maxOutboxPerWorkspace` default
  100 000 rows across all subscriptions. Enforced the same way.
- **Age cap:** an outbox row older than
  `maxOutboxAgeSeconds` default 7 days is marked `quarantined`;
  the admin triages.
- **Fan-out cap (admission at save time, M7 + M7'):** the hard
  limit on how many subscriptions a single matching Tx may fan
  out to is `maxFanoutPerTx` default 50. Rev 6 enforced it only
  at realize time, so a save that would guarantee breaches was
  still allowed. Rev 7 moved enforcement to the management RPC
  but computed the projection per event kind in isolation, which
  MichaelUray flagged (M7'): a single Tx often co-emits several
  event kinds (e.g., `card.updated` plus `card.status.changed`
  from the same status mutation), so three kinds each sitting at
  40 matching subs individually pass a per-kind cap of 50 while
  the real fan-out for that one Tx is 120. Rev 8 enforces the
  cap on AGGREGATE cardinality across all co-triggered kinds:
  - **Co-triggered-kind set.** For each (Tx shape) the save
    might match, the service enumerates the set of event kinds
    its triggers could emit from a single source Tx. In
    practice this is the union over every trigger in the sub,
    projected against the event-kind taxonomy (the realizer's
    emit table is authoritative). Kinds that cannot be emitted
    from the same Tx (because their classes or modifiers
    disagree) are kept in separate sets; kinds that can
    co-emit (e.g., a "generic update" kind and a "specific
    attribute changed" kind triggered by the same CUD) form
    one co-triggered set each.
  - **Save-time projection.** On every `createSubscription` and
    `updateSubscription`, the RPC computes, for each
    co-triggered set, the projected aggregate fan-out. Each
    event source registers a conservative `maxEventsPerTx`
    (upper bound on `SourceEvent` records it can emit from a
    single Tx: e.g., a single-doc CUD source is 1, a bulk hook
    that iterates matched docs declares its finite ceiling).
    The projection sums, across every kind in the set,
    `matchingSubscriptionCount(kind) * maxEventsPerTx(source)`,
    using the subscription set as it would be after save
    (including this sub, including the current revision of
    every other sub). It takes the MAX across all co-triggered
    sets the save could produce. If that max exceeds
    `maxFanoutPerTx`, the RPC rejects with error code
    **`fanout_cap_exceeded`** and a response body naming the
    co-triggered kind set, the projected aggregate count, the
    limit, and the subscriptions already counting against it
    (the operator needs the list to triage). An event source
    without a finite `maxEventsPerTx` cannot pass the save-time
    gate; either register a bound or move the source to
    bounded batch handling. Save-time cannot admit unbounded
    emitters.
  - **Realize-time check.** Before inserting outbox jobs,
    enumerate the SourceEvent instances produced by the current
    source Tx and their matching subscriptions. Count distinct
    `(subscription, eventKind, sourceEventId)` tuples and
    compare that count with `maxFanoutPerTx`. Multiple matching
    triggers for one tuple count once; different sourceEventIds
    of the same kind count separately. On overflow, record
    `failed:fanoutExceeded` and auto-pause the affected
    subscriptions without partial insertion.
  - Operator remediation: narrow this sub's `scope` /
    `classFilter` / `attributeFilter`; split triggers so a
    single sub no longer joins a saturated co-triggered set;
    delete a conflicting sub; or request the limit be raised
    via a service-config change (`maxFanoutPerTx` is read from
    workspace config at RPC time, no restart needed).
  - The save-time check is the normal gate; the realize-time
    check is the fallback for cases save-time can miss (e.g.,
    a plugin ships a new `WebhookSubscribable` after save, or a
    newly emitted event kind joins an existing co-triggered
    set).
- **Retry budget:** retries + test events + initial attempts all
  draw from the same per-subscription + per-workspace sliding-window
  budgets.
- **Quarantine retention:** `quarantinedJob` rows are kept for
  `quarantineRetentionDays` default 7, then auto-deleted; the audit
  rows for their attempts stay on the normal audit schedule. UI
  shows them with "triage before auto-delete" countdown.

### Overflow

When any quota triggers:

- The subscription is auto-paused.
- A UI notice names the quota that fired.
- The source Tx apply is unaffected (never blocks on webhook
  delivery backlog).
- The service rejects new management writes to the subscription
  until the Owner triages (prevents a dashboard-driven loop re-arming
  a saturated subscription).

## Audit (fixing point #4)

Audit payloads are **sensitive data by definition** (they carry
rendered request URLs, headers and bodies; they reference issue
titles and actor display names). Rev 3 kept them in ordinary Doc
collections; querying `TWebhookDeliveryAttempt` would get space-
filtered on `objectSpace` which does NOT reach the referenced
issue's space. So a user who lost source access could still read
audit rows that leaked the issue content.

Rev 4 moves sensitive audit content **out of ordinary Tx history**:

### Audit blob store

Rev 4's `TWebhookAuditBlob` carried both `blobId` and an inline
`ciphertext`. Rev 6 picks **object storage**: the audit payload
lives in the workspace's blob adapter (same storage layer as
attachments), encrypted with the same AEAD scheme as secrets, and
the audit row carries only the identifiers:

```ts
interface WebhookAuditBlob extends Doc {
  space: Ref<Space>              // webhooks.space.Webhooks
  subscription: Ref<WebhookSubscription>
  deliveryId: string
  attempt: number
  blobId: string                 // key into the blob storage adapter
  blobBytes: number              // for quota accounting
  masterKeyId: string
  dekVersion: number
  nonce: Buffer                  // 96-bit, random per blob
  tag: Buffer                    // 128-bit GCM auth tag
  at: Timestamp
}
```

The audit JSON (stored in the blob) holds the rendered URL
(diagnostic form with `[SECRET:*]`), header names + diagnostic
values, body (diagnostic form with `[SECRET:*]`), HTTP code,
response headers (if the subscription opts in via
`storeResponseBody`), response body (if opted in, first 2 KB),
`templateWarnings`, and the error reason. Secret values are
NEVER inside; the diagnostic form is written at render time.

The audit row lives in `webhooks.space.Webhooks`, so
`SpaceSecurityMiddleware` limits reads to Owners (and the service)
automatically. On every blob read, the service additionally
verifies the **current reader has source access to the referenced
source doc**, using `sourceClass` + `sourceDoc` captured in the
parent `TWebhookDeliveryAttempt` row. A reader without source
access gets back a `redacted` row that only shows outcome + error
reason + timestamp.

Clients query the audit UI through a dedicated service RPC; the
RPC re-authorises on each read. Rev 4's "non-broadcast domain"
flag is dropped — the private webhooks space already covers
broadcast.

### Attempt metadata row

```ts
interface WebhookDeliveryAttempt extends Doc {
  space: Ref<Space>              // webhooks.space.Webhooks
  subscription: Ref<WebhookSubscription>
  deliveryId: string
  attempt: number
  eventKind: Ref<WebhookEventSource> | 'test' | 'skipped' | 'rotated' | 'bindingChanged'
  txId: Ref<Tx>
  sourceClass: Ref<Class<Doc>>   // for current-source-access gating
  sourceDoc: Ref<Doc>
  sourceSpace: Ref<Space>
  at: Timestamp
  outcome: 'ok' | 'error' | 'skipped' | 'denied'
  httpCode?: number
  errorReason?: string
  blobId?: string                // key into blob store when outcome allows one
  omittedHeaders?: string[]
  // Rev 5 fix: body hash is computed at send time (after secret
  // substitution) and stored here, NOT in the outbox row.
  bodyBytesHash?: string
}
```

The row carries identifiers + outcome + error reason. The sensitive
rendered-content lives in the blob store and is read-gated.

### Retention per layer

- `TWebhookDeliveryAttempt` rows: `attemptRetentionDays` default
  30.
- `TWebhookAuditBlob`: same retention as its paired attempt row;
  cleanup worker removes blob + attempt + Tx history as one unit
  (see Cleanup).
- `TWebhookOutboxJob`: `done` or `failed` kept for
  `outboxRetentionDays` default 7.
- `TWebhookJournal`: `realized` kept for `journalRetentionDays`
  default 7; `pending` and `in_realization` are kept until they
  reach a terminal state regardless of age.

### Cleanup worker (fixing point #17)

The worker records a **durable cleanup intent** before any delete.

```ts
TWebhookCleanupTask extends TDoc {
  space: Ref<Space>
  targets: Array<{ collection: string, docId: Ref<Doc> }>
  state: 'pending' | 'documentsRemoved' | 'historyPruned' | 'done'
  attempts: number
  lastError?: string
  createdAt: Timestamp
}
```

Flow per sweep:

1. Build a batch of expired docs across the four collections
   (`maxCleanupBatch` default 500).
2. Write a `TWebhookCleanupTask` with the targets, state `pending`.
3. Issue `TxRemoveDoc` for each target. On success, mark state
   `documentsRemoved`.
4. Issue the low-level history-pruning helper (same shape as
   existing audit roll-offs; the implementation PR will reference
   the exact helper by name). On success, mark state
   `historyPruned`, then `done`.
5. On failure at any step, retain the task row; the next sweep
   retries idempotently.
6. **Orphan reconciliation**: if a cleanup task is `pending` for
   more than `cleanupStuckThresholdDays` default 7, write a
   `cleanupStuck` metric and page the operator. The row stays in
   `pending` until human triage; the worker never auto-abandons.

Confidential history is NOT indefinitely retained if a step partially
succeeds, because the cleanup task row keeps the pending work
visible to the next sweep.

### Backups and client broadcasts

- The audit blob domain is excluded from the ordinary client
  broadcast list; a Tx that writes a `TWebhookAuditBlob` does not
  push through `broadcast.txes`. Clients read via RPC which
  re-authorizes.
- Backups keep original data as before. Restore handling (next
  section) pauses all subscriptions on restore so the restored
  audit history is never dispatched or broadcast until an Owner
  explicitly reactivates.

## Restore and clone (fixing point #8)

Rev 3 relied on cross-workspace decryption failure to pause
subscriptions on restore. A same-workspace restore that keeps the
UUID and the master key decrypts fine and would resume production
sends. Rev 4 pauses **unconditionally** on every restore. Rev 6
set the restore guard as the LAST step of restore; MichaelUray
caught (M6) that an in-flight delivery worker racing the restore
could send under the yet-to-be-fully-restored subscription config
during the window between the first restored subscription row
and the final flag write.

Rev 7 flips the sequence. The guard is established BEFORE any
data lands, and released only per-subscription after the Owner
verifies each:

1. **Set the guard first.** On restore start, before any workspace
   data is written, the restore path writes the workspace-level
   flag `webhooksRestoreGuardSet=true`. If the restore fails
   mid-way, the flag stays set and the service never autoresumes.
2. **Mark every subscription "paused for restore" before writing
   data.** The restore path emits a per-subscription marker
   `WebhookRestoreMarker{ subscription, pausedAt }` into the
   webhooks domain BEFORE loading any `WebhookSubscription` rows
   from the backup. The delivery service reads this marker set
   on every claim; a subscription with a marker is NEVER
   claimable, independent of the per-row `enabled` field.
3. **Load data.** `restore.ts` loads subscriptions, secrets,
   outbox and audit rows as before. The service refuses to
   dispatch during this phase: both the workspace guard and the
   per-subscription markers are set.
4. **Quarantine pending outbox rows.** `pending` outbox rows that
   existed before restore are transitioned to
   `state: 'quarantined'` with `errorReason: 'restoreGuard'`
   immediately after they are written. They do not fire later.
5. **Per-subscription release.** The flag clears only when an
   Owner opens each subscription, confirms destination +
   credentials, and runs an explicit reactivation action. The
   action deletes that subscription's `WebhookRestoreMarker`;
   the subscription becomes claimable again.
6. **Workspace guard releases automatically.** When the last
   `WebhookRestoreMarker` is deleted, the workspace-level
   `webhooksRestoreGuardSet` flag auto-clears on the next
   service tick. Until then the UI banner shows the still-paused
   count.
7. **Clone operations** set the same guard + per-subscription
   markers.

## UI

Workspace settings > Webhooks tab. Owner-only. Hidden entirely when
`PluginConfiguration.enabled === false`.

Per subscription row:

- Name, preset badge, URL host (full URL hidden; secrets masked).
- Enabled toggle (atomic apply).
- Last delivery: timestamp, status, HTTP code, diagnostic body
  preview with `[SECRET:*]` (only when `storeResponseBody` is on
  and the reader has source access to the referenced source doc).
- Actions: Edit (stored owner only, through the management RPC),
  Send test event (stored owner only), Delete (current Owner).

Editor:

- Name
- Preset selector (apprise / slack / discord / generic)
- Method, URL template (host literal; URL preview on blur)
- Header list (reserved + generated names blocked; CR / LF rejected
  on blur)
- Content type + body template OR "Use minimal body"
- Named secrets panel: add / rotate / remove (service RPC;
  write-only; `lastRotatedAt` shown).
- Triggers: `eventKind` picker (filled from the
  `WebhookEventSource` registry, hidden sources excluded) +
  `scope` (specific space OR all-spaces) + optional
  `classFilter` (narrowed to subclasses or mixins of the picked
  source's class) + optional `attributeFilter`.
- Retry policy (collapsed).
- **Render preview**: picks a recent matching source doc the
  caller can read; renders the diagnostic URL / headers / body
  with `[SECRET:*]`; shows what will be POSTed. Preview requires
  caller + stored owner source-access.

### Send test event (fixing point #5)

- Picks a recent matching source doc the caller + stored owner can
  both read.
- Builds the payload with real values and sends with the live
  signed body.
- **Response display defaults to status + headers metadata only**.
  Body is NOT shown. A collapsed section says "Receiver returned N
  bytes; show response body [requires acknowledgement]."
- Clicking "Show response body" presents an explicit disclosure
  warning: "The receiver may echo values of your stored
  credentials in its response. Showing the body may reveal
  credential bytes to you if the receiver echoed them.
  Continue?" Only on the second confirmation does the modal fetch
  and show the body.
- The response body is not persisted unless
  `storeResponseBody: true` on the subscription AND the caller
  acknowledges disclosure at save time.
- An audit row with `event: 'test'` is written in both cases;
  only the metadata row is persisted on default-no-body tests.

### Rotation UX

- Rotating a secret: service RPC regenerates; the UI shows the new
  value once (reveal-and-store flow); audit row `rotated` written.
  Externally-provisioned credentials (where the receiver issues the
  new value out-of-band) are a two-step: user pastes new value into
  the editor, then clicks Rotate; the UI calls that out as "Paste
  the new value from <receiver>, then rotate." Fixes a rev-3 nit
  about distinguishing external vs internal rotation.
- Rotating the subscription's signing key: separate action in the
  editor; shows the new verifier value once; the grace window is
  automatic (service emits both signatures until the window
  expires).

## Apprise and other presets

### `apprise` (fixing point #18 and rev-3 open question)

```yaml
preset: apprise
method: POST
# User types the Apprise base URL literally; validated as a host.
# WEBHOOK_ALLOWED_HOSTS / WEBHOOK_ALLOWED_CIDRS covers internal
# Apprise relays.
urlTemplate: "https://apprise.example/notify"
headerTemplates:
  # Optional. The editor drops this template entirely when
  # `apprise_bearer` has no stored value, BEFORE the save-time
  # validation that would otherwise fail on an unresolvable
  # secret reference.
  - name: Authorization
    valueTemplate: "Bearer {{ secrets.apprise_bearer }}"
    requiresSecret: 'apprise_bearer'    # new field: ties this header to a secret
contentType: application/json
useMinimalBody: false
bodyTemplate: |
  {
    "urls": "{{ secrets.apprise_urls }}",
    "title": "{{ issue.identifier }} {{ newStatus.name }}",
    "body": "{{ issue.title }} by {{ actor.displayName }}",
    "type": "info",
    "format": "markdown"
  }
```

A header template may declare `requiresSecret: '<name>'`. The save
pipeline **drops the whole header** when the named secret has no
value, THEN runs the "every referenced secret is present"
validation. An Apprise install without a bearer saves cleanly; the
rendered request simply omits `Authorization`.

### `slack` and `discord`

Credentials split into separate path segments so the structural `/`
is not URL-encoded. Three Slack components or two Discord
components; each is its own named secret.

### Preset validation parity

All presets go through the same validation as custom targets. No
fast path. A preset that uses an optional-with-`requiresSecret`
header passes exactly when the equivalent custom target would.

## Data model summary

```ts
// User-visible subscription doc.
TWebhookSubscription extends TDoc { ... }

// Journal: pending capture of an eligible source Tx.
// Lives in the same domain as subscriptions for single-domain
// atomicity.
TWebhookJournal extends TDoc { ... }

// Outbox row per (subscription, event, txId); authoritative queue.
TWebhookOutboxJob extends TDoc { ... }

// Attempt metadata row: identifiers, outcome, error reason, blob ref.
TWebhookDeliveryAttempt extends TDoc { ... }

// Encrypted blob holding rendered-request + rendered-response audit
// payloads. Non-broadcast; AEAD-encrypted; AAD reconstructed from
// authenticated context.
TWebhookAuditBlob extends TDoc { ... }

// Named secrets. Service-write only; AEAD-encrypted; AAD
// reconstructed from authenticated context.
TWebhookSecret extends TDoc { ... }

// Subscription-wide lease for ordered delivery.
TWebhookSubscriptionLease extends TDoc { ... }

// Durable cleanup intent; retains confidential history pruning
// state across worker crashes.
TWebhookCleanupTask extends TDoc { ... }
```

All eight are workspace-scoped; all eight route by the service's
authenticated `WorkspaceUuid`, never by doc fields.

## Testing

Unit:

- Permission middleware: non-Owner Tx creating / mutating a
  subscription is refused BEFORE storage write; compound Tx is
  walked recursively.
- Stored-owner-only destination change: Owner B's attempt to
  change A's subscription destination is refused with
  `ownerIneligible`.
- AEAD: AAD reconstructed from authenticated context; a row
  copied into another workspace fails decrypt.
- Master-key succession: rotation ring reads old + new rows
  simultaneously; retiring a key makes its rows unreadable.
- Journal realization: pre-image captured in-pipeline; crash
  before realize leaves a `pending` journal entry; sweeper
  realizes idempotently.
- Payload immutability: a retry uses the same bodyBytes as the
  first attempt; signature changes, body does not.
- Subscription-wide lease: two sweepers racing one subscription
  take exclusive leases; a newer job cannot overtake an older
  retry-pending job.
- Backlog quotas trip auto-pause and write a `backlogFull` audit
  denial.
- Signature grammar: repeated-header form and combined-header form
  parse to the same list; receiver sample code validates both; test
  vectors.
- SSRF: all private ranges on IPv4 + IPv6; IPv4-literal normalization;
  mixed public + private rejected; connection pinning; proxy CONNECT
  targets the validated IP; proxy host validated at start.
- Audit read gating: a reader without source access gets the
  redacted row shape.
- Test event body-disclosure: default returns no body; opt-in
  triggers explicit confirmation audit event.
- Cleanup task durability: TxRemoveDoc succeeds + history prune
  fails → task row retained; next sweep completes it.
- Apprise optional Authorization: absent `apprise_bearer` drops the
  header before validation; present value renders normally.

Integration:

- Full round-trip against a local HTTP sink: subscribe, trigger a
  Tx, assert signed body, assert audit blob encrypted with AEAD,
  assert attempt row carries identifiers.
- Restore handling: a same-workspace backup restored sets the
  guard flag; subscriptions behave as disabled until Owner
  reactivates each.
- Kafka ack ordering: a stalled HTTP receiver on sub A does not
  stall deliveries for sub B in another partition group.
- Cross-workspace copy of a secret row fails to decrypt in the
  destination workspace; subscription auto-pauses with
  `secretsUnreadable`.
- Owner demotion mid-queue: outbox job is refused on the next
  attempt with `ownerDemoted`; audit row written.

## Open questions for review

None blocking. If the implementation PR surfaces any, they go
through the usual review loop.
