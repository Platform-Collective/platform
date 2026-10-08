# @hcengineering/safe-fetch

A `fetch` wrapper for services that request user-supplied URLs (link previews, CalDAV servers, webhooks).

It blocks server-side request forgery by:

- allowing only `https:` (and `http:` when explicitly enabled);
- resolving every A and AAAA record of the hostname and rejecting the request when any address falls in a
  private, loopback, link-local, multicast or otherwise reserved range;
- pinning the TCP connection to the addresses that were checked, so a DNS answer cannot change between the
  check and the connection;
- validating every redirect hop the same way, dropping `Authorization` when the origin changes and switching
  to `GET` where the HTTP specification requires it;
- applying a timeout across the whole redirect chain and a cap on the response body size.

Operators can allow specific hosts or CIDR ranges that would otherwise be blocked, for example a CalDAV server
on a private network.

```ts
import { createSafeFetch } from '@hcengineering/safe-fetch'

const fetch = createSafeFetch({ allowlist: ['caldav.internal.example', '10.20.0.0/16'] })
const res = await fetch('https://caldav.internal.example/.well-known/caldav', { redirect: 'manual' })
```
