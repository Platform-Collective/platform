# Pulse — Transient Docs Architecture

## Decision

Replaced `foundations/hulypulse` (Rust WebSocket service) and `packages/hulypulse-client` with two transient classes inside the existing transactor:

- `DocumentPresence` — who views which doc
- `TypingIndicator` — who types in which chat/card

Both live in `DOMAIN_TRANSIENT` (InMemory adapter, already wired in `server/server-pipeline/src/pipeline.ts`) with class-level `TransientTTL` mixin (`TransientMiddleware` auto-expires).

## Why transient docs > dedicated pulse protocol

- No second WebSocket — reuses transactor session.
- `createQuery` already gives live set subscriptions.
- `client.createDoc`/`updateDoc`/`removeDoc` — standard Tx pipeline, no custom middleware.
- `TransientMiddleware.tx()` refreshes TTL on **any** CUD — update = heartbeat, free.
- `SpaceSecurityMiddleware` filters visibility by `doc.space` — private-doc visibility handled automatically when writer sets `space = target doc's space`.
- TTL ticker cleans expired docs and broadcasts `TxRemoveDoc` — subscribers see removals without extra code.

## Key design points

- **Deterministic `_id`**: `presence:${objectId}:${personId}` / `typing:${objectId}:${socialId}` so repeated writes update a single doc instead of creating duplicates.
- **Space = target doc's space** (not `core.space.Workspace`). `PresenceContext.svelte` passes `object.space`; `MessageInput.svelte` / `ChatMessageInput.svelte` pass `card.space` / `object.space`. Prevents leaking presence/typing info to users who cannot see the private target doc.
- **TTL class-level only**: `DocumentPresence` = 10s, `TypingIndicator` = 3s. No per-doc TTL — scope didn't need it.
- **`TypingIndicator.objectId` is a plain string**, not `Ref<Doc>`. It accepts composite keys like `peer:${peerId}` used by direct-message input.
- **`TransientTTL` mixin is class-level**: applied via `builder.mixin(classRef, core.class.Class, core.mixin.TransientTTL, { ttl })` in the model package, mirroring `@Mixin(core.mixin.TransientTTL, core.class.Class)` decorator pattern in `models/core/src/core.ts:451`.

## Package structure

- `plugins/pulse` — interfaces only (`DocumentPresence`, `TypingIndicator`, plugin id, class refs). Deps: `@hcengineering/core`, `@hcengineering/contact`, `@hcengineering/platform`.
- `models/pulse` — `@Model` classes + `createModel` that runs `createModel(...)` and applies `TransientTTL` mixins. Registered in `models/all/src/index.ts` and `rush.json`.
- `plugins/presence-resources/src/{presence,typing}.ts` — rewritten on top of `createQuery(true)` + `getClient()`. Svelte-action pattern preserved (`presence`, `typing` still return `{update, destroy}`).

## Cleanup done in same PR

- Deleted `packages/hulypulse-client`, `foundations/hulypulse`.
- Removed `packages/presentation/src/pulse.ts` + `PulseUrl` metadata.
- Dropped `@hcengineering/hulypulse-client` dep from `presentation`, `presence-resources`, `love-resources`.
- Removed `PULSE_URL` / `pulseUrl` from `dev/prod/src/platform.ts`, `pods/front/src/__start.ts`, `server/front/src/{index,starter}.ts`, `desktop/src/ui/{types,platform}.ts`, `benchmarks/run_benchmark.sh`, `dev/prod/public/config{,-dev}.json`.
- Dropped `hulypulse` service from `dev/docker-compose.yaml` and `pods/external/services.d/hulypulse.service`.
- Removed `build-hulypulse` job from `.github/workflows/main.yml`.
- Removed `hulypulse` subtree pull from `scripts/takeUpstream.sh`.
- Removed `hulypulse-client` entry from `rush.json`; added `@hcengineering/pulse`, `@hcengineering/model-pulse`.

## Client-side plugin registration gotcha

`pulse` has no `-resources` package (only interfaces + model), so `addLocation(pulseId, ...)` is not called. Without that, `returnUITxes` in `foundations/core/packages/client-resources/src/index.ts:189` treats pulse as not-allowed and strips every pulse tx — clients log `exclude plugin pulse:N`, classes have no `domain`/`ancestors`, `createDoc('pulse:class:TypingIndicator', ...)` throws silently, `createQuery` never fires.

Fix: include `pulseId` in `ExtraPlugins` metadata:
- `dev/prod/src/platform.ts`: `setMetadata(client.metadata.ExtraPlugins, ['preference' as Plugin, pulseId as Plugin])`
- `desktop/src/ui/platform.ts`: same
- Add `@hcengineering/pulse` dep to both packages so `pulseId` can be imported.

Symptom when missing: console shows `domain not found: pulse:class:DocumentPresence` / `ancestors not found: pulse:class:TypingIndicator` as `pageerror`, typing indicator span stays empty. Debug by injecting a probe calling `client.findAll('pulse:class:TypingIndicator', {})`.

## Build / test workflow for pulse

1. Rebuild front image after changing `dev/prod` config: `rush fast-build:docker-build --to @hcengineering/pod-front` (~8s incremental). Model changes also need `--to @hcengineering/pod-server`. Full rebuild: `rush fast-build:docker-build` (~3.5min, 42 images).
2. Restart sanity env: `cd tests && ./prepare-pg.sh` — includes `--remove-orphans` on both `down` and `up` to clean stale services.
3. Run Playwright pulse spec without auto-opening HTML report:
   ```
   cd tests/sanity
   PLAYWRIGHT_HTML_OPEN=never LOCAL_URL=http://localhost:3003/ DEV_URL= \
     ./node_modules/.bin/playwright test -c ./tests/playwright.config.ts pulse.spec.ts --reporter=list
   ```
   `PLAYWRIGHT_HTML_OPEN=never` + `--reporter=list` stops HTML reporter from holding :9323 and opening a browser tab.
4. Spec: `tests/sanity/tests/chat/pulse.spec.ts` — two browser contexts via `getSecondPageByInvite`. Stable selectors added to source:
   - `span[data-id="channel-typing-info"]` in `ChannelTypingInfo.svelte` — typing indicator
   - `[data-id="document-presence"]` in `PresenceAvatars.svelte` — DocumentPresence avatars container
   Two tests: (1) typing indicator appears on page2 while user1 types, clears after send; (2) DocumentPresence avatar appears on page1 when user2 opens the same channel, disappears after TTL when user2 navigates away.

## Future ideas (see `docs/new-pulse.md`)

A `UserActivity` transient class (active/away/busy/in-meeting) built on the same substrate — heartbeat from user input + love room participation, TTL ~30s, auto-away via middleware expiry. Not in this PR.
