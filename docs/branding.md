# Branding for self-hosted installations

Branding is configured per host in two JSON files. In both, each key is a host
name with port, as it appears in the browser address bar.

- **Front service** – the file at `BRANDING_URL` (see `dev/prod/public/branding.json`):
  page title, icons, login look, languages and default application.
- **Account service** – the file at `BRANDING_PATH` (see `dev/branding.json`):
  the product name, language and front URL used in account emails. The host is
  taken from the `Origin`/`Referer` of the request.

Front service example:

```json
{
  "app.example.com": {
    "title": "Acme Workspace",
    "loginTheme": "plain",
    "links": [
      { "rel": "icon", "href": "/acme/favicon.svg", "type": "image/svg+xml" },
      { "rel": "shortcut icon", "href": "/acme/favicon.ico", "sizes": "any" },
      { "rel": "apple-touch-icon", "href": "/acme/apple-touch-icon.png" },
      { "rel": "manifest", "href": "/acme/site.webmanifest" }
    ]
  }
}
```

Account service example:

```json
{
  "app.example.com": {
    "key": "acme",
    "title": "Acme Workspace",
    "protocol": "https",
    "language": "en"
  }
}
```

## Fields related to the product brand

| File | Field | Default | Effect |
|---|---|---|---|
| front | `title` | `Platform` | Browser tab title and product name shown in the UI. |
| front | `loginTheme` | `relyframe` | Look of the login, sign-up and onboarding pages. `relyframe` shows the RelyFrame logo and accent colours. `plain` shows no platform logo and keeps the neutral theme colours. |
| front | `links` | none | `<link>` tags added to the page: favicons, touch icon, web app manifest. |
| account | `title` | `PRODUCT_NAME`, then `RelyFrame` | Product name in account emails (sign-up confirmation, password recovery and setup, invitations, sign-in codes) and in authenticator apps. |

## Installations with their own brand

**Set `"loginTheme": "plain"` for every host that carries its own brand.**
Configurations without `loginTheme` get the default `relyframe` look, so the
RelyFrame logo and accent colours appear on the login and onboarding pages.

Also:

- set `title` to your product name in **both** files, or set the
  `PRODUCT_NAME` environment variable of the account service. Otherwise
  account emails say “RelyFrame”;
- point `links` at your own icons.

## Legacy icon paths

The icons formerly served under `/huly/` (`favicon.ico`, `favicon.svg`,
`apple-touch-icon.png`, `site.webmanifest`) now show the RelyFrame icons. They
are kept only so that existing `branding.json` files do not break, and will be
removed in a future release. Point `links` at your own icons or at
`/relyframe/` instead.
