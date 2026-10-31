# Outbound webhook subscriptions

## Status: Design (rev 2)

This document is the design proposal for the outbound webhook feature discussed
in Platform-Collective/platform discussion #236 and issue #33. It will be the
companion doc of the eventual implementation PR. No code lives on
`feature/webhooks-design`; this doc is the whole PR.

The feature lets a workspace admin subscribe an outbound HTTP endpoint to Tx
events in the workspace. When a matching Tx is applied, a signed POST (or
PUT) goes to the endpoint. Method, URL, headers and body are all templated,
with named secrets referenced through a dedicated `{{ secrets.<name> }}`
namespace that never renders into logs, previews or audit rows. One target
kind (`generic`) handles every receiver via templates plus optional presets;
Apprise, Slack and Discord ship as built-in presets. The design has one
authorization story (per-subscriber owner-access check) and one SSRF story
(DNS-pinned, no-redirect) applied to every delivery.

Rev 2 (this revision) rebuilds the `target` model around Michael's Proxmox-VE
pattern after his review of rev 1. The seven items from that review are
addressed inline, and the explicit answer to "does `apprise` need its own
target kind?" is **no, it becomes a preset of generic** (section
[Presets](#presets)).

## Why outbound

Teams already run external integrations: Slack notifications, n8n flows,
Apprise relays, custom endpoints. Today they poll Huly's API from an external
worker with a long-lived token to catch "when X happens in Huly, do Y
elsewhere" cases. Every operator who wants cross-system automation runs an
extra process, mints a long-lived token, and keeps a status map in sync with
the project's actual status set. Hoisting the outbound into the platform
removes the external component, keeps the subscription set in the same
backup as the workspace, and lets a non-engineer admin maintain it from
Settings > Integrations.

## Scope

In scope for v1:

- Issue events only: `IssueCreated`, `IssueUpdated`, `IssueStatusChange`.
- Workspace-admin-managed subscriptions, per-workspace.
- Project and status filters per subscription.
- One target kind `generic` (templated method/URL/headers/body) with built-in
  presets for `apprise`, `slack`, `discord`, and `generic` (bare).
- Named, write-only secrets with URL/header/body references.
- SSRF protection with DNS pinning on the final rendered URL and redirects
  disabled.
- HMAC over rendered body bytes plus timestamp + delivery id (replay-safe).
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
  workspace. Server trigger, no external HTTP. In review.

Shared conventions proposed here (open to a counter-proposal from
@thomas-bouvier):

| Concern | Proposal |
|---|---|
| Service layout | Each direction a separate `pod-*` or `services/*` dir, consuming workspace Tx queue (outbound) or exposing HTTP (inbound). No cross-service dependencies. |
| Secret storage | Reuse the mechanism `pod-telegram-bot` already uses (encrypted-at-rest with the workspace key); write-only API, one-time reveal on create, rotate regenerates. |
| UI home | Settings > Integrations tab, two subsections: "Outgoing" and "Incoming". Mirror look-and-feel. |
| Rate limits | Sliding window at (subscriptionId, workspace) for outbound; (tokenId, channel) for inbound. Shared config keys in server. |
| Audit history | Each service writes its own `*DeliveryAttempt` collection with the same shape: `{at, status, httpCode, truncatedResponse}`. One UI component reads both. |
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

  // One kind, templated. See "Target".
  target: WebhookTarget

  // Who owns the subscription. The delivery service re-reads the source doc
  // under THIS account's permissions on every delivery and retry; a
  // delivery is dropped if the owner lost read access since the Tx fired.
  // Required at creation; cannot change afterwards.
  owner: Ref<Account>

  // Named secrets. Write-only once created; the stored doc exposes only
  // `secretsMeta` (name + lastFour + lastRotatedAt). Referenced in the
  // target templates as `{{ secrets.<name> }}`; redacted in previews,
  // test events, audit rows and redirect records.
  secretsMeta: WebhookSecretMeta[]

  // What fires this subscription.
  triggers: WebhookTrigger[]

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

interface WebhookTarget {
  // Optional preset. When set, the subscription inherits the preset's
  // method / headers / body templates. The user can still override any of
  // them. When unset, the user is editing a bare generic target.
  preset?: 'apprise' | 'slack' | 'discord' | 'generic'

  // Templates. Each is a string with `{{...}}` placeholders. See
  // "Template language" below.
  method: 'POST' | 'PUT'       // default POST
  urlTemplate: string          // required; see URL rules
  headerTemplates: Array<{ name: string, valueTemplate: string }>
  bodyTemplate?: string        // required unless `useMinimalBody === true`
  useMinimalBody?: boolean     // if true, body is the minimal JSON shape
                               // and bodyTemplate is ignored
  contentType?: string         // default 'application/json'

  // Host-change invariant. The stored `urlTemplate` resolves to a host at
  // delivery time; changing the host (vs the host of the last known good
  // delivery) requires the editor to re-enter every named secret used in
  // the subscription. See "Secret rebind on host change".
  lastDeliveredHost?: string
}

interface WebhookSecretMeta {
  name: string          // must match /^[a-z][a-z0-9_]{0,30}$/
  lastFour: string
  lastRotatedAt: Timestamp
}

interface WebhookTrigger {
  event: 'IssueCreated' | 'IssueUpdated' | 'IssueStatusChange'
  // Narrows to one project. Omitted = any project in the workspace.
  projectFilter?: Ref<Project>
  // For IssueStatusChange: narrows to specific statuses on the source side.
  // Status refs are per-TaskType so a filter is scoped to one project unless
  // intentionally cross-project (which the UI discourages).
  statusFilter?: Ref<IssueStatus>[]
}

interface WebhookRetryPolicy {
  maxRetries: number           // default 5
  initialBackoffMs: number     // default 2000
  backoffFactor: number        // default 2 (exponential)
  jitterMs: number             // default 500
  timeoutMs: number            // default 10000
}
```

## Target

### Default: no template needed

A subscription that leaves `bodyTemplate` unset and `useMinimalBody: true`
gets the minimal JSON body described below with no template to write. This is
the simple case Michael asked to keep as default - a Slack-shaped `text`
field is easy to add, but every receiver that just wants "something arrived"
needs zero template work.

### Minimal body (default)

```json
{
  "event": "IssueStatusChange",
  "txId": "<Ref<Tx>>",
  "deliveryId": "<uuid>",
  "timestamp": 1793235782113,
  "timestampIso": "2026-10-31T06:00:00.000Z",
  "workspace": { "id": "<uuid>", "name": "Pixelique" },
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
    "id": "<Ref<IssueStatus>>", "name": "Design", "category": "Active"
  },
  "newStatus": {
    "id": "<Ref<IssueStatus>>", "name": "Review", "category": "Active"
  }
}
```

No PII beyond identifiers. The issue title ships because without it the
receiver cannot write a useful notification. If a workspace needs stricter
privacy, a future `includeTitle: false` flag can mask that field.

### Where `previousStatus` comes from

`TxUpdateDoc<Issue>` only carries the new status, not the prior value - the
delivery service has to resolve the prior value explicitly before building the
payload. Three places to read it from, tried in order:

1. The Tx stream carries the pre-image for `TxUpdateDoc` as of the fork's
   current `pod-telegram-bot` consumer (confirmed by inspection of the
   consumer at implementation time; if that assumption is wrong, (2)
   applies).
2. If not, the service does `findAll(Tx, {objectId, _class: TxUpdateDoc})`
   restricted to the issue's own history, finds the most recent Tx with a
   status update prior to this one, and reads its `operations.status`.
3. If no prior status is reachable (the issue was created with the new
   status, or history was pruned), `previousStatus` is `null`.

The resolution runs under the subscription owner's permissions along with
the rest of the per-delivery owner-access check. If the owner lost access to
the issue between the Tx and the delivery, the whole delivery is dropped;
the prior-status lookup is never a side channel.

### Templates and variables

A template is a UTF-8 string with `{{ ... }}` placeholders. The variable
set is fixed and documented:

| Variable | Value |
|---|---|
| `{{ event }}` | `IssueCreated` / `IssueUpdated` / `IssueStatusChange` |
| `{{ txId }}` | the triggering Tx id |
| `{{ deliveryId }}` | this delivery's uuid |
| `{{ timestamp }}` | milliseconds since epoch |
| `{{ timestampIso }}` | ISO-8601 string |
| `{{ workspace.id }}`, `{{ workspace.name }}` | workspace facts |
| `{{ project.id }}`, `{{ project.identifier }}`, `{{ project.name }}` | project facts |
| `{{ issue.id }}`, `{{ issue.identifier }}`, `{{ issue.title }}`, `{{ issue.url }}` | issue facts |
| `{{ actor.accountUuid }}`, `{{ actor.displayName }}` | the Tx author |
| `{{ previousStatus.id }}`, `{{ previousStatus.name }}`, `{{ previousStatus.category }}` | prior status (`IssueStatusChange` only; see above) |
| `{{ newStatus.id }}`, `{{ newStatus.name }}`, `{{ newStatus.category }}` | new status |
| `{{ secrets.<name> }}` | a named secret, see "Secrets" |

Rules (all non-negotiable in v1):

- Placeholders are literal. A missing variable renders as the empty string
  and writes a `templateMiss` warning line on the audit row.
- **No conditionals, loops, expressions, or nested placeholders.** The
  evaluator is a single pass of regex substitution over the known names;
  anything a `{{ ... }}` points at that is not in the table above fails
  closed (empty + warn, template is otherwise valid). This forecloses the
  Seerr-style tiny-language escalation that Michael called out as a per-
  feature cost (XSS, surprising escaping, injection via nested
  placeholders).
- **Escaping is context-aware** and chosen at template-authoring time by
  which field the template fills in:
  - In `urlTemplate`: values are **URL-component encoded**
    (`encodeURIComponent` semantics) so `{{ issue.title }}` with "Green Friday"
    renders as `Green%20Friday`. Secrets inside the URL (e.g. a Slack
    incoming webhook path) go through the same encoding.
  - In header values: values are inserted raw; CR / LF / NUL in the final
    rendered value is a hard reject that fails the delivery with
    `errorReason: 'headerInjection'`.
  - In `bodyTemplate` with `contentType: 'application/json'` (the default):
    values are **JSON-escaped**. Secrets too.
  - In `bodyTemplate` with any other `contentType`: values are **raw**. The
    author is responsible for escaping; the audit row shows the final
    rendered body (secrets redacted) so the author can inspect it in a
    test event.
- **Event data never lands in the URL host.** The URL template is parsed
  before rendering: the host is extracted from the template literally; a
  template with any placeholder before the first `/` after the scheme is
  refused at save time. Placeholders are only allowed in path, query, and
  fragment. The SSRF check in "SSRF protection" runs on the **final
  rendered URL**, i.e. after templating, not on the pre-template string.

### Secrets

Secrets are a separate concept from the subscription body.

- A subscription has zero or more named secrets. Names are a-z, 0-9 and
  underscore, max 32 chars; the user names them when creating the
  subscription.
- The create API accepts secrets as `{secrets: [{name, value}, ...]}`.
  The response includes `secretsMeta` with the last four characters of
  each value for display purposes; the plain value is never returned
  again.
- A rotate action regenerates one secret by name. The old value is
  overwritten; in-flight deliveries still signed by the old HMAC fail
  verification on the receiver, which is the intended "rotation
  revokes" signal. The audit row writes a `rotated` event.
- Secrets are referenced in templates as `{{ secrets.<name> }}`. Example:
  `url: https://slack.com/webhooks/{{ secrets.slack_path }}`.
