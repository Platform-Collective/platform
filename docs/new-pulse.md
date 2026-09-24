# New Pulse — Transient Docs Plan

Replace `foundations/hulypulse` (Rust WS service) and `packages/hulypulse-client` with transient docs inside the existing transactor. Use existing `DOMAIN_TRANSIENT` + `TransientTTL` mixin + `createQuery` live queries. No new server code, no new WS connection.

## Motivation

- Dedicated pulse WS doubles connections per client.
- Transactor already has `DOMAIN_TRANSIENT` (`InMemory` adapter) wired via `server-pipeline/src/pipeline.ts`.
- `TransientMiddleware` already runs a 1s ticker, cleans expired docs, broadcasts `TxRemoveDoc`, and refreshes TTL on any CUD (heartbeat via update = free).
- `createQuery` + `client.createDoc/updateDoc/removeDoc` already give live sets + writes.
- `SpaceSecurityMiddleware` already filters by `doc.space` — private doc visibility handled automatically if we set space = target doc's space.

## Real Usages Found

Only two patterns in the whole codebase:

1. **Document presence** — who is currently viewing a document.
   - `plugins/presence-resources/src/presence.ts`: `subscribePresence`, `updatePresence`, `deletePresence`.
   - `PresenceContext.svelte` writes every `presenceUpdateSeconds=2`, TTL `presenceTtlSeconds=5`.
   - `PresenceAvatars.svelte` reads.
2. **Typing indicator** — who is typing in a chat/card.
   - `plugins/presence-resources/src/typing.ts`: `subscribeTyping`, `setTyping`, `clearTyping`.
   - `MessageInput.svelte` / `ChatMessageInput.svelte` write with 2s TTL.
   - `objectId` is a composite string (e.g. `peer:${card.peerId}`), not necessarily a real `Ref<Doc>`.

Everything else in hulypulse protocol is unused.

## Design

### New package: `plugins/pulse` (interfaces only)

```ts
// src/index.ts
export interface DocumentPresence extends Doc {
  objectId: Ref<Doc>
  objectClass: Ref<Class<Doc>>
  person: Ref<Person>
  lastActive: Timestamp
}

export interface TypingIndicator extends Doc {
  objectId: string          // composite key allowed (peer:xxx)
  socialId: PersonId
  status?: IntlString
}
```

`src/plugin.ts`:
```ts
export const pulseId = 'pulse' as Plugin
export default plugin(pulseId, {
  class: {
    DocumentPresence: '' as Ref<Class<DocumentPresence>>,
    TypingIndicator: '' as Ref<Class<TypingIndicator>>
  }
})
```

### New package: `models/pulse`

```ts
@Model(pulse.class.DocumentPresence, core.class.Doc, DOMAIN_TRANSIENT)
export class TDocumentPresence extends TDoc implements DocumentPresence { ... }

@Mixin(core.mixin.TransientTTL, pulse.class.DocumentPresence)
export class TDocumentPresenceTTL extends TDocumentPresence { ttl = 10 }

@Model(pulse.class.TypingIndicator, core.class.Doc, DOMAIN_TRANSIENT)
export class TTypingIndicator extends TDoc implements TypingIndicator { ... }

@Mixin(core.mixin.TransientTTL, pulse.class.TypingIndicator)
export class TTypingIndicatorTTL extends TTypingIndicator { ttl = 3 }
```

Class-level TTL only. No per-doc TTL (simpler, middleware already supports the use case).

Register in `rush.json` and `models/all/src/index.ts`.

### Space = target doc's space

- `PresenceContext.svelte` has `export let object: Doc` → pass `object.space` to writer.
- `MessageInput.svelte` has `export let card: Card` → pass `card.space` to writer.

`SpaceSecurityMiddleware` then filters visibility for private docs automatically. No custom permission logic needed.

### Rewrite client helpers

- `presence.ts` / `typing.ts`: drop `HulypulseClient`, use `createQuery` + `client.createDoc/updateDoc/removeDoc`. Heartbeat = `updateDoc` (refreshes TTL in middleware).
- Key is now `_id` = deterministic hash of `(objectId, personId)` so repeated writes map to same doc.

## Removal Scope (same PR)

