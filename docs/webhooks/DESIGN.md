# Outbound webhook subscriptions

## Status: Design (rev 3)

This document is the design proposal for the outbound webhook feature
discussed in Platform-Collective/platform discussion #236 and issue #33.
No code lives on `feature/webhooks-design`; this doc is the whole PR.

The feature lets a workspace Owner subscribe an outbound HTTP endpoint to
Tx events in the workspace. When a matching Tx is applied, a signed POST
(or PUT) goes to the endpoint. Method, URL, headers and body are all
templated; named secrets go through a dedicated `{{ secrets.<name> }}`
namespace that never renders into logs, previews or audit rows. One
target kind (`generic`) handles every receiver via templates plus
built-in presets for `apprise`, `slack`, `discord` and bare `generic`.
One authorization story (per-attempt Owner + source-read check), one
SSRF story (DNS-pinned, no redirect, normalized IP literals), one audit
shape, one durable at-least-once delivery guarantee.

### Revision history

- **Rev 1** (`7831133506`): first draft. Separate `apprise` target kind;
  secret stored in the body; `pod-telegram-bot` claimed as the secret
  storage pattern.
- **Rev 2** (`cc250b7575`): collapsed `apprise` into a preset of
  `generic`; added named `{{ secrets.<name> }}` namespace with
  redaction; disabled redirects; HMAC v=2 covered timestamp + delivery
  id; host-change required secret rebind.
- **Rev 3** (this revision): rebuilt around MichaelUray's rev-2 review.
  Secret storage is an authenticated encryption scheme with versioned
  keys, bound to workspace + subscription + name; `pod-telegram-bot` is
  NOT the pattern (it uses `BOT_TOKEN` from env). Secret rebind is
  replaced by a destination + template binding set at creation and
  re-authorized on every destination change, so the first-save
  no-baseline gap and the same-host multi-tenant case are both covered.
  SSRF rebuilt: reject non-public by default, normalize IP literals,
  validate every A/AAAA + fallback, pin the actual connection, no
  implicit proxy. Authorization boundary moved: Settings tab is in
  **workspace** settings not per-user Integrations; every management
  endpoint, secret write, test, preview and audit read runs through a
  server-side Owner check. Delivery eligibility is re-verified on every
  attempt and every retry. `previousStatus` is captured durably at
  publish time rather than reconstructed from Tx history; `null`
  explicitly means "reconstruction incomplete." Durable at-least-once
  outbox between apply and publish; `(subscriptionId, event, txId)` is
  the full dedup key so `IssueUpdated` and `IssueStatusChange` on one
  Tx stay distinct. Per-subscription random signing key, replaced on
  rotation with version coordination. Template content-type parsing
  normalizes media types; JSON substitution is structural (placeholders
  only inside strings; validated after render). Secret redaction uses
  placeholder-first rendering (secrets never substituted into
  diagnostic output), not substring matching on bytes. `lastFour` is
  dropped for short secrets. Audit rows are read-gated on current
  source access; denied deliveries persist identifiers + reason only;
  request/response storage is opt-in with its own flag. The subscription
  owner is `AccountUuid` (not `Ref<Account>`); every queue, cache,
  dedup, lock, secret and limiter key is workspace-qualified. Presets
  pass the same validation as custom targets; empty optional headers
  are dropped; Apprise, Slack and Discord presets specify literal paths
  with separate credential path segments.

## Open questions, resolved

Three questions were open at the end of rev 2; Michael settled all three
in his rev-2 review. For the record:

1. **Service naming** → `services/webhooks/pod-webhooks`, matching
   the existing layout under `services/telegram-bot/pod-telegram-bot`
   and `services/github/pod-github`.
2. **Settings location** → a Webhooks entry under **workspace**
   settings, visible only to workspace Owners. NOT the per-user
   Integrations category: `Integrations` lives under
   `setting-account.svelte` and is used for per-user connections
   (mail, Telegram, GitHub). Workspace-scoped admin surfaces go
   elsewhere, and reusing a per-user category would have been a
   privilege-escalation vector.
3. **Expression language in templates** → **none in v1**. Several
   narrower subscriptions with `statusFilter` cover the Won/Lost case.
   A grammar can still be added later without breaking stored
   subscriptions.

## Why outbound

Teams run external integrations today by polling Huly's API from an
external worker with a long-lived token. Every operator who wants
cross-system automation runs an extra process, mints that token, and
keeps a status map in sync with the project's actual status set.
Hoisting the outbound into the platform removes the external component,
keeps the subscription set in the same backup as the workspace, and
lets a non-engineer admin maintain it from workspace settings.

## Scope

In scope for v1:

- Issue events only: `IssueCreated`, `IssueUpdated`, `IssueStatusChange`.
- Workspace Owner-managed subscriptions, per-workspace.
- Project and status filters per subscription.
- One target kind `generic` (templated method / URL / headers / body)
  with built-in presets for `apprise`, `slack`, `discord` and bare
  `generic`.
- Named, write-only secrets stored encrypted at rest with authenticated
  encryption and versioned keys. Secrets bound to workspace +
  subscription + name.
- SSRF protection: public-only by default; IP-literal normalization;
  every A/AAAA record validated per attempt; connection pinned to the
  validated IP while preserving hostname TLS verification; no implicit
  proxy; redirects disabled.
- HMAC-SHA256 over `v=2;t=<ts>;id=<deliveryId>.<bodyBytes>`, signed
  with a per-subscription random key, signed per-attempt.
- Delivery outside the transactor hot path: a Kafka-group consumer with
  a durable outbox-style job table, exponential backoff with jitter,
  per-attempt eligibility re-check, and quarantine for poison messages.
- Per-subscription audit history with current-source-access gating on
  reads; a Send-test-event action.

Explicitly out of v1 (see "Scope exclusions and follow-ups"):