- **Redaction is universal.** Every audit row, every rendered-template
  preview, every test-event response, every redirect-chain record masks
  secrets as `[REDACTED]`. The service builds a `redactionMap` from the
  resolved secret values before writing any audit, response-body-truncate,
  or UI preview text. Values are matched as substrings over the rendered
  bytes.
- The service never logs the secret value. Error paths that include the
  rendered URL, body or headers run through the redactor before reaching
  log output.
- Storage: encrypted at rest using the workspace encryption key (same
  mechanism `pod-telegram-bot` uses).

### Secret rebind on host change

If a template's rendered URL points at a different host than the previous
successful delivery's `lastDeliveredHost`, every secret referenced by name
in the subscription MUST be re-entered before saving. This stops an admin
who cannot read the stored secrets from redirecting them to another server
by swapping the URL template.

In the UI this is a modal: "The target host changed from `hooks.slack.com`
to `evil.example`. Please re-enter the secrets this subscription uses:
`slack_path`." Save is blocked until every referenced secret has a fresh
value entered by the user in this session. The delivery service refuses to
dispatch a subscription whose rendered host disagrees with
`lastDeliveredHost` AND whose secrets have `lastRotatedAt` older than the
save that changed the URL.

A brand-new subscription (`lastDeliveredHost` is unset) does not trigger
this; the first-save is the baseline.

