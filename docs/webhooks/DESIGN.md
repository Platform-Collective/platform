# Outbound webhook subscriptions

## Status: Design

This document is the design proposal for the outbound webhook feature discussed
in Platform-Collective/platform discussion #236 and issue #33. It will be the
companion doc of the eventual implementation PR. No code lives on
`feature/webhooks-design`; this doc is the whole PR.

The feature lets a workspace admin subscribe an outbound HTTP endpoint to Tx
events in the workspace. When a matching Tx is applied, a signed POST goes to
the endpoint. The payload is either the plugin's default minimal shape or a
template the subscriber supplies. Target types ship with a generic HTTP target
and an Apprise-compatible target; the architecture allows additional target
types without touching the delivery service's hot path.

## Why outbound

Teams already run external integrations: Slack notifications, n8n flows,
Apprise relays, custom endpoints. Today they poll Huly's API from an external
worker with a long-lived token to catch "when X happens in Huly, do Y
elsewhere" cases. That means every operator who wants cross-system automation
runs an extra process, mints a long-lived token, and keeps a status map in
sync with the project's actual status set. Hoisting the outbound into the
platform removes the external component, keeps the subscription set in the
same backup as the workspace, and lets a non-engineer admin maintain it from
Settings > Integrations.

## Scope

In scope for v1:

- Issue events only: `IssueCreated`, `IssueUpdated`, `IssueStatusChange`.
- Workspace-admin-managed subscriptions, per-workspace.
- Project and status filters per subscription.
- Target types: `generic` (any HTTPS endpoint) and `apprise` (Apprise API
  server).
- Payload: a minimal default shape OR a user-supplied template with a
  documented variable set.
- Secure secret storage, one-time reveal on create, rotation.
- SSRF protection with DNS pinning and redirect re-check.
- Delivery outside the transactor hot path: a queue consumer with retries,
  deduplication, and rate limits.
- Per-subscription audit history and a Send-test-event action.

Explicitly out of v1 (see Follow-ups):

- Doc and Membership events. The subscription model supports them in principle;
  the delivery service does not resolve them. Added once Issue is proven.
- Per-user personal webhook subscriptions. v1 is workspace-admin only.
- Fan-out across workspaces for a global integration. v1 is one subscription
  per workspace.
- Auto-create of linked documents in response to inbound events. That is
  thomas-bouvier's inbound work in #33.

## Coordination with #33 (inbound) and #238 (workflow-rules)

Three parallel features touch "events across the Huly boundary":

- **This feature (outbound)** - Huly to external, Tx stream to signed POST.
- **#33 (inbound)** - external to Huly, HTTP post into a Huly channel. A
  draft lives at thomas-bouvier/platform:feat/webhook. Separate direction,
  separate service.
- **#238 (workflow-rules)** - project-to-project status mirror inside one
  workspace. Server trigger, no external HTTP. Already in review.

Shared conventions proposed here, open to a counter-proposal from
@thomas-bouvier:

| Concern | Proposal |
|---|---|
| Service layout | Each direction a separate `pod-*` or `services/*` dir, consuming workspace Tx queue (outbound) or exposing HTTP (inbound). No cross-service dependencies. |
| Secret storage | Reuse the mechanism `pod-telegram-bot` already uses (encrypted-at-rest with the workspace key); one-time reveal on create; rotate button regenerates the secret and invalidates in-flight state. Same for both directions. |
| UI home | Settings > Integrations tab, two subsections: "Outgoing" and "Incoming". Mirror look-and-feel. |
| Rate limits | Sliding window at (subscriptionId, workspace) for outbound; (tokenId, channel) for inbound. Shared config keys in server. |
| Audit history | Each service writes its own `*DeliveryAttempt` collection with the same shape: `{at, status, httpCode, truncatedResponse}`. UI reads both with one component. |
| Permission to manage | Workspace Owner for both; opt-in via Settings > Configure like #238 ships. |

The two services never share code at runtime, but they share conventions so a
self-hoster sees one shape of integration surface, one way to rotate a secret,
one tab in Settings.

