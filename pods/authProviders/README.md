<!-- SPDX-License-Identifier: EPL-2.0 -->

# Bounded OIDC sessions (stage 1)

`OPENID_SESSION_LIFETIME` opts new OIDC logins into a fixed Huly session lifetime,
expressed as integer seconds from **60 through 31536000** (inclusive). For example,
`OPENID_SESSION_LIFETIME=3600` requires reauthentication after one hour. The value
is read once when the OIDC provider is registered; restart account-service after
changing it. Each successful login receives a fresh deadline.

Unset retains legacy behavior: no JWT expiry and a one-year account cookie. One
startup warning names the unset variable. Invalid values (including empty values,
fractional seconds and `idp`) log a startup error and **fall back to the legacy
unbounded lifetime**. This fail-open policy preserves availability for OIDC-only
deployments; monitor startup logs to detect configuration mistakes. The provider
remains registered with its normal discovery retries and temporary 503 responses
while discovery is pending.

Configured sessions carry `exp` and `extra.authMethod: 'oidc'`. Account/workspace
reissue paths preserve the original deadline; cookies expire at the earlier of
that deadline or one year. Creating/joining/leaving a workspace does not renew the
session. Reissue does not copy `sub` or `grant` into cookies or broaden their
existing permissions.

Transactors reject new requests at expiry and remove an expired OIDC session from
broadcast/session maps on its next tick (within one second). A terminating error
uses the negotiated encoding/compression; if delivery stalls, the socket is closed
within another 250 ms independently of logout queue publication. A reconnect with
an expired OIDC JWT receives a terminating handshake error. Local logout waits at
most one second for cookie deletion before clearing local credentials and returning
to login, even when account-service is unavailable. With a suspended/offline
browser this happens on resume/reconnect. Event-loop stalls can delay timers.

Only the newly marked OIDC sessions opt into active socket expiry and the bounded
logout wait. Existing unbounded JWTs, password/OTP/Google/GitHub logins and active
API/grant sockets retain their behavior. Existing finite JWT deadlines are retained
on account-token reissue as well. No schema migration is needed.

Rollout:

1. Upgrade **all account-service and transactor replicas**, together with the
   frontend, with the variable unset. Older account services can strip `exp`;
   older transactors do not end active sessions.
2. Set a valid lifetime on all account-service replicas and restart them.
3. Test a new OIDC login, invite join, workspace creation, expiry while connected
   and reconnect after expiry. Old unbounded JWTs remain valid: enabling the
   variable does not retroactively invalidate them.

Rollback: first unset the variable on all account-service replicas and restart
them. Keep the new transactors/frontend through the longest previously configured
lifetime so already-issued bounded sessions still expire correctly. Only then
roll back the implementation. Removing the variable affects future logins; it
does not extend existing bounded sessions.

This stage is a fixed-TTL mitigation for #10833. It does **not** adopt IdP-granted
lifetimes, store provider credentials, refresh tokens, or immediately revoke access
when a user is deleted at the IdP. Those require later stages. Other services with
long-lived sockets (collaboration, streams, etc.) are not swept here. Users who can
also authenticate by password/OTP/recovery can still obtain independent sessions;
OIDC-only access requires restricting those alternative login methods separately.