### Allowed-overrides and reserved headers

- `method`: `POST` and `PUT` only. v1 does not expose `PATCH` / `DELETE`.
- Reserved header names (case-insensitive) that user templates cannot set:
  `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, and any
  header starting with `X-Huly-`. Trying to set one is a save-time error.
- The service always appends:
  - `Content-Type: <contentType>` (default `application/json`).
  - `X-Huly-Signature: v=2;t=<timestamp>;id=<deliveryId>;s=<hex>` where
    `hex = HMAC_SHA256(secret, "v=2;t=<timestamp>;id=<deliveryId>." + bodyBytes)`.
    Receivers can refuse a signature whose `t` is more than N seconds old
    (replay protection); the signed string explicitly covers the timestamp
    and the delivery id so an attacker cannot replay the body alone.
  - `X-Huly-Event: <event>` for log-side filtering.
  - `X-Huly-Delivery: <uuid>` idempotency key for the receiver.
  - `User-Agent: huly-webhooks/<version>`.
- The HMAC key is a workspace-managed value named `<pluginId>_hmac` under
  the hood - distinct from any user-named secret, rotatable from the UI.

## Presets

A preset is a shipped set of defaults for `method`, `urlTemplate`,
`headerTemplates`, `bodyTemplate` and `contentType`. The user picks a preset
in the editor; the defaults populate; they're free to override any field.
The subscription stores both the preset name and the (possibly overridden)
templates, so a preset upgrade in a later release does not silently change
a live subscription.

### `apprise`

```yaml
method: POST
urlTemplate: "{{ secrets.apprise_base }}/notify"
headerTemplates:
  - name: Authorization
    valueTemplate: "Bearer {{ secrets.apprise_bearer }}"   # optional, dropped if secret absent