## Shape of a subscription

```ts
interface WebhookSubscription extends Doc {
  // Workspace-scoped. Not project-scoped - the subscription itself lives at
  // workspace level; filters restrict which projects it fires on.
  space: Ref<Workspace>

  // Human label shown in the Settings list.
  name: string

  // Target type decides how the payload is shaped and the URL interpreted.
  // See "Target types" below.
  target: WebhookTarget

  // Who owns the subscription. The delivery service re-reads the source doc
  // under THIS account's permissions on every delivery and retry; a
  // delivery is dropped if the owner lost read access since the Tx fired.
  // Required at creation; cannot change afterwards.
  owner: Ref<Account>

  // Deduplication identity. HMAC key for `generic` target; opaque bearer
  // or Apprise URL fragment for `apprise` target. Encrypted at rest with
  // the workspace key, revealed only once at creation, rotatable.
  // The persisted doc exposes only `secretLastFour` to the UI.
  secretId: Ref<EncryptedSecret>
  secretLastFour: string

  // What fires this subscription.
  triggers: WebhookTrigger[]

  // Payload shape. See "Payload" below.
  payload: WebhookPayload

  // Delivery policy.
  retryPolicy?: WebhookRetryPolicy

  // Soft-off switch. Row stays for audit when paused.
  enabled: boolean

  // Observability. Updated on every delivery attempt by the service.
  lastDeliveryAt?: Timestamp
  lastDeliveryStatus?: 'ok' | 'error' | 'skipped'
  lastDeliveryHttpCode?: number
  lastDeliveryError?: string
}

type WebhookTarget =
  | { kind: 'generic', url: string }
  | { kind: 'apprise', url: string }

interface WebhookTrigger {
  event: 'IssueCreated' | 'IssueUpdated' | 'IssueStatusChange'
  // Narrows to one project. Omitted = any project in the workspace.
  projectFilter?: Ref<Project>
  // For IssueStatusChange: narrows to specific statuses on the source side.
  // Status refs are per-TaskType so a filter is scoped to one project unless
  // intentionally cross-project (which the UI discourages).
  statusFilter?: Ref<IssueStatus>[]
}

type WebhookPayload =
  | { kind: 'minimal' }                     // default - see "Minimal payload"
  | { kind: 'minimalPlusDoc' }              // minimal + full source doc, opt-in
  | { kind: 'template', body: string, contentType?: string }

interface WebhookRetryPolicy {
  maxRetries: number           // default 5
  initialBackoffMs: number     // default 2000
  backoffFactor: number        // default 2 (exponential)
  jitterMs: number             // default 500
  timeoutMs: number            // default 10000
}
```

### Target types

#### `generic`

Any HTTPS endpoint. The delivery service POSTs the computed body with:

- `Content-Type: application/json` (or the template's `contentType`).
- `X-Huly-Signature: sha256=<hex>` with
  `hex = HMAC_SHA256(secret, bodyBytes)`.
- `X-Huly-Event: IssueStatusChange` (etc).
- `X-Huly-Delivery: <uuid>` idempotency key for the receiver.
- `User-Agent: huly-webhooks/<version>`.

Receivers must respond `2xx` within `timeoutMs` or the delivery is retried per
`retryPolicy`.

#### `apprise`

Posts to an Apprise API server endpoint (typically `POST /notify`). The
subscription's `url` is the Apprise API base; the service appends the
`/notify` path. The body is the Apprise JSON contract:

```json
{
  "urls": "<the Apprise destination URLs, from the secret>",
  "title": "<rendered from template or minimal>",
  "body": "<rendered>",
  "type": "info" | "success" | "warning" | "failure",
  "format": "text" | "markdown" | "html"
}
```

The subscription's `secret` holds the Apprise URL set (`mailto://`,
`slack://`, `discord://`, etc) and is never POSTed to any other target. The
Apprise server's own token (if any) is passed via `Authorization: Bearer`
drawn from a separate `apiKey` field - a self-hoster can run an open Apprise
API on an internal network and skip the bearer.

