# GitLab integration service

GitLab OAuth app credentials are configured per workspace in the UI, not in pod env.

## Setup (workspace owner)

1. Enable "GitLab" in workspace Settings → Configure (beta), then open Settings → Integrations → GitLab.
2. Register an OAuth application in GitLab — any of the three types works identically for this service
   (see https://docs.gitlab.com/integration/oauth_provider/):
   - **User-owned:** avatar → Edit profile → Access → Applications → Add new application.
   - **Group-owned** (recommended for teams; survives people leaving): group → Settings → Applications.
   - **Instance-wide** (self-managed only, admin): Admin → Applications → New application. Mark it **trusted** to skip the consent screen for users.

   For every type, the setup dialog shows the values to use:
   - Redirect URI: `{FRONT_URL}/gitlab` (or `GITLAB_REDIRECT_URI`) — must match exactly.
   - Confidential: yes. Scopes: `api read_user` (`read_api` is not enough; later phases write issues/comments).
   - Copy the **Secret** immediately — GitLab stores it hashed and shows it only once (use *Renew secret* if lost, then enter the new secret in the dialog; renewing breaks the old one).
   - Access tokens expire after 2h by default (admins may change this); the service refreshes them automatically.
3. Enter the **Application ID** and **Secret** in the dialog. The GitLab URL is optional: tick **Self-managed GitLab** only for a host other than gitlab.com. Only workspace owners can save or remove the app; the secret is stored by the pod and is never shown again.
   Changing the host or Application ID, or removing the app, is refused while members are connected (the error names them).
   An owner can then use **Disconnect everyone**, which removes every member's connection, linked projects and webhooks (best effort).
4. Members then connect their GitLab accounts and link projects.

## Pod env

Required: `ACCOUNTS_URL`, `SERVER_SECRET`, `FRONT_URL`, `WEBHOOK_BASE_URL` (public URL of this service), `WEBHOOK_SECRET`, `COLLABORATOR_URL` (collaborator service URL, used to read and write issue descriptions).
Optional: `PORT` (3600), `SERVICE_ID` (default `gitlab-service`), `GITLAB_REDIRECT_URI` (default `{FRONT_URL}/gitlab`),
`ENABLE_CONSOLE` (default `true`; log to the console as well as to files).

Optional, dev only: `GITLAB_ALLOW_INSECURE_HOSTS` (default `false`). When `true`, a self-managed GitLab URL may use plain
`http://` for `localhost`, `127.0.0.1` and `*.local` hosts; otherwise only `https://` is accepted. Never enable it in production.
The local `dev/docker-compose.yaml` sets it to `true`.

There are no GitLab app env vars. Local: `docker compose -f dev/docker-compose.yaml up -d gitlab`.

Note: gitlab.com cannot reach `huly.local` for webhooks. For local webhook testing set `GITLAB_WEBHOOK_BASE_URL`
(compose) / `WEBHOOK_BASE_URL` to a tunnel URL (e.g. smee or ngrok).