contentType: application/json
bodyTemplate: |
  {
    "urls": "{{ secrets.apprise_urls }}",
    "title": "{{ issue.identifier }} {{ newStatus.name }}",
    "body": "{{ issue.title }} by {{ actor.displayName }}",
    "type": "info",
    "format": "markdown"
  }
```

The preset ships with `secrets.apprise_urls` (Apprise destination URL set),
`secrets.apprise_base` (the Apprise API base), and an optional
`secrets.apprise_bearer`. For an open Apprise API on an internal network the
bearer is omitted and the `Authorization` header renders empty (and is
dropped per the "empty header is dropped" rule).

The event-driven `type` mapping (Won->success, Lost->failure) is NOT in the
preset; it is a template the user can switch to:

```jinja
"type": "{{ newStatus.category === 'task:statusCategory:Won' ? 'success' : 'info' }}"
```

...except we don't ship an expression evaluator. For v1 a user who wants
that mapping writes four subscriptions, each narrowed by `statusFilter`.
Added as a follow-up if real users ask for it.

### `slack`

```yaml
method: POST
urlTemplate: "https://hooks.slack.com/services/{{ secrets.slack_path }}"
contentType: application/json
bodyTemplate: |
  {
    "text": "*{{ issue.identifier }}* {{ issue.title }} moved to *{{ newStatus.name }}* by {{ actor.displayName }}",
    "attachments": [{"text": "<{{ issue.url }}|Open in Huly>"}]
  }
```

### `discord`

```yaml
method: POST
urlTemplate: "https://discord.com/api/webhooks/{{ secrets.discord_path }}"
contentType: application/json
bodyTemplate: |
  {"content": "`{{ issue.identifier }}` {{ issue.title }} is now **{{ newStatus.name }}** ({{ actor.displayName }}) {{ issue.url }}"}
```

### `generic` (bare)

No defaults; user writes method / URL / headers / body themselves. Default
when the user picks "custom".

**Answer to Michael's architectural question**: with named secrets +
templated URL / headers / body, Apprise collapses to a preset. One target
kind, four presets, one authorization story, one SSRF story, one audit
shape. That is the design.

## SSRF protection

Attack surface: an admin specifies a URL that resolves to a private, link-
local, or loopback address and uses the signed POST as a privileged request
INTO the host network. The delivery service MUST refuse those unless the
self-hoster explicitly allowlists them. All checks run on the **final
rendered URL** (post-templating), never on the raw template.

- Resolve the URL's host to IP addresses before the request. Reject if any
  resolved address falls in `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `127.0.0.0/8`, `169.254.0.0/16`, `::1/128`, `fc00::/7`, `fe80::/10`,
  `0.0.0.0/8`, broadcast ranges, carrier-grade NAT (`100.64.0.0/10`).