- Doc and Membership events.
- Per-user personal webhook subscriptions.
- Fan-out across workspaces.
- Expression language in templates.
- Inbound HTTP (that is thomas-bouvier's #33 work).

## Coordination with #33 (inbound) and #238 (workflow-rules)

Three parallel features touch "events across the Huly boundary":

- **This feature (outbound)** - Huly to external, Tx stream to signed POST.
- **#33 (inbound)** - external to Huly, HTTP post into a Huly channel.
  Draft at thomas-bouvier/platform:feat/webhook. Separate direction,
  separate service.
- **#238 (workflow-rules)** - project-to-project status mirror inside
  one workspace. Server trigger, no external HTTP. In review.

Shared conventions:

| Concern | Proposal |
|---|---|
| Service layout | `services/webhooks/pod-webhooks` (outbound) and the inbound analogue; separate deployables; no runtime cross-dependency. |
| Secret storage | The authenticated-encryption scheme in [Secrets](#secrets); shared by both services. |
| UI home | Workspace settings with a Webhooks entry (outbound) and whatever home the inbound side picks; both admin-only, not per-user Integrations. |
| Rate limits | Sliding window keyed on `(workspace, subscriptionId)` for outbound; `(workspace, tokenId, channel)` for inbound. Shared config keys. |
| Audit | Each service writes its own `*DeliveryAttempt` collection with the same read-gate semantics; one UI component reads both. |
| Permission to manage | Workspace Owner for both. Opt-in via Settings > Configure like #238 ships. |

## Shape of a subscription

```ts
interface WebhookSubscription extends Doc {
  // Workspace-scoped. Not project-scoped; filters restrict which
  // projects it fires on. `Doc.space` is `Ref<Space>` by Platform's
  // typing; the subscription's space is the workspace's dedicated
  // settings space. The subscription routes by WorkspaceUuid taken
  // from the authenticated connection context, never from doc fields.
  space: Ref<Space>

  // Human label shown in the Settings list.
  name: string

  // Owner is the Account UUID (not a Doc ref). The delivery service
  // re-reads the source doc under this account's permissions on every
  // attempt and every retry. Immutable after create.
  owner: AccountUuid

  // Target config: templated method/URL/headers/body. See "Target".
  target: WebhookTarget

  // Monotonic version of the subscription's destination + template +
  // referenced-secret set. Incremented on every change that touches
  // any of those. Jobs carry this version at enqueue time; delivery
  // refuses a job whose version is older than the current one, which
  // closes the "someone edited the URL between enqueue and attempt"
  // window.
  revision: number

  // Metadata about named secrets. Values live in the TWebhookSecret
  // collection; this field only lists names and rotation times. No
  // "lastFour" field: a secret of four characters or fewer would be
  // fully leaked.
  secretsMeta: Array<{ name: string, lastRotatedAt: Timestamp }>

  // What fires this subscription.
  triggers: WebhookTrigger[]

  // Delivery policy.
  retryPolicy?: WebhookRetryPolicy

  // Soft-off switch. Row stays for audit when paused. Delivery service
  // re-checks on every attempt (see Delivery eligibility).
  enabled: boolean

  // Observability. Updated on every delivery attempt by the service.
  lastDeliveryAt?: Timestamp
  lastDeliveryStatus?: 'ok' | 'error' | 'skipped'
  lastDeliveryHttpCode?: number
  lastDeliveryError?: string
}

interface WebhookTarget {
  // Optional preset. When set, the subscription inherits the preset's
  // method / headers / body templates at pick time; the stored doc
  // keeps the fully resolved templates so a preset upgrade in a later
  // release does not silently change a live subscription.
  preset?: 'apprise' | 'slack' | 'discord' | 'generic'

  method: 'POST' | 'PUT'       // default POST

  // URL template. The scheme and host MUST be literal (parsed at save
  // time; a template with any placeholder before the first `/` after
  // scheme is rejected). Placeholders are only allowed in path,
  // query, and fragment, and are URL-component-encoded on render.
  urlTemplate: string

  // Header templates. Reserved names and CR/LF/NUL in rendered values
  // are rejected at save and on every render. See "Headers".
  headerTemplates: Array<{ name: string, valueTemplate: string }>

  // Request body. See "Body templates". `useMinimalBody: true` sends
  // the minimal JSON shape with no template at all.
  bodyTemplate?: string
  useMinimalBody?: boolean
  contentType?: string         // default 'application/json'

  // Destination binding. Captured at create and on every save that
  // changes URL/method/headers/body or the referenced-secret set.
  // Delivery compares the stored binding to the final rendered values
  // on every attempt; a divergence refuses the attempt as
  // `errorReason: 'bindingDrift'`. Replaces the rev-2 "lastDeliveredHost"
  // (which had no baseline on first save and did not cover shared-host
  // multi-tenant endpoints).
  binding: {
    scheme: 'https' | 'http'
    host: string              // literal from the template
    port: number | null       // literal from the template
    pathPrefix: string        // literal prefix up to the first placeholder
    bodyHash: string          // sha256 of the normalized body template
    headersHash: string       // sha256 of normalized header templates
    secretNames: string[]     // names referenced by this binding; must
                              // match secretsMeta exactly for delivery
    boundAt: Timestamp
  }
}

interface WebhookTrigger {
  event: 'IssueCreated' | 'IssueUpdated' | 'IssueStatusChange'

  // Either a specific project OR the explicit all-projects marker.
  // v1 rejects an omitted scope at save time; the Owner has to opt in
  // to "every project in the workspace" because a shared TaskType
  // means a status-only filter does not isolate one project.
  projectScope: { kind: 'project', projectId: Ref<Project> }
                | { kind: 'allProjects' }

  // For IssueStatusChange only. Explicit which side the filter
  // matches, since the issue carries both the prior and the new
  // status at delivery time.
  statusFilter?: {
    on: 'previous' | 'new'
    // Status refs are per-TaskType. The UI resolves these at pick
    // time against the chosen project's TaskType; "allProjects"
    // scope + status filter is rejected at save because the refs
    // can't be resolved consistently across TaskTypes.
    statuses: Ref<IssueStatus>[]
  }
}

interface WebhookRetryPolicy {
  maxRetries: number           // default 5
  initialBackoffMs: number     // default 2000
  backoffFactor: number        // default 2 (exponential)
  jitterMs: number             // default 500
  timeoutMs: number            // default 10000 (hard-capped at 30000)
}
```

The subscription doc lives in the workspace's dedicated settings space;
the delivery service never trusts the doc's `space` field for routing.
Every secret, queue, cache, dedup and lock key is prefixed with the
`WorkspaceUuid` taken from the authenticated service context, so two
workspaces restored from the same backup do not collide.

## Target

### Default: no template needed

A subscription that leaves `bodyTemplate` unset and `useMinimalBody:
true` gets the minimal JSON body described below with no template to
write. The signed POST plus HMAC header is the simple case.

### Minimal body (default)

```json
{
  "event": "IssueStatusChange",
  "txId": "<Ref<Tx>>",
  "deliveryId": "<uuid>",
  "timestamp": 1793235782113,
  "timestampIso": "2026-10-31T06:00:00.000Z",
  "workspace": { "uuid": "<WorkspaceUuid>", "name": "Pixelique" },
  "project": {
    "id": "<Ref<Project>>",
    "identifier": "CAL",
    "name": "Content Calendar"
  },
  "issue": {
    "id": "<Ref<Issue>>",
    "identifier": "CAL-14",
    "title": "Green Friday",
    "url": "<workspace URL>/#tracker/<project>/<issue>"
  },
  "actor": {
    "accountUuid": "<AccountUuid>",
    "displayName": "Ahmad Ismail"
  },
  "previousStatus": {
    "id": "<Ref<IssueStatus>>", "name": "Design",
    "categoryRef": "<Ref<StatusCategory>>", "categoryName": "Active"
  },
  "newStatus": {
    "id": "<Ref<IssueStatus>>", "name": "Review",
    "categoryRef": "<Ref<StatusCategory>>", "categoryName": "Active"
  }
}
```

Issue titles and `actor.displayName` are **potentially sensitive data**
and are treated that way everywhere downstream: audit rows read-gated on
current source access, request body stored only when the subscription
opts in, denied deliveries persist identifiers + reason only.

### Where `previousStatus` comes from

`TxUpdateDoc<Issue>` carries `operations.status` (the new value) but no
pre-image; the Kafka publication adds metadata but not prior values.
Rev 2 proposed reconstructing from Tx history; Michael correctly caught
that a create-in-A-then-update-to-B pattern yields `null` from an
updates-only search, and a later B→C read-and-reconstruct can misreport
A→B.

Rev 3 captures the prior status **durably at publish time**:

- When the trigger middleware applies an `TxUpdateDoc<Issue>` that
  changes `status`, it reads the issue's current status BEFORE applying
  the Tx and attaches it to the outbox job for that Tx. For
  `TxCreateDoc<Issue>` the previous status is explicitly `null`
  (creation case).
- The outbox entry (see [Durable at-least-once outbox](#durable-at-least-once-outbox))
  carries `{txId, event, previousStatusRef, newStatusRef, ...}`;
  publication is atomic with the outbox write.
- The delivery service builds the payload from the captured values; it
  never re-reconstructs from Tx history for `previousStatus`.
- If an outbox entry is missing the prior value for any reason (schema
  migration, pre-rollout history), `previousStatus` is `null` and the
  audit row logs `templateWarnings: ['previousStatusUnknown']`.
  Receivers can rely on `null` meaning "unknown", not "unchanged".

### Templates and variables

A template is a UTF-8 string with `{{ ... }}` placeholders. The variable
set is fixed:

| Variable | Value |
|---|---|
| `{{ event }}` | `IssueCreated` / `IssueUpdated` / `IssueStatusChange` |
| `{{ txId }}` | triggering Tx id |
| `{{ deliveryId }}` | delivery uuid |
| `{{ timestamp }}` | milliseconds since epoch |
| `{{ timestampIso }}` | ISO-8601 UTC string |
| `{{ workspace.uuid }}`, `{{ workspace.name }}` | workspace facts |
| `{{ project.id }}`, `{{ project.identifier }}`, `{{ project.name }}` | project facts |
| `{{ issue.id }}`, `{{ issue.identifier }}`, `{{ issue.title }}`, `{{ issue.url }}` | issue facts |
| `{{ actor.accountUuid }}`, `{{ actor.displayName }}` | the Tx author |
| `{{ previousStatus.id }}`, `{{ previousStatus.name }}`, `{{ previousStatus.categoryRef }}`, `{{ previousStatus.categoryName }}` | prior status |
| `{{ newStatus.id }}`, `{{ newStatus.name }}`, `{{ newStatus.categoryRef }}`, `{{ newStatus.categoryName }}` | new status |
| `{{ secrets.<name> }}` | a named secret, see [Secrets](#secrets) |

Rules (v1, non-negotiable):

- **Placeholders are literal.** Missing variable renders as the empty
  string and writes a `templateMiss` warning on the audit row.
- **No conditionals, loops, expressions, or nested placeholders.** The
  evaluator is a single pass over known names; anything a `{{ ... }}`
  points at that is not in the table fails closed (empty + warn).
- **Escaping is context-aware** and chosen at render time by media
  type / field:
  - **URL template:** values are URL-component-encoded
    (`encodeURIComponent` semantics). Secrets are URL-encoded like any
    other value.
  - **Header values:** values inserted raw. CR / LF / NUL in the
    rendered value is a hard reject with `errorReason:
    'headerInjection'` (checked both at save on the template and at
    render on the final value).
  - **JSON body (content type matched after media-type normalization,
    see below):** JSON substitution is **structural**, not textual.
    Placeholders are only allowed inside JSON string literals in the
    template; a placeholder outside a string (e.g. where a value is
    unquoted) is rejected at save. On render the value is JSON-escaped
    inside its string literal. After render the full body is parsed
    once as JSON; a parse failure is `errorReason: 'templateError'`
    and the request is not sent.
  - **Any other content type:** values inserted raw. The author owns
    escaping; the audit row shows the final rendered body with
    secrets redacted.
- **Media type parsing.** `contentType` is normalized by RFC 7231
  rules: the main type and subtype are extracted (`application/json;
  charset=utf-8` -> `application/json`), the result is matched
  case-insensitively, and parameters are preserved on the wire. Only
  the normalized `application/json` selects structural JSON
  substitution.
- **URL host and scheme are literal.** A template with any `{{ ... }}`
  before the first `/` after scheme is rejected at save. SSRF
  checks run on the **final rendered URL** post-templating; see
  [SSRF](#ssrf-protection).

### Secrets

Secrets are a separate concept from the subscription body.

**Storage.** The `TWebhookSecret` collection holds one row per
(subscription, name). Each row carries:

```ts
TWebhookSecret extends TDoc {
  space: Ref<Space>              // workspace settings space
  workspaceUuid: WorkspaceUuid   // for key derivation; authoritative
  subscription: Ref<WebhookSubscription>
  name: string                   // matches secretsMeta[i].name
  keyVersion: number             // which workspace key version wraps `ciphertext`
  ciphertext: Buffer             // AES-256-GCM over (nonce || tag || value)
  aad: Buffer                    // AEAD associated data; see below
  nonce: Buffer                  // 96-bit, random per encrypt
  tag: Buffer                    // 128-bit GCM auth tag
  lastRotatedAt: Timestamp
}
```

**Encryption contract.**

- **Scheme:** AES-256-GCM with a 96-bit random nonce per encrypt. GCM
  gives confidentiality and integrity in one primitive, matching the
  stored auth tag. No raw AES/ECB, no deterministic encryption, no
  "encrypt-then-serialize" hand roll.
- **Key management.** The service holds a per-service master key
  (`WEBHOOKS_MASTER_KEY`, 32 bytes, provisioned by the self-hoster
  via a Kubernetes secret / environment variable / HSM wrapper of
  their choice). Workspace-scoped data encryption keys (DEKs) are
  derived from the master key via HKDF with info =
  `"webhooks-dek-v<n>|<workspaceUuid>"`. `keyVersion` on each row
  identifies the DEK; rotation increments the version and new rows
  write at the new version while old rows stay decryptable until a
  background re-encrypt rolls them forward. The master key is never
  logged, never written to Tx bodies, never carried in queue
  payloads.
- **AEAD binding.** `aad` is
  `workspaceUuid || subscriptionId || secretName || keyVersion`.
  This binds the ciphertext to its triple so a secret copied between
  subscriptions, between workspaces, or renamed will fail
  authentication on read. Prevents cross-tenant and cross-sub
  substitution attacks.
- **No plaintext in Tx bodies.** Secret writes go through a dedicated
  service RPC that encrypts in-service and only writes the ciphertext
  row. The management API accepts `{secrets: [{name, value}, ...]}`
  on create / rotate; the response omits the plaintext. There is no
  path by which a plaintext secret reaches a persisted
  `TxCreateDoc` / `TxUpdateDoc` body.
- **Service-only decryption.** The server-side resolver is the only
  code that holds the master key. The web client cannot decrypt.
  Previews and test events run on the server, substitute secrets with
  placeholders (see Redaction), and only the final service-rendered
  diagnostic (with placeholders left in) comes back to the client.
- **Recovery and migration.** `WEBHOOKS_MASTER_KEY` is a required env
  var on service start. The self-hoster backs it up alongside the
  workspace. Loss of the key means loss of the secrets; the service
  logs `secretsUnreadable` for affected subscriptions and auto-pauses
  them. A rotation runbook in the implementation PR covers key
  succession.

**Deltas from rev 2.** `pod-telegram-bot` is NOT the pattern; it reads
`BOT_TOKEN` from env ([config.ts][tgconfig]) and does not implement
authenticated encryption, versioned keys, or per-row binding. Rev 3
specifies the scheme explicitly.

[tgconfig]: https://github.com/Platform-Collective/platform/blob/5128103d44309f01581a86f54d58210214283180/services/telegram-bot/pod-telegram-bot/src/config.ts

**Redaction (placeholder-first).**

A secret's bytes never participate in diagnostic rendering. The service
renders two parallel templates per attempt:

- **Request template**: real secret values substituted, then
  context-escaped, then HMACed, then sent on the wire.
- **Diagnostic template**: the string `[SECRET:<name>]` substituted in
  place of each `{{ secrets.<name> }}`, then context-escaped, then
  stored in audit rows and shown in previews.

This renders `[SECRET:slack_path]` where the real value would have
been, before any URL-encoding happens. The rev-2 substring-match
approach would have missed `a%2Fb` from an `a/b` secret; placeholder-
first makes the leak path shorter and correct by construction.

Audit rows persist only the diagnostic rendering. Receiver response
bodies are **not stored by default** (opt-in `storeResponseBody: true`
on the subscription), because a receiver can echo transformed values
of the secret back in its response and defeat any sender-side
redactor.

**No lastFour.** A secret of four characters or fewer is fully leaked
by `lastFour`. Rev 3 shows only `lastRotatedAt` and the name; the UI
hints "stored, write-only" instead of showing bytes.

### Destination binding (replaces rev-2 "secret rebind on host change")

Rev 2 compared the rendered URL host to `lastDeliveredHost`, which
provided no baseline before the first successful delivery and
unconditionally trusted matching hosts (missing the shared-host
multi-tenant case). Rev 3 captures a destination binding at creation
and on every destination-changing save:

```ts
binding: {
  scheme, host, port, pathPrefix,
  bodyHash, headersHash, secretNames,
  boundAt
}
```

Every save that touches `method`, `urlTemplate`, `headerTemplates`,
`bodyTemplate`, `contentType` or the referenced secret set
**re-captures** the binding and increments `revision`. Every delivery
attempt computes the final rendered binding from the current
subscription doc and compares it to the stored `target.binding`; a
mismatch fails the attempt with `errorReason: 'bindingDrift'` without
sending anything.

Changes classed as "destination-changing" require the editor to
**re-enter every referenced secret** in the same session, OR require
Owner authorization from a second Owner (configurable; defaults to
single-Owner-plus-reenter), under the "replacement values or
authorization from someone entitled to supply them for destination or
secret-placement changes" rule.

The binding also covers **where secrets land**: a save that keeps the
URL and body but moves `{{ secrets.slack_path }}` from the URL to a
header counts as a secret-placement change and triggers the same
re-enter / re-authorize flow. The `secretNames` list in the binding
is derived from parsing the templates, not from the user's declaration.

### Reserved and generated headers

Reserved header names (case-insensitive) rejected at save:

- `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`,
  `Keep-Alive`, `Proxy-*`, `Trailer`, `TE`, `Upgrade`
- Any header name starting with `X-Huly-` (case-insensitive)

Also rejected: duplicate header names (two entries that normalize to
the same lower-case name).

The service always appends on top of the user's headers:

- `Content-Type: <normalized media type>`
- `X-Huly-Signature: v=2;t=<ms>;id=<deliveryId>;s=<hex>`
  where `hex = HMAC_SHA256(signingKey, "v=2;t=<ms>;id=<deliveryId>." + bodyBytes)`
- `X-Huly-Event: <event>`
- `X-Huly-Delivery: <uuid>` (idempotency key for the receiver)
- `X-Huly-Subscription: <subscriptionId>` (for receiver-side routing)
- `User-Agent: huly-webhooks/<version>`

Signing key:

- **Per-subscription**, generated by the service at create time
  (32 bytes CSPRNG). Never shared across subscriptions; never shared
  with the receiver. Receivers verify by holding their own copy they
  obtained out-of-band when the subscription was created.
- **Rotation** of the signing key is a separate action from secret
  rotation; it creates a new `signingKeyVersion` entry and the service
  signs with the new key going forward. The old key is kept for
  `signingKeyGracePeriod` (default 10 minutes) during which the
  service signs with BOTH keys (two `X-Huly-Signature` headers) so a
  receiver running old-and-new key material can roll forward without
  dropping deliveries.
- **Signed per attempt**, not per enqueue. A delayed delivery that
  sits in the queue past its signature's acceptable age gets a fresh
  signature with a fresh timestamp when the attempt actually runs.
- The signed string explicitly covers `t` and `id`; receivers reject
  replays whose timestamp is more than `replayHorizonSeconds` away
  (default 300). Receivers that persist `deliveryId` for the replay
  horizon reject exact replays even inside the window.
- There is **no** workspace-managed `<pluginId>_hmac` key. Rev 2
  specified both, and sharing a verification key across subscriptions
  would let one receiver forge another's signatures.

## Presets

A preset ships a fully resolved template set. The user picks a preset
at edit time; the stored subscription keeps the resolved templates so
a later preset bump does not change a live subscription silently.

### `apprise`

Michael flagged that rev-2's `secrets.apprise_base` violated the
literal-host rule. Rev 3 puts the base in a **plain `url` field** that
the user types in; only credentials go through secrets. The author is
free to point at an internal Apprise relay (`WEBHOOK_ALLOWED_HOSTS`
covers that path).

```yaml
method: POST
urlTemplate: "https://apprise.internal.example/notify"   # user supplies, literal
headerTemplates:
  - name: Authorization
    valueTemplate: "Bearer {{ secrets.apprise_bearer }}"   # omitted on render if secret missing
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

An empty optional header is **omitted on render** (not sent as
`Authorization: Bearer `). The behavior is explicit: a header whose
rendered value is empty after all substitution is dropped from the
request. Documented in the audit row as `omittedHeaders:
['Authorization']`.

### `slack` and `discord`

Slack's incoming webhook URL has three path segments; Discord has two.
Rev 3 splits them so the `/` separator isn't URL-encoded:

```yaml
# slack
urlTemplate: "https://hooks.slack.com/services/{{ secrets.slack_t }}/{{ secrets.slack_b }}/{{ secrets.slack_c }}"
```

```yaml
# discord
urlTemplate: "https://discord.com/api/webhooks/{{ secrets.discord_id }}/{{ secrets.discord_token }}"
```

The user enters three Slack components or two Discord components when
creating; each lands in its own named secret. URL-component encoding
on an opaque token has no effect; splitting the structural `/` out of
the secret keeps the URL well-formed.

### `generic` (bare)

User writes method / URL / headers / body themselves. Default when the
user picks "custom".

**All presets go through the same template validation as a custom
target.** No fast path, no "trusted" preset shape; the save pipeline
rejects a preset the same way it rejects a hand-written template that
violates any rule.

## SSRF protection

All checks run on the **final rendered URL** post-templating. The URL
template requires a literal scheme + host + port, so event data cannot
steer the destination; see "Templates and variables".

### Address and transport policy

- **Public-only by default.** Reject if any resolved address is in a
  non-public range:
  - IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT),
    `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`,
    `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`,
    `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`,
    `224.0.0.0/4`, `240.0.0.0/4`.
  - IPv6: `::1/128`, `fc00::/7`, `fe80::/10`, `::/128`,
    IPv4-mapped `::ffff:0:0/96` (expanded and the embedded IPv4 is
    re-checked against the IPv4 table above), IPv4-compatible
    `::0.0.0.0/96`, 6to4 `2002::/16` (reserved for the embedded
    IPv4), teredo `2001::/32`.
  - IPv4 literals in any form Node's `net.isIP` recognises
    (`127.1`, `0x7f.0.0.1`, octal) are normalized to dotted-quad
    before the check.
- **Validate every A/AAAA.** Resolve to the full RRset; reject if
  any resolved address falls in a non-public range. A hostname whose
  record set mixes public and private addresses is still rejected
  because the connection could race either way.
- **Pin the connection, not just the resolution.** The HTTP client
  connects to the explicitly validated IP (passing a custom `lookup`
  function to Node's `net.createConnection`) rather than letting
  libc / libresolver run its own lookup during connect. TLS hostname
  verification stays against the subscription's URL hostname, so an
  attacker who can race DNS cannot swap in a cert for the
  destination.
- **No implicit proxy.** The HTTP client ignores `HTTP_PROXY`,
  `HTTPS_PROXY`, `NO_PROXY`, system proxy settings, and PAC-file
  resolution. A self-hoster who needs an explicit outbound proxy
  provides it via `WEBHOOK_EXPLICIT_PROXY=https://proxy.example:3128`;
  the service then resolves the proxy's host under the SSRF rules
  too and uses that one proxy for every request.
- **Redirects disabled.** 3xx is a delivery error
  (`errorReason: 'redirect'`); the admin fixes the receiver side.
- **Protocol whitelist.** `https://` only by default. `http://`
  accepted only when `WEBHOOK_ALLOW_HTTP=true` AND the host is in
  `WEBHOOK_ALLOWED_HOSTS`.
- **Self-hoster host allowlist.** `WEBHOOK_ALLOWED_HOSTS` is a
  comma-separated list of (host, port) tuples that bypass the
  non-public range check but still go through connection pinning
  and TLS verification. Required for self-hosters running an Apprise
  instance on the same Docker network.
- **Timeout + response cap.** `timeoutMs` default 10s, hard cap 30s.
  Response body cap 8KB (read-and-truncate).

### Known limits

- An on-path attacker who controls the DNS server AND the destination
  AND is MITMing TLS can still substitute addresses; TLS cert pinning
  per subscription is a future extension if a workspace needs it.
- IPv6 scope IDs (`fe80::1%eth0`) are rejected outright.
- IDN hostnames are normalized with `URL`'s own IDNA before the
  resolver call; display stays Unicode in the audit row.

## Authorization

**Boundary.** The Webhooks settings tab lives under **workspace
settings**, visible only to workspace Owners. It is NOT in the
`setting-account` category (which `settings-account.svelte` serves and
is per-user). Rev 2 proposed Settings > Integrations; rev 3 corrects
that because Integrations is a user-visible category and would be a
privilege-escalation vector.

### Server-side enforcement

Every management endpoint, secret write, test action, preview, and
audit read runs through an **Owner check against the current workspace
membership**. The check is enforced on the server, in the trigger
middleware, not just in the UI:

- Creation / edit / enable / disable / delete of `WebhookSubscription`:
  Owner required.
- Creation / rotation / deletion of `TWebhookSecret`: Owner required.
- Test-event action: Owner required AND the owner (as stored on the
  subscription) must currently have source access.
- Preview rendering: Owner required AND the caller must currently
  have source access to the preview's chosen issue. The preview
  server-side substitutes `[SECRET:<name>]` placeholders so the
  caller does not need secret-read permission (secrets are
  service-only decrypt anyway).
- Audit read: Owner required AND, for each row returned, the current
  caller must have source access to the referenced doc. Rows the
  caller cannot access are filtered out; the UI shows "N denied
  entries" with no identifiers.

Server-side checks:

- `WebhookSubscription.owner` is bound at create and immutable; a Tx
  that tries to change `owner` is rejected by the trigger middleware.
- `WebhookSubscription.revision` is service-maintained; a Tx from a
  client that tries to decrement it or hold it steady while changing
  a destination-binding field is rejected.
- `TWebhookSecret` rows are service-written only; no client Tx may
  create or update the collection. The management RPC writes them.

### Delivery eligibility (per attempt and per retry)

Right before every outbound HTTP call, including every retry and
every test event, the delivery service re-checks:

- The plugin is still enabled in Settings > Configure
  (`PluginConfiguration.enabled === true`, same as #238).
- The subscription doc still exists and is still enabled.
- The subscription owner is still a workspace member AND still holds
  the Owner role in the workspace. A demoted owner may still legally
  read the source issue, but the Owner-managed export policy means a
  demoted owner cannot fire a webhook they could not create today.
- The source issue still exists and the subscription owner currently
  has read access to it. Dropped if revoked.
- The target project exists and is not archived and (for
  `TypedSpace`) not restricted.
- The job's `revision` matches the subscription's current `revision`.
  A later edit (destination change, re-bind, etc) invalidates
  in-flight jobs created against the earlier revision.
- The target `binding` on the current doc matches the computed
  rendered binding (bindingDrift guard).

Any of those failing drops the attempt with the matching
`errorReason`. The job is removed from the outbox (unless the failure
is transient, in which case it stays and retries by backoff).

## Delivery pipeline

### Durable at-least-once outbox

The server applies a Tx and responds to the client before publication
to the Kafka Tx stream (see
[`client.ts`][client-apply]), and publication happens during
[broadcast][broadcast-queue]. A crash in the window between apply
and publish loses events. Rev 2 implicitly accepted that gap. Rev 3
closes it with an **outbox**:

[client-apply]: https://github.com/Platform-Collective/platform/blob/5128103d44309f01581a86f54d58210214283180/foundations/server/packages/server/src/client.ts
[broadcast-queue]: https://github.com/Platform-Collective/platform/blob/5128103d44309f01581a86f54d58210214283180/foundations/server/packages/middleware/src/queue.ts

- The trigger middleware for `WebhookSubscription`-eligible Txes
  computes the match set INSIDE the transaction that applies the Tx
  (reads from the current snapshot of subscriptions, triggers,
  owner, revision, binding) and writes an outbox row per match:

  ```ts
  TWebhookOutboxJob extends TDoc {
    space: Ref<Space>
    workspaceUuid: WorkspaceUuid
    subscription: Ref<WebhookSubscription>
    revision: number                 // sub revision at enqueue
    event: WebhookTrigger['event']
    txId: Ref<Tx>
    txModifiedOn: Timestamp
    previousStatus: StatusSnapshot | null
    newStatus: StatusSnapshot | null
    actorPersonId: PersonId
    issueRef: Ref<Issue>
    projectRef: Ref<Project>
    state: 'pending' | 'in_flight' | 'done' | 'failed' | 'quarantined'
    attempts: number
    nextAttemptAt: Timestamp | null
    lockedBy: string | null
    lockedUntil: Timestamp | null
    terminalReason: string | null
  }
  ```

- The outbox row is written in the same transaction as the Tx apply,
  so a crash after apply still leaves the job in the outbox for
  recovery.
- The delivery service polls the outbox for ready jobs
  (`state === 'pending'` AND `nextAttemptAt <= now`) with a Kafka
  consumer group that owns ordered consumption per `(workspaceUuid,
  subscriptionId)` partition key, ensuring per-receiver order and
  parallelism across subscriptions.
- Jobs are claimed with an optimistic lock
  (`lockedBy, lockedUntil`) and processed one at a time per
  subscription. A worker crash releases the lock on timeout.
- `(subscriptionId, event, txId)` is the full dedup key; the outbox
  has a unique index on it so re-enqueueing an identical event is a
  no-op. `IssueUpdated` and `IssueStatusChange` on the same Tx are
  distinct jobs because `event` is in the key (rev 2 would have
  collapsed them).

### At-least-once contract

- The service guarantees **at-least-once** delivery; receivers must
  deduplicate on `X-Huly-Delivery`.
- A crash between a successful HTTP 2xx and the outbox state write
  can cause one duplicate (worker died before marking `done`); the
  recovery sweep retries, and the receiver's dedup absorbs it.
- The outbox row keeps its ID across restarts; terminal states
  (`done`, `failed`, `quarantined`) are persisted before the service
  acknowledges Kafka consumption.

### Stages

1. **Apply + outbox write** in the Tx middleware. Status pre-image
   is read inside the Tx.
2. **Kafka publication** of the Tx happens as before; the webhooks
   service also subscribes to the stream, but the stream is the
   trigger not the source of truth. If Kafka missed a publish, the
   outbox sweeper picks the job up on its own.
3. **Claim** a job (optimistic lock, exponential nextAttemptAt).
4. **Eligibility re-check** (section
   [Delivery eligibility](#delivery-eligibility-per-attempt-and-per-retry)).
5. **Render** request + diagnostic templates. Diagnostic is stored.
6. **Validate binding** against the current subscription doc.
7. **Sign** per-attempt with fresh timestamp + deliveryId.
8. **Deliver** via DNS-pinned HTTPS, no redirects.
9. **Audit** write.
10. **Mark job state** terminal or scheduled.

### Retries, backoff, and quarantine

- Exponential backoff with full jitter:
  `delay = min(cap, random(0, initial * (factor ** attempt))) + jitter`.
- `maxRetries` default 5 → 2s, 4s, 8s, 16s, 32s.
- `X-Retry-After` from the receiver honored, bounded by `cap`.
- A **permanent failure** (`bindingDrift`, `ownerLostAccess`,
  `headerInjection`, `templateError`, `ssrf`, `pluginDisabled`,
  `subscriptionDisabled`, 4xx with no `Retry-After`) marks the job
  `failed` immediately without retry.
- A job that exhausts `maxRetries` with transient errors is marked
  `quarantined` and sits in a dead-letter list visible in the UI.
  An Owner can retry or discard it; it does not block other jobs on
  the same subscription.
- **Poison-message isolation**: the Kafka consumer uses stream order
  and per-subscription in-flight limiting, so a deterministic
  failure on one subscription does not stall unrelated workspaces
  sharing a partition. The outbox is the authoritative queue for
  retries; Kafka re-reads only re-check against the outbox.

### Rate limits

- Per subscription: `maxDeliveriesPerMinute` default 30, sliding
  window.
- Per workspace: `maxWorkspaceDeliveriesPerMinute` default 300.
- Test events, retries, and initial attempts all count against the
  same budgets.
- If a subscription stays saturated for `saturationWindows` default
  10 consecutive windows, auto-pause the subscription with
  `lastDeliveryStatus: 'skipped'` and a notice in the UI. An Owner
  re-enables manually.

## Audit

```ts
TWebhookDeliveryAttempt extends TDoc {
  space: Ref<Space>
  workspaceUuid: WorkspaceUuid
  subscription: Ref<WebhookSubscription>
  event: WebhookTrigger['event'] | 'test' | 'skipped' | 'rotated' | 'bindingChanged'
  txId: Ref<Tx>
  deliveryId: string
  attempt: number
  at: Timestamp
  method: 'POST' | 'PUT'
  renderedUrlDiagnostic: string      // secrets as [SECRET:<name>]
  renderedHeadersDiagnostic: Array<{ name: string, value: string }>
  renderedBodyDiagnostic: string     // may be stored only if subscription opts in
  omittedHeaders: string[]           // empty-value headers dropped on render
  bodyStored: boolean                // true only if subscription.storeResponseBody
  httpCode?: number
  outcome: 'ok' | 'error' | 'skipped'
  errorReason?:
    | 'ssrf' | 'ownerLostAccess' | 'ownerDemoted' | 'rateLimit' | 'timeout'
    | 'nonTwoxx' | 'templateError' | 'headerInjection' | 'redirect'
    | 'bindingDrift' | 'pluginDisabled' | 'subscriptionDisabled'
    | 'secretsUnreadable' | 'poisonQuarantined' | 'other'
  errorMessage?: string              // redacted
  truncatedResponse?: string         // 8KB cap; stored only if storeResponseBody
  templateWarnings?: string[]        // e.g. ['missingVariable:actor.email']
  // Identifiers only (for a 'denied' row):
  denyMeta?: {
    reason: 'ownerLostAccess' | 'ownerDemoted' | 'subscriptionDisabled'
            | 'pluginDisabled'
    issueRef: Ref<Issue>
    at: Timestamp
  }
}
```

**Confidentiality controls.**

- **Read-gating.** Reading an audit row requires workspace Owner
  AND current source access on the referenced doc. The query
  middleware filters a page of audit rows and reports a count of
  denied rows separately; the UI shows `N denied entries` without
  identifiers for those.
- **Default minimal storage.** Request body and response body are
  stored only when the subscription opts in via `storeResponseBody:
  true` on `TWebhookSubscription`. Otherwise the audit row persists
  identifiers (`txId`, `deliveryId`, `event`), the diagnostic URL
  with `[SECRET:*]` placeholders, header names (not values), and
  the outcome.
- **Denied-delivery rows.** When eligibility fails (owner lost
  access, demoted, etc) the row writes `denyMeta` with just the
  identifiers and the reason; no issue title, no actor name, no
  rendered body. The intent is a count-and-reason surface for the
  Owner without re-exposing the information the owner lost access
  to.
- **Retention per storage layer.** `TWebhookDeliveryAttempt` rows
  roll off at `attemptRetentionDays` default 30. The underlying
  Tx bodies for the rows are also pruned by a dedicated cleanup
  worker (see below) because deleting the Doc does NOT by itself
  purge the Tx history. Separately, the outbox job rows have their
  own retention; a `done` or `failed` job keeps for
  `outboxRetentionDays` default 7.
- **Cleanup worker.** A daily job on the server:
  - Reads expired `TWebhookDeliveryAttempt` and `TWebhookOutboxJob`
    rows, bounded batch size 500, over at most N minutes.
  - For each, issues a `TxRemoveDoc` AND a direct
    low-level cleanup of the `TxCreateDoc` / `TxUpdateDoc` bodies
    for those rows (same shape as other audit roll-offs in the
    fork; the implementation PR will reference the exact helper).
  - On failure, writes a `cleanupFailure` metric; on 3 consecutive
    failures, pages the operator.
- **Backups.** The implementation PR must call out that backups
  taken before a roll-off still contain the original data. A
  restored backup goes through the Restore handling in [UI](#ui)
  before the delivery service dispatches anything from it.

## UI

Workspace settings > Webhooks tab.

Visible to Owners when the plugin is enabled in Settings > Configure.
The tab registration (in `models/all/src/index.ts` style) checks
`AccountRole.Owner` on render; a non-Owner never sees the entry.

Per subscription row: Name, preset badge, URL host (full URL hidden -
secrets masked). Enabled toggle (atomic apply). Last delivery panel:
timestamp, status, response code, diagnostic body preview with
`[SECRET:*]`. Actions: Edit, Send test event, Delete (with confirm).

Editor:

- Name
- Preset: apprise / slack / discord / generic
- Method, URL template (host literal; URL preview on blur)
- Header list (reserved names blocked, CR/LF rejected on blur)
- Content type + body template OR "Use minimal body"
- Named secrets panel: add / rotate / remove. Values entered here,
  never shown back. `lastRotatedAt` for each.
- Triggers: event + `projectScope` (specific project OR explicit
  all-projects) + `statusFilter` (previous or new) with
  TaskType-resolved status picker. "allProjects" + statusFilter is
  blocked at save.
- Retry policy, collapsed by default.
- **Render preview**: picks a recent matching issue the caller can
  read; renders URL / headers / body with `[SECRET:*]`
  placeholders; shows the shape that will be POSTed. Preview goes
  through the exact server-side renderer the delivery path uses.

Save:

- All template validations run server-side.
- If any destination-binding field changed, the editor requires
  every referenced secret to be re-entered this session (or a second
  Owner's authorization, if the workspace policy demands it).
- `revision` increments on the saved doc.

Send test event:

- Picks the most recent matching Issue in the first project trigger
  (or an explicit stub if none).
- Builds the payload with real values.
- POSTs with the live signed body.
- Shows the diagnostic (redacted) request preview AND the response
  (code + first 2KB) in a modal.
- Writes an audit row with `event: 'test'`. Counts against the rate
  limit.

**Restore and clone behavior.**

A backup restored into a different workspace (or a dev workspace) can
contain enabled subscriptions whose endpoints are production
receivers. Rev 3 handles that explicitly:

- On service start, the delivery service compares the restored
  workspace's `WorkspaceUuid` against the UUID in the signing key
  derivation; a mismatch (which happens on cross-workspace restore
  because the master key's HKDF info includes workspace uuid) means
  secrets are unreadable, which cascades to `secretsUnreadable` on
  every subscription and auto-pause.
- The restore worker (if any) writes a one-time banner in the UI:
  "Webhook subscriptions were restored. Deliveries are paused.
  Review destinations and re-enter credentials to re-enable."
- The implementation PR documents the key succession runbook.

## Data model summary

Four Docs:

- `TWebhookSubscription` - the user-visible subscription doc.
- `TWebhookSecret` - one row per (subscription, name), encrypted.
- `TWebhookOutboxJob` - one row per (subscription, event, txId),
  the authoritative queue state.
- `TWebhookDeliveryAttempt` - one row per attempt; audit surface.

All four are workspace-scoped and all four roll off on their own
schedule. The cleanup worker is one process reading from each
collection in turn.

## Testing

Unit:

- Template parse: rejects placeholder in URL host; rejects
  placeholder outside a JSON string in a `bodyTemplate` with
  normalized `application/json`; parses the final body as JSON and
  rejects on parse failure.
- Media type normalization: `application/json; charset=utf-8`
  selects structural substitution; `application/json` does;
  `text/plain; charset=utf-8` selects raw.
- Header validation: CR / LF / NUL in rendered value rejected;
  duplicate header names rejected; reserved names rejected.
- URL template: `encodeURIComponent` on path/query/fragment
  values; secrets URL-encoded like any other.
- IP literal normalization: `127.1`, `0x7f.0.0.1`,
  `[::ffff:127.0.0.1]` all map to loopback and are rejected.
- Multi-A/AAAA: mixed public + private rejected.
- Connection pinning: resolver returns multiple IPs, the client
  connects to the one validated by the service; TLS hostname
  verification stays on the subscription hostname.
- Proxy env ignored unless `WEBHOOK_EXPLICIT_PROXY` is set.
- Redirect: 302 is a delivery error, no follow.
- Secret encrypt/decrypt roundtrip with AEAD on a correct aad;
  wrong aad fails.
- Key version migration: a row at v1 stays decryptable after a v2
  is minted; new writes use v2.
- Redaction: placeholder-first rendering never substitutes the
  real value into diagnostic output.
- No `lastFour`: a 3-char secret has no exposed metadata beyond
  name + rotation timestamp.
- Binding drift: changing header template invalidates binding;
  delivery refuses attempt.
- Revision guard: a job at revision N is refused when the
  subscription is at revision N+1.
- Event-type in dedup key: `IssueUpdated` and `IssueStatusChange`
  on the same Tx produce two outbox jobs.
- Signing: per-sub key is used; HMAC covers rendered body +
  timestamp + deliveryId; signing-key rotation grace period emits
  two signatures.
- Replay horizon: a receiver can reject by timestamp.
- previousStatus: captured at publish time; outbox row carries
  it; a missing capture yields `null` and `templateWarnings`.
- Owner demotion: delivery refused mid-queue, audit row written.
- Audit read gating: a non-Owner read is refused; an Owner read
  that lost source access on a specific issue filters that row.
- Cleanup worker: `TxCreateDoc` and `TxUpdateDoc` bodies for
  rolled-off rows are also pruned.

Integration:

- Full round-trip against a local HTTP sink: subscribe, trigger a
  Tx, assert signed body with per-sub key, assert `renderedBody`
  stored only when `storeResponseBody` is set.
- Outbox durability: kill the service between apply and publish;
  on restart, the outbox has the row and delivery runs.
- At-least-once with receiver dedup: force a worker crash between
  2xx and job state write; the retry fires; the receiver (holding
  `X-Huly-Delivery`) rejects the duplicate.
- Cross-workspace restore: an encrypted secret from workspace A
  copied into workspace B fails AEAD auth; the subscription
  auto-pauses with `secretsUnreadable`.
- Rate limit: 31st delivery in 60s queues; 10 saturated windows
  pause the sub.
- Preview access gating: a non-Owner request is refused; an Owner
  without source access on the chosen issue is refused.

## Scope exclusions and follow-ups

- **Doc and Membership events.** The subscription model carries them;
  the delivery service grows a Doc / Membership path once Issue is
  proven. Each new event type adds its own variable set and audit
  shape.
- **Per-user personal subscriptions.** Different authorization story;
  deferred.
- **Multi-workspace fan-out.** Not v1.
- **Expression language.** Not v1 (Michael pinned this). A tiny
  grammar can be added later without breaking stored subscriptions.
- **GUI template editor with autocomplete.** v1 ships a `<textarea>`
  plus the variable reference drawer.
- **TLS cert pinning per subscription.** Future extension if a
  workspace needs it.
- **Second-Owner authorization for destination changes.** Rev 3
  specifies the mechanism; whether to enable it by default or make
  it an opt-in workspace policy is deferred to the implementation
  PR.
