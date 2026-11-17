# Auth provider session cookies

`@hcengineering/auth-providers` uses `koa-session` to retain OIDC state,
nonce, and PKCE information while an authentication request is redirected to
an identity provider and back.

By default it keeps koa-session's existing host-scoped `koa.sess` cookie and
its existing `Secure` and `SameSite` defaults.

## Cross-subdomain OIDC

Set `SESSION_COOKIE_DOMAIN` only when the authentication request begins on one
subdomain and the callback returns to another:

```sh
SESSION_COOKIE_DOMAIN=.example.com
```

For example, this is correct when a flow starts at `dev.example.com` and the
identity provider redirects to `app.example.com`. It is not a URL: do not use
`https://example.com`, a port, or a path. It must be a parent domain of every
participating host; `.app.example.com` does not cover `dev.example.com`.

The service validates only the domain syntax. Do not use a public suffix such
as `co.uk`; browsers reject public suffixes and domains unrelated to the
request host. A valid domain-scoped configuration uses `huly.sess` instead of
the default `koa.sess`, preventing collisions with another koa-session
application on a sibling subdomain. Deployments without this setting retain
the existing `koa.sess` name.

Enabling `SESSION_COOKIE_DOMAIN` is a one-time cookie-name transition: the
session middleware reads `huly.sess` and does not migrate or read an existing
`koa.sess` session. Signed-in users are not affected; only OIDC logins in
progress during the change must be restarted. An OIDC flow started before the
deployment loses its stored state, nonce, and PKCE values; restart that login
flow. Schedule the change with that short-lived interruption in mind.

`SESSION_COOKIE_DOMAIN` changes only the cookie scope. In particular, it does
not assert anything about TLS and does not add `Secure` or `SameSite`.

## Secure cookies behind TLS termination

Set `SESSION_COOKIE_SECURE=true` when the browser reaches the service through
HTTPS but TLS terminates at a proxy in front of this plain-HTTP process:

```sh
SESSION_COOKIE_DOMAIN=.example.com
SESSION_COOKIE_SECURE=true
```

The accepted boolean values are `true`/`false`, `1`/`0`, and `yes`/`no`.
When unset, the existing koa-session Secure behaviour is preserved. `true`
marks only this session cookie Secure; it neither trusts forwarded headers nor
changes the Secure default of other cookies written by the service. Use
`false` only when an explicitly non-Secure session cookie is required for a
plain-HTTP development deployment.

Neither setting changes `SameSite`. This preserves compatibility with identity
providers using a top-level GET callback. It does not establish support for
`response_mode=form_post`: browsers can treat an omitted SameSite attribute as
Lax and withhold the session cookie on a cross-site POST. Use the authorization
code flow with a query/GET callback. Supporting form_post requires both a POST
callback handler and an explicit `SameSite=None; Secure` session configuration;
neither is provided by these settings.

## Forwarded headers and cookie handling

The service deliberately does not enable Koa's global `app.proxy` setting.
That setting trusts forwarded protocol information for the whole application;
this service does not establish that requests can arrive only through a proxy
that strips and replaces client-supplied forwarded headers. Enabling it here
would broaden trust beyond session-cookie configuration.

Instead, `SESSION_COOKIE_SECURE=true` explicitly permits only the session
cookie and its signature to be emitted as Secure behind TLS termination. The
middleware temporarily adjusts the cookie object's secure flag while calling
its setter, then restores the flag even if the setter throws. Other cookie
writers keep their existing defaults. This is an adapter for the currently
installed Koa/Cookies API; dependency upgrades must retain the session-cookie
integration tests. Configure it only where the browser-facing connection is
HTTPS, and restrict direct access to the HTTP service at the deployment edge.

## Release notes: cookie-domain transition

Enabling or disabling `SESSION_COOKIE_DOMAIN` changes the cookie name between
`koa.sess` and `huly.sess`. An OIDC login already in progress cannot resume
across that transition and must be restarted. During a rolling deployment,
requests reaching pods with different cookie-domain settings can fail the same
way. Drain in-progress login flows and apply the setting consistently across
authentication pods; schedule a brief sign-in interruption. The old cookie is
not imported into the new session.