- **DNS pinning**: resolve once, cache the IP, use that same IP for the
  request. Prevents DNS rebinding where the first resolve passes the check
  and the actual request hits a private address.
- **Redirects disabled**. Michael's suggestion. A 3xx is treated as a
  delivery failure (`errorReason: 'redirect'`) and retried per policy if
  the receiver persists; the admin fixes the receiver side. Removes an
  entire class of SSRF escapes (redirect to private IP, cross-protocol
  redirect) and the audit row's redirect-chain field disappears.
- **Protocol whitelist**: only `https://` by default. `http://` is accepted
  only when the self-hoster sets `WEBHOOK_ALLOW_HTTP=true` in server
  config (useful on an internal network).
- **Self-hoster allowlist**: `WEBHOOK_ALLOWED_HOSTS=apprise.internal,
  slack-relay.internal` is a comma-separated list of exact hostnames that
  bypass the private-range check. Required for self-hosters running an
  Apprise instance on the same Docker network.
- **URL host comes from the template literal**: a template with a
  placeholder in the host portion of the URL is refused at save time
  (section "Templates and variables"), so event data cannot steer the
  rendered URL to a different host.
- **Request timeout**: `timeoutMs` default 10s, hard cap 30s in server
  config.
- **Response body cap**: 8KB read, rest truncated. Prevents a huge
  response from exhausting memory on the delivery worker or the audit row.

## Delivery pipeline

