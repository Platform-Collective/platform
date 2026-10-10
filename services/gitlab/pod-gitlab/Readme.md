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
   - Confidential: yes. Scopes: `api read_user` (`read_api` is not enough: the service writes issues and comments).
   - Copy the **Secret** immediately — GitLab stores it hashed and shows it only once (use *Renew secret* if lost, then enter the new secret in the dialog; renewing breaks the old one).
   - Access tokens expire after 2h by default (admins may change this); the service refreshes them automatically.
3. Enter the **Application ID** and **Secret** in the dialog. The GitLab URL is optional: tick **Self-managed GitLab** only for a host other than gitlab.com. Only workspace owners can save or remove the app; the secret is stored by the pod and is never shown again.
   Changing the host or Application ID, or removing the app, is refused while members are connected (the error names them).
   An owner can then use **Disconnect everyone**, which removes every member's connection, linked projects and webhooks (best effort).
4. Members then connect their GitLab accounts and link projects.

## Pod env

Required: `ACCOUNTS_URL`, `SERVER_SECRET`, `FRONT_URL`, `WEBHOOK_BASE_URL` (public URL of this service), `WEBHOOK_SECRET`, `COLLABORATOR_URL` (collaborator service URL, used to read and write issue descriptions).
Optional: `PORT` (3600), `SERVICE_ID` (default `gitlab-service`), `GITLAB_REDIRECT_URI` (default `{FRONT_URL}/gitlab`),
`STORAGE_CONFIG` (blob storage, same format as the other services; needed to show merge request diffs, which are skipped without it),
`ENABLE_CONSOLE` (default `true`; log to the console as well as to files),
`GITLAB_REQUEST_TIMEOUT_MS` (default `30000`): limit of one GitLab call, response body included.

`GITLAB_READONLY` (default `false`): when `true`, nothing is written to GitLab except the project webhooks. Changes made in
Huly stay queued (the sync doc shows a read-only error) and are sent once the variable is unset.

Webhooks: each linked project's hook goes to `{WEBHOOK_BASE_URL}/api/webhook/<workspace>/<integration>` with a secret
derived from `WEBHOOK_SECRET` (one per GitLab connection; nothing is stored). Changing `WEBHOOK_SECRET` re-keys every
hook on the next start.

`WORKSPACE_INACTIVITY_INTERVAL` (days, default `3`, like the GitHub service; `0` = never): the sync of a workspace nobody
visited for that long stops and resumes within five minutes of the next visit; disabled, deleted and archived workspaces are
never synchronized.

Optional, dev only: `GITLAB_ALLOW_INSECURE_HOSTS` (default `false`). When `true`, a self-managed GitLab URL may use plain
`http://` for `localhost`, `127.0.0.1` and `*.local` hosts; otherwise only `https://` is accepted. Never enable it in production.
The dev overlay `dev/docker-compose.gitlab.yaml` sets it to `true`.

Self-managed hosts: the pod calls only hosts whose every DNS address is public (no loopback, private, link-local, CGNAT or
metadata ranges, IPv4-in-IPv6 forms included), checked when the application is saved and before every GitLab call.
Optional `GITLAB_ALLOWED_HOSTS` (comma-separated host names): when set, exactly these hosts are accepted, private ones
included — use it for a GitLab on an internal network. `GITLAB_ALLOW_INSECURE_HOSTS=true` (dev) skips the check.
Known limit: the address is checked before the call, and `fetch` resolves the name again; a DNS rebinding within one minute
is not prevented.

Redirects: the pod never follows a redirect from GitLab, with one exception. Upload downloads (copied images and
`POST /api/v1/image`) follow at most 3 redirects, because a GitLab with object storage (`proxy_download` off) answers
them with a redirect to the object store. Each redirect target must use `https://` and resolve only to public addresses
(`GITLAB_ALLOWED_HOSTS` trusts GitLab hosts only, not object stores; `GITLAB_ALLOW_INSECURE_HOSTS=true` accepts any
target), and the `Authorization` header is not sent once a redirect leaves the GitLab origin. Error messages shown in
Huly carry only GitLab's own JSON `message`/`error` text (at most 200 characters); the raw response body is only logged.

