# Huly MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes a
Huly workspace to AI agents. It speaks MCP over Streamable HTTP and is built as a
regular pod in the platform monorepo, so it ships in the same Docker release as
everything else and is version-locked to the Huly API it talks to.

## How it works

```
Claude / Cursor / OpenCode
        │  POST /mcp   (JSON-RPC 2.0)
        ▼
  @hcengineering/pod-mcp
        │  REST over HTTP
        ▼
  pods/server  (transactor)  ──►  Mongo / Postgres
```

The pod never opens a WebSocket. It uses `@hcengineering/api-client`, the same
stateless REST path that `pod-print` and `pod-export` use, which means one
workspace client per account rather than one socket per session.

## Configuration

### Self-hosted (recommended for a single team)

Give the pod a Huly URL and a credential once, in compose. Every MCP client then
connects to the pod's own URL and needs no Huly credential of its own — this is
what makes the endpoint usable from Claude Desktop or a phone.

```yaml
services:
  mcp:
    image: platformcollective/mcp
    extra_hosts:
      - 'huly.local:host-gateway'
    environment:
      - SECRET=<a long random string>
      - ACCOUNTS_URL=https://huly.your-company.com
      - HULY_TOKEN=<a Huly API token>       # or HULY_EMAIL + HULY_PASSWORD
      - HULY_WORKSPACE=<workspace url slug or id>   # required unless the token is workspace-bound
      - COLLABORATOR_URL=http://collaborator:3078   # optional, enables issue descriptions
    ports:
      - 4090:4090
    restart: unless-stopped
```

Create the API token in Huly under **Settings → API Tokens**. The token carries
the full rights of the account that created it, so use a dedicated service
account rather than your own.

The pod must be able to reach the transactor at the address the account service
advertises for the workspace (`TRANSACTOR_URL` on the account service, second
value), and the collaborator at `COLLABORATOR_URL`. In a compose network that
usually means the public host name plus `extra_hosts`, as above.

### Multi-tenant

Leave the credential out and callers present their own Huly API token:

```yaml
    environment:
      - SECRET=<a long random string>
      - ACCOUNTS_URL=https://huly.your-company.com
      - MCP_ALLOWED_TOKENS=<token>,<token>   # optional pin to specific tokens
```

Every request must then carry `Authorization: Bearer <huly api token>`, and
sessions are pinned to the account that opened them.

### All environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4090` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `SECRET` | — | **Required.** The platform's signing secret (the same value the account and transactor use). The pod refuses to start on the well-known default `secret`. |
| `MCP_ALLOW_DEFAULT_SECRET` | `false` | Lets a throwaway development stack keep `SECRET=secret`. Never set in production. |
| `ACCOUNTS_URL` | `http://huly.local:3000` | Account service URL; the public Huly base URL in a self-hosted install |
| `SERVICE_ID` | `mcp` | Service name used in logs and metrics |
| `HULY_TOKEN` | — | Static Huly API token. Presence selects self-hosted mode. |
| `HULY_EMAIL` / `HULY_PASSWORD` | — | Static login, used when no token is set |
| `HULY_WORKSPACE` | — | Workspace url slug or id. Required with email/password or an account-level token: the pod asks the account service for a token scoped to it. |
| `COLLABORATOR_URL` | — | Collaborator service URL. Without it, tools that write rich text (issue `description`) refuse instead of silently dropping the text; comments and everything else are unaffected. |
| `MCP_READONLY` | `false` | Refuse every write tool regardless of credentials |
| `MCP_ALLOWED_TOKENS` | — | Comma-separated allowlist for multi-tenant mode |
| `MCP_SESSION_TTL_MS` | `1800000` | Idle session lifetime |
| `MCP_CLIENT_CACHE_TTL_MS` | `600000` | Idle workspace-client cache lifetime |
| `MCP_LOGIN_CACHE_TTL_MS` | `60000` | How long a login result is reused |
| `MCP_RATE_LIMIT` | `300` | Requests per window, per client |
| `MCP_RATE_WINDOW_MS` | `60000` | Rate limit window |
| `MCP_MAX_BODY_BYTES` | `1048576` | Max JSON-RPC request body |
| `MCP_STATS` | `true` | Serve `/api/v1/statistics` |

## Connecting a client

```json
{
  "mcpServers": {
    "huly": {
      "type": "http",
      "url": "https://mcp.your-company.com/mcp"
    }
  }
}
```

In self-hosted mode add the pod's URL only. In multi-tenant mode also add the
bearer token your client supports.

## Tools

Read:

- `huly_search` — full-text search across issues, projects, documents, tasks, milestones, people
- `huly_list_projects`, `huly_get_project`
- `huly_list_issues`, `huly_get_issue`, `huly_list_issue_statuses`
- `huly_list_tasks`, `huly_find_people`
- `huly_list_spaces`, `huly_list_drives`, `huly_list_documents`, `huly_get_document`
- `huly_list_milestones`

Write (refused when read-only):

- `huly_create_issue`, `huly_update_issue`, `huly_add_issue_comment`
- `huly_create_milestone`, `huly_create_person`

## Security notes

- **Write access is the caller's, not the server's.** Every write goes through
  `TxOperations`, which is permission-checked by the transactor. The pod never
  uses the system account, so a tool can never exceed the caller's rights.
- **Sessions are pinned.** A session id is bound to the account and workspace
  that created it; presenting it with a different token returns 403.
- **Revocation is enforced.** `verifyToken` plus a revocation checker wired to
  the account service means a revoked API token stops working.
- **Guest tokens are rejected**, as are read-only tokens for write tools.
- **Rate limited** per client, because standalone pods get no limiting from the
  platform.

## Development

```bash
rush install
rush build --to @hcengineering/pod-mcp
rushx test --to @hcengineering/pod-mcp
rushx run-local     # needs SECRET, ACCOUNTS_URL and credentials
```

The MCP protocol layer has no dependency on Huly: `src/mcp/` is transport- and
platform-agnostic and unit tested on its own.

### Smoke test against a running platform

With the dev stack up (`cd dev && docker compose up -d`) and `HULY_TOKEN` (or
`HULY_EMAIL` + `HULY_PASSWORD`) set on the `mcp` service:

```bash
curl -s localhost:4090/api/v1/health

# initialize: expect HTTP 200, an Mcp-Session-Id response header and a protocolVersion echo
curl -si localhost:4090/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# then reuse the returned session id
curl -s localhost:4090/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"huly_list_projects","arguments":{}}}'
```