```
+---------+     +--------------------+     +---------------------+     +------------+
|  Tx     | --> | tx queue (per ws)  | --> | match subscription  | --> |  delivery  |
| applied |     | (existing stream)  |     | resolve owner       |     |  queue     |
+---------+     +--------------------+     | check access        |     +------------+
                                           | render templates    |            |
                                           | compute HMAC        |            v
                                           +---------------------+     +---------------+
                                                                       | HTTPS POST/PUT|
                                                                       | (DNS-pinned,  |
                                                                       |  no redirect, |
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
   Existing stream.
2. **The webhook delivery service** (new `services/webhooks-delivery/` -
   final naming TBD, see open questions) consumes the stream per workspace,
   in order of `modifiedOn`.
3. **Match** - find subscriptions in that workspace whose `triggers`
   include this event type and whose filters include this Tx.
4. **Authorize** - resolve `subscription.owner`'s current permissions on
   the source doc. If the owner lost read access since the Tx fired, drop
   the delivery and audit it (`errorReason: 'ownerLostAccess'`).
5. **Resolve prior values** - for `IssueStatusChange`, fetch
   `previousStatus` under the owner's permissions.
6. **Render** - substitute variables and secrets into the method, URL,
   headers and body templates. Validate: URL host is literal, no reserved
   headers overridden, no CR/LF in header values, host matches
   `lastDeliveredHost` (or secret rebind was done).
7. **Compute HMAC** over the signed string
   `"v=2;t=<timestamp>;id=<deliveryId>." + bodyBytes` using the per-
   subscription HMAC key.
8. **Enqueue** on a per-subscription delivery queue (one in-flight per
   subscription keeps per-receiver ordering sane). Idempotency key is
   `(subscriptionId, txId)`.
9. **Deliver** - DNS-pinned HTTPS with redirects disabled. On HTTP 2xx the
   attempt is final; otherwise exponential backoff with jitter per
   `retryPolicy`. On final failure, audit.
10. **Audit** - every attempt writes a `WebhookDeliveryAttempt` row (with
    secrets redacted from the rendered URL and body preview) and updates
    the subscription's `lastDelivery*` fields.

### Retries and deduplication

- Exponential backoff with full jitter:
  `delay = min(cap, random(0, initial * (factor ** attempt))) + jitter`.
- `maxRetries` default 5 - roughly 2s, 4s, 8s, 16s, 32s between attempts
  under the default policy.
- Retries honor an `X-Retry-After` header from the receiver when present
  (bounded by `cap`).
- Idempotency: `(subscriptionId, txId)` is the dedup key. The queue entry
  is marked completed on the first successful 2xx; a duplicate Tx on the
  stream (service restart, re-processed offset) is a no-op.

### Rate limits

Per subscription, sliding window of `maxDeliveriesPerMinute` (default 30).
When the window is full, further deliveries queue and the service logs a
`rate-limited` info line. A per-workspace cap
`maxWorkspaceDeliveriesPerMinute` (default 300) protects shared resources
from a workspace with many noisy subscriptions.

If the window stays saturated for N windows (default 10 consecutive), the
subscription auto-pauses with `lastDeliveryStatus: 'skipped'` and a notice
in the UI. An admin re-enables manually.

## Authorization

Three layers:

1. **Rule management**: creating, editing, enabling, disabling and deleting
   a `WebhookSubscription` requires `AccountRole.Owner` on the workspace.
   Workspace-scoped feature, workspace-admin controlled.
2. **Target existence + archived + restricted** (same shape as #238):
   subscription triggers are filtered on project state at match time. If
   `triggers[i].projectFilter` names a project that is now archived or
   whose current user set does not include the subscription owner, the
   match is dropped and audited.
3. **Per-delivery owner access**: the subscription owner's permissions are
   re-checked against the source doc every delivery and every retry. A
   doc the owner could read when the Tx fired may have moved to a
   restricted project or had its parent space revoked. Any such change
   drops the pending delivery; the audit row records
   `errorReason: 'ownerLostAccess'`.

The delivery service never bypasses space permissions. It issues `findAll`
queries under the owner's token.

## UI

Settings > Integrations > Webhooks tab.

Visible when the plugin is enabled in Settings > Configure. Hidden
otherwise; an opt-in Owner enables it per workspace. Same shipped-disabled
default as #238.

Per subscription row:

- Name, preset badge, URL host (not the whole URL - secrets masked).
- Enabled toggle (atomic update, like #244's pair toggle).
- Last delivery panel: timestamp, status, response code, redacted body
  preview.
- Actions: Edit, Send test event, Delete (with confirm).

Editor:

- Name
- Preset: apprise / slack / discord / generic (populates the templates)
- Method, URL template (host literal, placeholders in path/query/fragment
  only)
- Header list (name + value template per row; reserved names blocked)
- Content type + body template (OR "Use minimal body" checkbox)
- Named secrets panel: add / rotate / remove. Values entered here, never
  shown back; `lastFour` display.
- Triggers: a list, each with event type + project picker + status picker
  (status picker only visible for `IssueStatusChange`)
- Retry policy (collapsed by default)
- **Render preview**: picks a recent matching issue (or a stub when none
  exists), renders the full URL / headers / body with secrets REDACTED,
  shows what will be POSTed. The preview goes through the exact same
  rendering + redaction code the delivery path uses, so what you see is
  what the audit row will show.

Save flow:

- Save-time validations run: method whitelist, no reserved headers, no
  placeholders in URL host, template parses, every referenced secret name
  exists on the subscription.
- If the rendered URL's host disagrees with the stored `lastDeliveredHost`,
  the modal described in [Secret rebind on host change](#secret-rebind-on-host-change)
  blocks save until every secret is re-entered.

Send test event:

- Picks the most recent matching Issue in the first project trigger (or
  a stub if none).
- Builds the payload with real values from that Issue.
- POSTs with the live signed body.
- Shows the redacted request preview AND the response (code + first 2KB
  of body) in a modal.
- Writes an audit row with `event: 'test'`.

## Data model summary

Two docs:

```ts
// Already shown above.
TWebhookSubscription extends TDoc {
  space, name, target, owner, secretsMeta,
  triggers, retryPolicy, enabled, lastDelivery*
}

