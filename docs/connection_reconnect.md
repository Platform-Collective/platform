# Client connection and reconnection scheme

## Overview

The client talks to the server over a single WebSocket. All requests (findAll, tx, loadModel,
ping) go through it. State lives in `foundations/core/packages/client-resources/src/connection.ts`.

## Connection lifecycle

```
   [ new Connection() ]
           |
           v
   scheduleOpen(force=false) ------+
           |                       |
           v                       |
   openConnection()                |
     |                             |
     |-- create WebSocket          |
     |-- dialTimer = 30s -------+  |
     v                          |  |
   wsocket.onopen               |  |
     |-- send HelloRequest(-1)  |  |
     v                          |  |
   wsocket.onmessage            |  |
     |-- HelloResponse          |  |
     |   |-- helloReceived=true |  |
     |   |-- clearTimeout dial -+  |
     |   |-- account, lastHash     |
     |   |-- for req in requests:  |
     |   |      req.reconnect() ---+---> setTimeout 50ms -> sendData()
     |   |-- onConnect(event)      |         |
     |   |     event =             |         +-- STORM of simultaneous
     |   |       Connected         |             sends
     |   |       | Reconnected     |
     |   |       | Maintenance     |
     |   |-- schedulePing()        |
     |                             |
     |-- (regular responses)       |
     |                             |
   wsocket.onclose                 |
     |-- scheduleOpen(force=true) -+
     |
   wsocket.onerror
     |-- delay += 1 (max 3s)
```

## Key timings

| Constant | Value | Purpose |
|-----------|----------|-----------|
| `pingTimeout` | 10s | Ping send interval |
| `hangTimeout` | **5 min** | "Hung" socket threshold → force close |
| `dialTimeout` | 30s | Hello timeout. No hello → reconnect |
| `reconnect delay` | 50ms | Delay before retrying each pending request |

## Connection state

- `requests: Map<ReqId, RequestPromise>` — all pending requests.
- `onConnectHandlers: OnConnectHandler[]` — waiting on `waitOpenConnection`.
- `websocket` — current socket (recreated on reconnect).
- `sockets` — counter guarding against a race between two parallel connects.
- `pingResponse` — timestamp of the last pong.
- `helloReceived` — hello completed → requests may be sent.
- `slowDownTimer` — adaptive delay under rate limiting.

## What happens on reconnect

### 1. Disconnect detection

Three sources:
1. `wsocket.onclose` → `scheduleOpen(force=true)`.
2. Ping check `pingResponse > hangTimeout` → close(1000).
3. `dialTimer` did not fire within 30s → `onDialTimeout` + force.

**Mobile problem**: when backgrounded, iOS/Android browsers freeze
timers and the WS. The socket is formally `OPEN`, but no data flows. The hangTimeout=5min
detector wakes up after 5 minutes — **the UI hangs for that entire time**.

### 2. Repeated openConnection

`openConnection()` creates a new WebSocket and sends Hello. On the response:

```ts
for (const [, v] of this.requests.entries()) {
  v.reconnect?.()
}
```

Each pending request resends `sendData()` after 50ms.

### 3. onConnect callback → refresh UI

In `plugins/workbench-resources/src/connect.ts:363`:

| Event | Action |
|-------|---------|
| `Connected` + `_clientSet` | `refreshClient(tokenChanged)` + `refreshCommunicationClient` |
| `Reconnected` | **only** `refreshCommunicationClient` |
| `Refresh` | `refreshClient(true)` |
| `Upgraded` | `window.location.reload()` |
| `Maintenance` | Show banner |

**Important**: `refreshClient` is **NOT** called on `Reconnected`. LiveQueries keep
their old results; updates arrive via the tx stream.

### 4. refreshClient → LiveQueries.refreshConnect

`foundations/core/packages/query/src/index.ts:112` `refreshConnect(clean)`:

- Iterates over all queries (`this.queries` + `this.queue`).
- With `clean=true` it clears results and invokes callbacks with an empty array.
- Calls `this.refresh(q)` for each one → **another findAll to the server**.

For N active queries this means N parallel findAll calls — extra load
on top of the already resent pending requests.

## What accumulates while the app sleeps

While the tab is in the background, the WebSocket may be frozen. During that time:

1. **Ping requests** (10s interval). The `once:true` guard (connection.ts:693) prevents
   duplicates, but one pending ping stays hanging.
2. **UI requests** started before backgrounding — e.g. a link navigation
   managed to create a findAll that remained in `requests`.
3. **The first request on resume**: the UI becomes active before the dead socket is
   detected → Svelte components fire findAll → they land in `requests` and
   wait on `waitOpenConnection` until hangTimeout expires (up to 5 min).
4. **LiveQuery subscription requests** — the primary findAll for each subscription.