`type` is derived from the triggered event: `IssueCreated` -> `info`,
`IssueStatusChange` to Won -> `success`, Lost -> `failure`, else `info`.
`format` defaults to `markdown` so `**` and backticks render as expected on
Slack/Discord.

### Payload

#### Minimal (default)

```json
{
  "event": "IssueStatusChange",
  "txId": "<Ref<Tx>>",
  "timestamp": 1793235782113,
  "workspace": { "id": "<uuid>", "name": "Pixelique" },
  "project": {
    "id": "<Ref<Project>>",
    "identifier": "CAL",
    "name": "Content Calendar"
  },
  "issue": {
    "id": "<Ref<Issue>>",
    "identifier": "CAL-14",
    "title": "Green Friday"
  },
  "actor": {
    "accountUuid": "<AccountUuid>",
    "displayName": "Ahmad Ismail"
  },
  "previousStatus": { "id": "<Ref<IssueStatus>>", "name": "Design", "category": "Active" },
  "newStatus": { "id": "<Ref<IssueStatus>>", "name": "Review", "category": "Active" }
}
```

No PII beyond identifiers. The issue title ships because without it the
receiver cannot write a useful notification. If a workspace needs stricter
privacy, a future `includeTitle: false` flag can mask that field.

#### Minimal + full doc (`minimalPlusDoc`, opt-in per subscription)

The minimal payload plus `"source": {...}` carrying the whole Issue document
as the server read it. The owner must have read access AT DELIVERY TIME: if
their permission changed between the Tx and the delivery (or retry), the
delivery is dropped and audited.

#### Template (user-supplied body with variables)

The subscriber provides a UTF-8 string with `{{...}}` placeholders. At
delivery time the service substitutes known variables and sends the result as
the request body. `contentType` defaults to `application/json`; for Slack-
style blocks or form-encoded webhooks the subscriber supplies a different
type.

Variables available in a template:

| Variable | Value |
|---|---|
| `{{event}}` | `IssueCreated` / `IssueUpdated` / `IssueStatusChange` |
| `{{txId}}` | the triggering Tx id |
| `{{timestamp}}` | ISO-8601 string |
| `{{timestampMs}}` | milliseconds since epoch |
| `{{workspace.id}}`, `{{workspace.name}}` | workspace facts |
| `{{project.id}}`, `{{project.identifier}}`, `{{project.name}}` | project facts |
| `{{issue.id}}`, `{{issue.identifier}}`, `{{issue.title}}`, `{{issue.url}}` | issue facts; `url` is the workspace URL plus `/#tracker/<project>/<issue>` |
| `{{actor.accountUuid}}`, `{{actor.displayName}}` | the Tx author |
| `{{previousStatus.id}}`, `{{previousStatus.name}}`, `{{previousStatus.category}}` | prior status (`IssueStatusChange` only) |
| `{{newStatus.id}}`, `{{newStatus.name}}`, `{{newStatus.category}}` | new status (same) |
| `{{deliveryId}}` | this delivery's uuid |

Template substitution rules:

- Placeholders are literal; a missing variable renders as the empty string
  and a warning line is recorded in `WebhookDeliveryAttempt`.
- Values are JSON-escaped by default so the template is safe to use inside a
  JSON structure without double-quoting. For non-JSON bodies the subscriber
  marks that with `contentType: 'text/plain'` and escaping switches to a raw
  string pass-through.
- No conditionals, loops, or expressions. The variable set is small on
  purpose: a Seerr-style template language has a per-feature cost (XSS in
  server-rendered templates, surprising escaping, injection via nested
  placeholders) that is not justified when the receiver can shape its own
  response.

Example template for a Slack incoming webhook:

```
{
  "text": "*{{issue.identifier}}* {{issue.title}} moved to *{{newStatus.name}}* by {{actor.displayName}}",
  "attachments": [{"text": "<{{issue.url}}|Open in Huly>"}]
}
```

Example template for Discord:

```
{"content": ":mag_right: `{{issue.identifier}}` {{issue.title}} is now **{{newStatus.name}}** ({{actor.displayName}}) {{issue.url}}"}
```

Example for Apprise (via the `apprise` target type, which already fills
`title`/`body`/`type`/`format` from the minimal payload - templates are
accepted for `generic` only).

## Delivery pipeline

```
+---------+     +--------------------+     +----------------+     +------------+
|  Tx     | --> | tx queue (per ws)  | --> | match sub      | --> |  delivery  |
| applied |     | (existing stream)  |     | resolve owner  |     |  queue     |
+---------+     +--------------------+     | check access   |     +------------+
                                           | build payload  |             |
                                           +----------------+             v
                                                                   +---------------+
                                                                   | HTTP POST     |
                                                                   | (SSRF guard,  |
                                                                   |  retries,     |
                                                                   |  dedup)       |
                                                                   +---------------+
                                                                           |
                                                                           v
                                                                   +---------------+
                                                                   | audit row     |
                                                                   | update sub    |
                                                                   +---------------+
```

### Stages

1. **Transactor applies the Tx** and pushes it onto the workspace tx queue.
   This is the existing stream `pod-telegram-bot` and other services consume;
   no new stream.
2. **The webhook delivery service** (new `services/webhooks-delivery/`)
   consumes the stream per workspace, in order of `modifiedOn`.
3. **Match** - for each Tx, find subscriptions in that workspace whose
   `triggers` include this event type and whose `projectFilter` /
   `statusFilter` include this Tx.
4. **Authorize** - resolve `subscription.owner`'s current permissions on the
   source doc. If the owner lost read access since the Tx fired, drop the
   delivery and audit it. This is the per-delivery owner-access check
   Michael flagged.
5. **Build payload** - render the minimal / minimalPlusDoc / template body.
6. **Enqueue** on a per-subscription delivery queue (one in-flight per
   subscription keeps per-receiver ordering sane; a slow receiver does not
   stall other subscriptions). Idempotency key is `(subscriptionId, txId)`;
   duplicate work is deduplicated at insertion.
7. **Deliver** - SSRF-guarded HTTP POST with the signed body. On HTTP 2xx
   the attempt is final; otherwise exponential backoff with jitter per
   `retryPolicy`. On final failure, audit and leave `lastDeliveryStatus`
   as `error`.
8. **Audit** - every attempt writes a `WebhookDeliveryAttempt` row and
   updates the subscription's `lastDelivery*` fields.

### SSRF protection

Attack surface: an admin specifies a URL that resolves to a private, link-
local, or loopback address and uses the signed POST as a privileged request
INTO the host network. The delivery service MUST refuse those unless the
self-hoster explicitly allowlists them.

- Resolve the URL's host to IP addresses before the request. Reject if any
  resolved address falls in `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `127.0.0.0/8`, `169.254.0.0/16`, `::1/128`, `fc00::/7`, `fe80::/10`,
  `0.0.0.0/8`, broadcast ranges, carrier-grade NAT (`100.64.0.0/10`).
- **DNS pinning**: resolve once, cache the IP, use that same IP for the
  request. Prevents DNS rebinding where the first resolve passes the check
  and the actual request hits a private address.
- **Redirect re-check**: on `3xx`, resolve the `Location` header's host and
  re-run the private-range check before following. Up to `maxRedirects: 3`.
  Cross-protocol redirects (http -> file:, etc) are refused outright.
- **Protocol whitelist**: only `https://` by default. `http://` is accepted
  only when the self-hoster sets `WEBHOOK_ALLOW_HTTP=true` in server
  config (useful on an internal network).
- **Self-hoster allowlist**: `WEBHOOK_ALLOWED_HOSTS=apprise.internal,
  slack-relay.internal` is a comma-separated list of exact hostnames that
  bypass the private-range check. Required for self-hosters running an
  Apprise instance on the same Docker network.
- **Request timeout**: `timeoutMs` default 10s, hard cap 30s in server
  config. Prevents a slow endpoint from pinning a delivery worker.