// One row per delivery attempt, kept for N days (default 30), rolled off.
TWebhookDeliveryAttempt extends TDoc {
  space: Ref<Workspace>
  subscription: Ref<WebhookSubscription>
  event: WebhookTrigger['event'] | 'test' | 'skipped' | 'rotated'
  txId: Ref<Tx>
  deliveryId: string                 // uuid, idempotency key
  attempt: number
  at: Timestamp
  method: 'POST' | 'PUT'
  renderedHost: string               // for audit; full URL is redacted below
  renderedUrlRedacted: string        // secrets masked
  renderedHeadersRedacted: Array<{ name: string, value: string }>
  renderedBodyRedacted: string       // truncated at 2KB
  httpCode?: number
  outcome: 'ok' | 'error' | 'skipped'
  errorReason?: 'ssrf' | 'ownerLostAccess' | 'rateLimit' | 'timeout'
    | 'nonTwoxx' | 'templateError' | 'headerInjection' | 'redirect'
    | 'hostChangedWithoutRebind' | 'other'
  errorMessage?: string
  truncatedResponse?: string         // first 8KB
  templateWarnings?: string[]        // e.g. ['missingVariable:actor.email']
}

// Secrets live in a separate collection so a plain subscription read
// never ships their ciphertext.
TWebhookSecret extends TDoc {
  space: Ref<Workspace>
  subscription: Ref<WebhookSubscription>
  name: string
  ciphertext: Buffer                 // encrypted at rest
  lastFour: string
  lastRotatedAt: Timestamp
}
```

The attempt roll-off is a daily job on the server side (same shape as
existing audit roll-offs in the fork). N is configurable.

## Testing

Unit:

- Template substitution: every variable in the table; missing-variable
  behavior; secret-reference resolution; refusal of nested placeholders.
- URL template parse: refuses a placeholder before the first `/` after
  scheme; accepts placeholders in path/query/fragment.
- Header injection: CR / LF / NUL in a rendered header value is rejected.
- Reserved header: `X-Huly-Foo`, `Host`, `Content-Length` refused at save.
- SSRF guard against every private range on both IPv4 and IPv6.
- DNS pinning: resolve returns one IP, the request uses that IP.
- Redirect: 302 is treated as a delivery error (`errorReason: 'redirect'`),
  no follow-up request is made.
- HMAC covers the exact rendered body bytes AND the timestamp + delivery
  id; replaying the body with a tampered timestamp fails verification.
- Secret rebind: changing the URL's host without re-entering every
  referenced secret is a save-time rejection; after a rebind, the host
  change goes through.
- Redaction: a secret value present in a rendered URL / header / body does
  NOT appear in the audit row, in the test-event response, or in the
  template-preview output.
- Owner access: a stale subscription with a now-restricted project drops
  delivery.
- Rate limit: 31st delivery in 60s queues; 10 saturated windows pause the
  sub.

Integration:

- Full round-trip against a local HTTP sink: subscribe, trigger a Tx,
  assert signed body, assert audit row with redaction, assert
  `lastDelivery*` updated.
- Test-event action produces the same shape as a real delivery.
- Rotation invalidates subsequent deliveries' HMAC against the old
  secret.

## Scope exclusions and follow-ups

- **Doc and Membership events**: subscription model carries them already;
  the delivery service grows a Doc / Membership path in a later PR once
  Issue is proven.
- **Per-user personal subscriptions**: a future flag that lets a user
  subscribe their own endpoint to events on docs they own. Different
  authorization story; kept out of v1.
- **Signed URL-based webhook consumers** (secret in URL path): the Slack
  preset uses this pattern, but the secret is a named secret stored
  server-side, not in the plain URL field - rejected for v1.
- **Tiny expression language for template conditionals** (`type` by
  category, etc): kept out of v1. If a real user asks for it, we add a
  deliberately small expression grammar covering only ternary over named
  variables, no function calls, no nesting.
- **GUI template editor with autocomplete**: v1 ships a `<textarea>` plus
  the variable reference drawer; syntax-aware editor is a follow-up.
- **Multi-workspace fan-out**: a single subscription that fires across
  every workspace a user belongs to. Not v1; a workspace-scoped sub per
  workspace is the pattern until a cross-workspace permission model
  exists.

## Open questions for review

1. **Service naming**: `services/webhooks-delivery/`, or `pod-webhooks/`
   to match the Telegram naming?
2. **Settings tab location**: Settings > Integrations > Webhooks, or a
   top-level "Integrations" app in the sidebar? #33's inbound work
   probably wants to live next to this.
3. **Expression language in templates (deferred)**: v1 has no `?:`, no
   function calls. Does @MichaelUray want to pin that or does the "write
   N narrower subscriptions" workaround cover the Won->success /
   Lost->failure case well enough for now?