When the reconnect finally happens:
- All those N requests get `reconnect()` → after 50ms **all of them fly to the
  server at once**.
- The server responds, but the client is busy: Svelte reactivity + JSON parse +
  tx-stream processing → the event loop is saturated.
- From the log: `time=1800ms`, `serverTime=200ms`, `toReceive~0` → **the delay is on
  the client**, not the network.

## Why data looks stale after `Reconnected`

`refreshConnect` is NOT called on `Reconnected`. LiveQueries show
the last known result. Updates arrive only via the tx stream from the
server (broadcasted events). If the server accumulated txes for this session
while it slept, they will arrive — but only after hello and after the queue of
resent requests is worked through.

## Server-side queue (the `queue` field)

`service.requests.size` — the number of pending requests in the server session.
Visible in the log: `queue=13` — i.e. the client sent 13 requests at once.
It is not a limiting queue, just a metric.

## What visibilitychange does

The client **does** have a `document.visibilitychange` handler (`installVisibilityHandler`).
When the tab becomes visible again, the client checks the socket state and forces
a reconnect if needed:

- If the socket is `null` / `readyState !== OPEN` / hello not received → immediate
  `scheduleOpen(force=true)`.
- Otherwise send a short ping (`once=true`); if no pong arrives within
  `visibilityProbeTimeout` (1s) → force reconnect.

This does not imply a separate `refreshConnect` on `Reconnected`: LiveQueries
still keep the last known result, and updates arrive
via the tx stream after hello and after the resent request queue is processed.

---

## Logging points (storm diagnostics)

### 1. Connection — track request accumulation

`foundations/core/packages/client-resources/src/connection.ts`:

- In `sendRequest` when adding to `this.requests`: log `size, method, id`.
- In `handleMsg` on removal: log `size, age = Date.now() - startTime, method`.
- In the hello-response reconnect branch (line 384): log `reconnectingCount, oldest
  pending age`.
- In the `schedulePing` hangTimeout branch: log `timeSinceLastPong, pendingCount`.

### 2. Visibility

Add to `Connection`:

```ts
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState === 'visible'
    console.log('[conn] visibility', {
      visible,
      readyState: this.websocket?.readyState,
      pendingCount: this.requests.size,
      sinceLastPong: Date.now() - this.pingResponse,
      oldestRequest: this.getOldestRequestAge()
    })
    // Force ping probe on resume
    if (visible && this.websocket?.readyState === ClientSocketReadyState.OPEN) {
      // liveness probe with a short timeout
    }
  })
}
```

### 3. LiveQuery — track refresh storms

`foundations/core/packages/query/src/index.ts` `refreshConnect`:

```ts
console.log('[lq] refreshConnect', {
  clean,
  queriesCount: [...this.queries.values()].reduce((a, v) => a + v.size, 0),
  queueCount: this.queue.size
})
const t0 = Date.now()
// ... after loop
console.log('[lq] refreshConnect done', { ms: Date.now() - t0 })
```

### 4. measure findAll — exists already, but extend

`connection.ts:778-792` — add `pendingCount, sinceReconnect` to the log.

### 5. Server side (optional)

`foundations/server/packages/server/src/sessionManager.ts` — when handling a
request, log `sessionId, queueSize, sinceReconnect`. Helps determine whether
the queue is really on the server or on the client.

### 6. Reconnect storm

In the `handleMsg` hello branch (line 384), wrap in `setTimeout` with jitter:

```ts
const reqs = [...this.requests.values()]
reqs.forEach((v, idx) => {
  setTimeout(() => v.reconnect?.(), Math.random() * 200)
})
```

For diagnostics, start by simply logging the length of reqs and request lifetimes.

## Root-cause hypothesis

A combination of:
1. iOS/Android freezes the WebSocket and setInterval.
2. After resume the socket is formally OPEN, but no data flows.
3. The UI is already active and fires 10-20 findAll calls.
4. Dead-socket detection waits up to 5 minutes (hangTimeout).
5. When finally detected: reconnect → a storm after 50ms across all pending requests.
6. Svelte reactivity + parsing saturate the event loop → findAll time of 1800ms
   with serverTime of 200ms.
7. `Reconnected` does not restart queries → UI data stays stale until txes arrive.

## Recommendations (for discussion, not implementation)

1. `visibilitychange` → probe ping with 2s timeout → force reconnect on failure.
2. Lower `hangTimeout` to 30-60s or make it adaptive on mobile.
3. Jitter of 50-500ms instead of the shared 50ms in the reconnect branch.
4. On `Reconnected`, call `refreshClient(false)` (without clean) to
   refresh critical queries.
5. Cap resend parallelism with a semaphore (e.g. 5 concurrent).