- **Response body cap**: 8KB read, rest truncated. Prevents a huge response
  from exhausting memory on the delivery worker or the audit row.

### Retries and deduplication

- Exponential backoff with full jitter:
  `delay = min(cap, random(0, initial * (factor ** attempt))) + jitter`.
- `maxRetries` default 5 - gives roughly 2s, 4s, 8s, 16s, 32s between
  attempts under the default policy.
- Retries honor an `X-Retry-After` header from the receiver when present
  (bounded by `cap`).
- Idempotency: `(subscriptionId, txId)` is the dedup key. The queue entry
  is marked completed on the first successful 2xx; a duplicate Tx on the
  stream (e.g. after a service restart that re-processes the last offset)
  is a no-op.

### Rate limits

Per subscription, sliding window of `maxDeliveriesPerMinute` (default 30).
When the window is full, further deliveries queue and the service logs a
`rate-limited` info line but does not drop. A per-workspace cap
`maxWorkspaceDeliveriesPerMinute` (default 300) protects shared resources
from a workspace with many noisy subscriptions.

If the window stays saturated for N windows (default 10 consecutive), the
subscription auto-pauses with `lastDeliveryStatus: 'skipped'` and a notice
in the UI. An admin re-enables manually.

## Authorization

Three layers:

1. **Rule management**: creating, editing, enabling, disabling and deleting
   a `WebhookSubscription` requires `AccountRole.Owner` on the workspace.
   Workspace-scoped feature, workspace-admin controlled. v1 does not expose
   per-user personal subscriptions.
