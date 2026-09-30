# Agent log

Appended by each agent so work can be resumed across sessions. Read only the tail.

---

[2026-09-30] Added `@hcengineering/pod-mcp` — a Model Context Protocol server over Streamable HTTP, registered in `rush.json`, `common/scripts/docker.sh`, `dev/docker-compose.yaml` and `ARCHITECTURE_OVERVIEW.md`. Branch `feat/mcp-http-server`, based on `origin/develop`.

[2026-09-30] Decision: built in THIS repo rather than a separate repository. Reasons: (1) the pod consumes `@hcengineering/*` as `workspace:^` deps, so it can never drift from the platform API; out of repo it would pin published versions, and `@hcengineering/document` is `shouldPublish: false` so it is not even in the publish pipeline; (2) the Docker image ships automatically on the next `v*` tag with zero CI changes, because `docker:build`/`docker:push` are blanket rush commands; (3) self-hosters get it by adding one compose service; (4) it inherits the platform's logging, metrics and analytics conventions.

[2026-09-30] Rejected the community repo `ZubeidHendricks/huly-mcp` as a source to copy. Audited it: 6 commits over 4 days, last touched 2025-05-01. It is NOT an MCP server — it uses a custom JSON-RPC dialect (`huly.findPerson`, `huly.createIssue`) with no `initialize`/`tools/list`/`tools/call`. `src/api/hulyApi.ts` is 100% hardcoded fixtures and `src/index.ts` hardcodes `MOCK_MODE = true`. There is NO LICENSE file (package.json claims MIT but no grant exists), so there is nothing to vendor legally. It has no auth, CORS `*` on write endpoints, and a Dockerfile that cannot build from a clean clone. Its 8-action inventory was used only as a feature checklist.

[2026-09-30] Auth design: two modes behind one `Authenticator` interface. `configured` (self-host) reads `HULY_TOKEN` or `HULY_EMAIL`+`HULY_PASSWORD` from the pod env so MCP clients need no Huly credential; `perRequest` (multi-tenant) has the client send its own Huly API token. Decorators: optional `MCP_ALLOWED_TOKENS` allowlist, and `MCP_READONLY` clamp applied outermost so it cannot be bypassed by a token flag.

[2026-09-30] Security decisions worth remembering: registered `setApiTokenRevocationChecker` at boot, because without it `verifyToken` silently accepts revoked API tokens. Sessions are pinned to the account+workspace that created them, so a leaked `Mcp-Session-Id` is useless and a token swap returns 403. Guest tokens rejected. Never uses the system account, so all writes stay permission-checked and attributed to the caller. Added a per-client rate limiter because standalone pods get no limiting from the platform.

[2026-09-30] No `@modelcontextprotocol/sdk` dependency was added on purpose. The server side of MCP is JSON-RPC 2.0 plus a small envelope, and the repo has zero external AI SDK deps and no zod. `src/mcp/` is transport- and platform-agnostic and unit tested. Swapping in the official SDK later is a change to `src/mcp/` only.

[2026-09-30] FIXED: first `rush update` failed — `eslint-plugin-promise@^6.21.0` does not exist (latest is 7.3.0). Corrected to `^6.1.1` to match `pods/link-preview`. Also corrected `api-client` to `workspace:^0.7.19` and `analytics-service` to `workspace:^0.7.18` to match the real package versions; the wrong values would have failed `rush check` and `common/scripts/check-versions.js` in CI.

[2026-09-30] NEXT: verify `rush build --to @hcengineering/pod-mcp` and `rushx test` pass, then open the PR against `develop`.

[2026-09-30] CORRECTION to the entry above: the dependency ranges that pass `rush check` and `check-versions.js` follow repo convention (sibling pods declare the higher range: `api-client` `^0.7.25`, `analytics-service` `^0.7.19`), not the literal package.json versions. Build, validate, `rush check`, `check-versions.js`, `tsc --noEmit` and jest are all green.

[2026-09-30] Runtime smoke test WITHOUT a live Huly (pod started via ts-node, `SECRET` set, `ACCOUNTS_URL` unreachable): `/api/v1/health` 200 with 18 tools; missing/garbage/forged bearer → 401; malformed JSON → 400; GET/DELETE without `Mcp-Session-Id` → 400; CORS preflight 204; unknown route 404; boot refuses `SECRET` unset or `secret`. FOUND AND FIXED: an oversized body returned 500 because `errorHandler` did not map body-parser errors; it now returns 413 (regression tests in `src/middleware/__tests__/error-handler.test.ts`).

[2026-09-30] NOT VERIFIED: no tool handler has run against a real Huly workspace, and the authenticated `initialize` → `tools/list` → `tools/call` path needs a live account service. Treat tool handlers as unproven at runtime until someone runs the smoke test from `pods/mcp/README.md` against a dev stack.

[2026-09-30] Known non-issue: `rush test --to @hcengineering/pod-mcp` also runs upstream tests, and `@hcengineering/measurements` `src/__tests__/performance.test.ts` has a timing assertion that flakes under parallel load. It passes 70/70 standalone and this branch does not touch it. Do not chase it.

[2026-09-30] FOR MAINTAINER REVIEW: `huly_create_issue` derives the next issue number as `max(number)+1` because Huly's numbering middleware is not vendored here, so two concurrent creates in one project can collide. Needs a decision (numbering hint, server-side sequence, or a follow-up).

[2026-09-30] WARNING: never run `node_modules/.bin/format` or `rushx format` inside a package dir — it once emptied 24 source files in pods/mcp. Use only `node common/scripts/install-run-rush.js fast-format --branch develop` from the repo root, and check `find pods/mcp/src -name '*.ts' -size 0` afterwards.