- `foundations/hulypulse/` (Rust service)
- `packages/hulypulse-client/`
- `packages/presentation/src/pulse.ts` + `PulseUrl` metadata
- Dependency drops: `presentation`, `presence-resources`, `love-resources`
- `rush.json` entries
- `docker-compose` pulse service
- `PULSE_URL` env in server/front configs
- `config-dev.json` entry
- CI `.github/workflows/main.yml` pulse job
- `pods/external` hulypulse.service

## Tasks

1. Create `plugins/pulse` interface package.
2. Create `models/pulse` + register.
3. Rewrite `presence-resources/src/presence.ts`.
4. Rewrite `presence-resources/src/typing.ts`.
5. Update callsites: `PresenceContext.svelte`, `PresenceAvatars.svelte`, `WorkbenchExtension.svelte`, `MessageInput.svelte`, `ChatMessageInput.svelte`.
6. Remove entire hulypulse stack.
7. Run `diagnostics`, verify build.
8. Memory note in `docs/memory/pulse.md`.

Single PR. `rushx format` is user's responsibility.

---

## Future Ideas (not in this PR)

### User activity / presence status (away/active/busy)

Natural extension of the same transient doc pattern. Goal: aggregate user activity signals so UI can show **active / away / in-meeting / busy** next to avatars globally, not per-document.

**Signals already available (no extra plumbing):**
- `DocumentPresence` writes → user is viewing some doc.
- `TypingIndicator` writes → user is typing somewhere.
- `love` room participation (`ParticipantInfo`) → user is in a meeting/office room.
- LiveKit session state via love middleware.

**Proposed transient class:**
```ts
export interface UserActivity extends Doc {
  person: Ref<Person>
  status: 'active' | 'away' | 'busy' | 'in-meeting'
  lastInputAt: Timestamp      // last keypress/click/presence write
  currentRoom?: Ref<Room>     // if in love room
  currentDoc?: Ref<Doc>       // if viewing doc
}
```
- TTL ~30s, class-level.
- `space: core.space.Workspace` (everyone sees everyone — same as existing `UserStatus`).
- Key: `_id` = hash(personId) → single doc per user.

**Client writer (single place, e.g. `workbench-resources`):**
- Heartbeat every ~15s while tab focused + on user input events (throttled).
- Derive `status`:
  - `in-meeting` if love reports active room participation.
  - `busy` if user manually set (future UI).
  - `away` if no heartbeat for >60s OR tab hidden for >5min.
  - `active` otherwise.
- Drop heartbeat when tab hidden → middleware TTL cleanup flips to `away` automatically after timeout.

**Why transient + TTL fits perfectly:**
- No heartbeat for N seconds → middleware auto-removes → subscribers see `TxRemoveDoc` → UI shows offline/away. No manual cleanup.
- Any input → single `updateDoc` refreshes TTL → no ticker needed on client.

**Integration with existing `UserStatus`:**
- `UserStatus` (persistent) keeps online/offline for notifications/account-level logic.
- `UserActivity` (transient) is the richer, short-lived view (away/busy/in-meeting/current doc).
- Could eventually replace `UserStatus` entirely if persistence is not needed.

**Potential improvements to explore:**
- **Idle detection** via `document.visibilityState` + mouse/keyboard listeners in workbench (debounced to 1 write / 10s).
- **Per-device presence**: multiple tabs/devices → multiple `UserActivity` docs keyed by `(person, sessionId)`. Aggregate on read side (`createQuery` groups by person).
- **Do Not Disturb**: explicit status mutation from UI, overrides auto status until expiry.
- **"Last seen" fallback**: when `UserActivity` expires, persist `lastSeenAt` to `UserStatus` so offline users still show a timestamp.
- **Cross-workspace presence** (if needed for org-wide): separate account-level pulse, out of scope for transactor-scoped transient docs.
- **Typing → activity**: typing writes could auto-refresh `UserActivity` instead of a separate heartbeat.
- **Meeting status broadcast**: love middleware could directly write/update `UserActivity` with `in-meeting` and `currentRoom` as source of truth, removing duplicate logic on client.

All of the above are additive: the pulse-replacement PR does not block them and the transient-doc substrate is already in place.