2. **Target existence + archived + restricted** (same shape as #238):
   subscription triggers are filtered on project state at match time. If
   `triggers[i].projectFilter` names a project that is now archived or
   whose current user set does not include the subscription owner, the
   match is dropped and audited.
3. **Per-delivery owner access** (Michael's point): the subscription owner's
   permissions are re-checked against the source doc every delivery and
   every retry. A doc the owner could read when the Tx fired may have moved
   to a restricted project or had its parent space revoked. Any such change
   drops the pending delivery; the audit row records `skipped (owner lost
   read access)`.

The delivery service never bypasses space permissions. It issues `findAll`
queries under the owner's token.

## Secret storage

- The secret is encrypted at rest using the workspace encryption key, same
  mechanism `pod-telegram-bot` already uses (concrete reference in the
  implementation PR).
- POST payload on create carries `{"secret": "<fresh value>", ...}` so the
  client sees it once; the stored doc only exposes `secretLastFour`.
- Rotation: a Rotate button regenerates the secret, invalidates in-flight
  deliveries (they fail HMAC verification on the receiver, which is the
  intended signal), and audits the rotation event.
- Deletion of the subscription deletes the stored secret.

For `apprise` targets the secret is the Apprise URL set; the Apprise server
itself may or may not need a bearer, which is a separate `apiKey` on the
subscription.

## UI

Settings > Integrations > Webhooks tab (mirrors Michael's suggestion in #236).

Visible when the plugin is enabled in Settings > Configure. Hidden
otherwise; an opt-in Owner enables it per workspace. Same shipped-disabled
default as #238.

Per subscription row:

- Name, target type, URL (host only - full URL on hover).
- Enabled toggle (atomic update, like #244's pair toggle).
- Last delivery panel: timestamp, status, response code, truncated body.
- Actions: Edit, Send test event, Delete (with confirm).

Editor:

- Name
- Target type: generic / apprise
- URL
- Secret: shown once on create (one-time reveal), later only `secretLastFour`
  with a Rotate button
- Triggers: a list, each with event type + project picker + status picker
  (status picker only visible for `IssueStatusChange`)
- Payload: minimal / minimalPlusDoc / template; template editor with a
  variable reference drawer; a "render preview" using a recent matching
  issue so the admin sees the actual rendered body before saving.
- Retry policy: collapsed by default, defaults filled in.

Send test event:

- Picks the most recent Issue in a chosen project (or a stub if none).
- Builds the payload with real values from that Issue.
- POSTs the signed body to the configured URL.
- Shows the response (code + first 2KB of body) in a modal.
- Writes an audit row with `event: 'test'`.

## Data model summary

Two docs:

```ts
// Already shown above.
TWebhookSubscription extends TDoc {
  space, name, target, owner, secretId, secretLastFour,
  triggers, payload, retryPolicy, enabled, lastDelivery*
}

// One row per delivery attempt, kept for N days (default 30), rolled off.
TWebhookDeliveryAttempt extends TDoc {
  space: Ref<Workspace>
  subscription: Ref<WebhookSubscription>
  event: WebhookTrigger['event'] | 'test' | 'skipped'
  txId: Ref<Tx>
  deliveryId: string   // uuid, idempotency key
  attempt: number
  at: Timestamp
  httpCode?: number
  outcome: 'ok' | 'error' | 'skipped'
  errorReason?: 'ssrf' | 'ownerLostAccess' | 'rateLimit' | 'timeout' | 'nonTwoxx' | 'templateError' | 'other'
  errorMessage?: string
  redirectChain?: string[]
  truncatedResponse?: string
}
```

The attempt roll-off is a daily job on the server side (same shape as
existing audit roll-offs in the fork). N is configurable.

## Testing

Unit:

- SSRF guard against every private range on both IPv4 and IPv6.
- DNS pinning: resolve returns one IP, the request uses that IP, a second
  resolve during redirect follows the same rules.
- Template substitution: every variable in the table, missing-variable
  behavior, nested-placeholder refusal, JSON escaping on `kind: 'json'` vs
  raw on `kind: 'text/plain'`.
- Apprise target shape: event -> `type` mapping, `urls` passed from secret,
  not from payload.
- Owner access check: a stale subscription with a now-restricted project
  drops delivery.
- Rate limit: 31st delivery in 60s queues; 10 saturated windows pause the
  sub.

Integration:

- Full round-trip against a local HTTP sink: subscribe, trigger a Tx, assert
  signed body, assert audit row, assert `lastDelivery*` updated.
- Test-event action produces the same payload shape as a real delivery.
- Rotation invalidates subsequent deliveries' HMAC against the old secret.

## Scope exclusions and follow-ups

- **Doc and Membership events**: the subscription model carries event-type
  enum values for them already; the delivery service grows a Doc / Membership
  path in a later PR once Issue is proven. Each new event type adds its own
  variable set and audit shape.
- **Per-user personal subscriptions**: a future flag that lets a user
  subscribe their own endpoint to events on docs they own. Different
  authorization story (per-user, not workspace-admin); kept out of v1.
- **Signed URL-based webhook consumers** (webhook secret in the URL rather
  than a header): rejected for v1 because it leaks the secret into logs
  and referrers. The HMAC header pattern stays.
- **GUI template editor with autocomplete**: v1 ships a plain `<textarea>`
  plus a variable reference drawer; a syntax-aware editor is a follow-up.
- **Multi-workspace fan-out**: a single subscription that fires across every
  workspace a user belongs to. Not v1; a workspace-scoped sub per workspace
  is the pattern until a cross-workspace permission model exists.

## Open questions for review

1. **Settings tab location**: Settings > Integrations > Webhooks, or a top-
   level "Integrations" app in the sidebar? #33's inbound work probably
   wants to live next to this; a shared app would make that cleaner but is a
   bigger UI change.
2. **Apprise URL in secret vs plain field**: Apprise URLs can contain
   credentials (e.g. `slack://TOKEN@workspace`). Treating the Apprise URL set
   as a secret is the safe default. Does @jsparrowio see a case for exposing
   it in cleartext for shared workspace integrations?
3. **Template language**: variables-only vs a tiny expression language.
   Current proposal is variables-only (plus event-type-driven defaults for
   Apprise). Receiver-side shaping (Slack Blocks, Discord embeds) covers
   most real cases.
4. **Service naming**: `services/webhooks-delivery/`, or `pod-webhooks/`
   to match the Telegram naming? Open to either.