There are no GitLab app env vars. Local (from `dev/`): `docker compose -f docker-compose.yaml -f docker-compose.gitlab.yaml up -d gitlab`.

Note: gitlab.com cannot reach `huly.local` for webhooks. For local webhook testing set `GITLAB_WEBHOOK_BASE_URL`
(compose) / `WEBHOOK_BASE_URL` to a tunnel URL (e.g. smee or ngrok).

## Images

Each GitLab integration chooses how images from GitLab reach Huly (Images from GitLab, in the integration dialog,
where only workspace owners can change it; the server does not enforce this):

- **Link to GitLab** (default): Huly shows the image as an ordinary link, named after the image, that opens it on
  GitLab. The issue or merge request header shows **GitLab images (N)** for the description's GitLab images. It opens a
  viewer that loads each image with your own GitLab account, so GitLab's permissions decide who sees it. Without access,
  or without a connected GitLab account, the viewer says so and offers "Open in GitLab". Images in comments stay links.
  The link keeps the image's GitLab size in its `#gitlab-image=…` fragment, so the image goes back to GitLab unchanged.
  An image with a title, or inside another link, stays an image linked to GitLab.
- **Copy into the workspace**: an image in a GitLab issue, merge request, comment or review comment is downloaded
  into the workspace's blob storage, and everyone with access to the linked Huly project sees it. GitLab 17.4 or later
  is needed (`GET /projects/:id/uploads/:secret/:filename`).

Switching to Link takes effect on each document's next sync: copied images are replaced by GitLab links, and the
copies stay unused in storage. Switching to Copy downloads the images on each document's next sync.

- An image in a Huly description or comment is uploaded to the GitLab project. Files attached to a Huly comment are
  listed at the end of its GitLab note, below an invisible `<!-- huly-attachments -->` line. Huly owns that list:
  edits to it in GitLab are overwritten. Attachments that cannot be copied (over 20 MB, or without blob storage) are
  left out of that list. Comments synced before this change get their list the next time they sync.
- Each copy is recorded (`GitlabUpload`), so an image is copied once and round trips change nothing.

Copying needs `STORAGE_CONFIG`, in both directions. Without it, or when a copy fails (an older GitLab, a file over 20 MB, a lost
authorization), the image is linked instead: GitLab images become absolute GitLab links, and Huly images keep their
Huly links. A failed copy is tried again the next time the document syncs. In copy mode, documents synced before this change get
their copies on their next change. HTML `<img>` tags and the issue Attachments section are not copied.

`POST /api/v1/image` (`{ token, accountId, url }`) returns a linked repository's upload, downloaded with the caller's
own GitLab token, or `403 not-connected | no-access`, `404 not-found`, `503 unavailable`. It never uses the
integration's token.

## Development

- Debug in VS Code with **Debug GitLab integration** (`.vscode/launch.json`). Stop the compose container first
  (`docker compose -f docker-compose.yaml -f docker-compose.gitlab.yaml stop gitlab` from `dev/`); both use port 3600. Set `POD_GITLAB_WEBHOOK_BASE_URL`
  to a tunnel URL when GitLab must reach the pod.
- To try the service against a real GitLab without changing it, set `GITLAB_READONLY=true`: Huly receives everything,
  and changes made in Huly stay queued with a visible "read-only" error until the variable is unset.
- Tests: `npx jest` in this package (and in `gitlab-resources`, `gitlab-assets`, `server-gitlab-resources`, `model-gitlab`).
- The GitHub service's dev-tool commands `restore-github-integrations` and `migrate-github-account` migrate GitHub's
  storage from before the account service. GitLab connections have always lived in the account service, so there is no
  GitLab counterpart.
- The health job (hourly per GitLab connection) checks the token, refreshes the project list (renames and transfers
  included), and re-installs missing webhooks. Restarting the pod runs it at once.
