# DOCX preview

Drive can preview DOCX files with their page layout by converting a copy to PDF
through Gotenberg / LibreOffice. The existing Huly PDF viewer displays the result;
the original DOCX stays available for download and is never overwritten.

## Enable

Deploy the updated Print service and frontend together. Retain the Print service's
existing `SECRET`, `ACCOUNTS_URL`, `FRONT_URL`, and storage configuration. Set the
frontend's `PRINT_URL` to its authenticated Print HTTP endpoint. If the deployment
does not already have Print, provision it first; enabling Gotenberg alone does not
make Drive previews available.

Merge `compose.docx-preview.yml` into a Compose deployment whose Print service is
named `print`. Adapt the existing application network name if it is not `default`.
The example adds `GOTENBERG_URL=http://gotenberg:3000`. Gotenberg has no published
port and only joins an internal network shared with Print. Do not expose its API
to browsers or the Internet. The endpoint must be an administrator-controlled URL.

The example pins Gotenberg 8.37.0, disables URL downloads, webhooks, Chromium
routes and external document references, and uses the engine's default disabled
macro execution. It limits the converter to one CPU, 1 GiB RAM and 512 MiB of
temporary storage. LibreOffice shuts down after 30 seconds idle. Large or complex
documents may fail within these limits; users can retry or download the original.

## Behavior and compatibility

- Only `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  is registered and accepted. Legacy `.doc` is deliberately out of scope.
- The new client requests `GET /convert/:file?format=preview`, authenticated as
  before. The response is `{ id, contentType }`, with `application/pdf` when the
  converter is configured, otherwise `text/html`.
- Requests with no format and `format=html` retain the existing HTML behavior.
  Explicit `format=pdf` returns 503 if no converter is configured. A new client
  accepts a legacy server response without `contentType` as HTML.
- PDF cache IDs include source blob ID, ETag and `pdf-v1`; HTML cache IDs stay
  unchanged. Cached data lives in the same workspace storage as the source.
  Source changes trigger new previews. Old derived blobs follow the deployment's
  existing storage retention policy; this change does not add automatic cleanup.
- Each Print process runs one PDF conversion and queues at most four more PDF jobs.
  Requests for the same workspace/source version share a job. Queue overflow
  returns 503. Each PDF conversion has a 60 second deadline; waiting for queued
  jobs adds to that time. PDF conversion input is limited to 25 MiB and output to
  50 MiB. HTML conversion runs independently of this queue and retains its existing
  behavior without the PDF input limit.
- Conversion failure shows retry and original download controls. Navigating away
  cancels the browser request; a conversion already running may finish and cache
  its result for the next viewer.

LibreOffice preserves pages, tables, embedded images, headers and footers, but
does not guarantee pixel-identical Microsoft Word rendering. Gotenberg includes
Noto CJK, Carlito, Caladea and Liberation fonts. Missing corporate fonts can change
line wrapping and pagination; add properly licensed fonts to a derived converter
image when fidelity requires them. Changing fonts or the conversion engine does
not invalidate existing cached PDFs; bump the PDF cache revision when rolling out
a rendering change that should regenerate them.

Supporting `.doc` later is a small integration extension because LibreOffice
already reads it: register and validate its MIME type, send the appropriate
filename, and add legacy-document fixtures. Font and layout compatibility still
need testing. Password-protected, corrupt or unsupported documents currently show
the failure state rather than requesting a password.

## Validation

Focused Jest tests cover conversion limits, timeouts, output validation, queue
coalescing, authentication, cache separation, source versions and legacy HTML,
including large HTML sources and HTML conversion while a PDF job is stalled.
Client tests cover result negotiation and request errors. No full project build
is required for these targeted checks.

Before deployment, manually test Drive with a DOCX containing Chinese and English
text, explicit and automatic page breaks, tables, an image and page numbers. Check
the original download, reopening a cached preview, changing file versions,
switching documents while loading, and retry after a converter failure. Test with
the deployment's actual fonts and browser PDF settings; browsers configured to
download PDFs instead of displaying them may not provide inline preview.

## Print URL configuration

`FRONT_URL` is always trusted at its exact scheme, host and port. Configure extra
printing domains in `ALLOWED_HOSTNAMES`, separated by commas. Bare hosts and
`*.example.com` allow default HTTP/HTTPS ports; use `host:port` or
`[IPv6-address]:port` for other ports. A wildcard matches subdomains only.
Malformed entries fail startup. These entries are operator-controlled trust
exceptions, including for private network destinations on the configured port.

Backend services used by the front end must also be listed when their origins
resolve to private addresses. This includes `ACCOUNTS_URL`, `FILES_URL`,
`UPLOAD_URL`, `PREVIEW_URL`, `COLLABORATOR_URL`, and any other backend origins
used by the page. Trusting `FRONT_URL` does not trust another port on that host.
Use exact scheme/host/port origins to keep these exceptions narrow. This applies
to split-horizon DNS and internal Kubernetes service names too. The development
Compose file explicitly lists the backend origins from its front-end configuration;
update that list when adding or moving a service. The Print service does not
automatically trust origins discovered in page content or `config.json`.

Navigation, redirects and frames must match that policy. Other HTTP(S) resources
are checked with safe-fetch before Chromium loads them; DNS results are cached
per render, and any private or reserved result blocks the host. Inline `data:`
and `blob:` resources remain available.

Chromium resolves DNS independently, so these checks do not pin its connection
addresses and cannot eliminate DNS rebinding. Use an egress policy or a checking
proxy to enforce destination restrictions at connection time. Puppeteer request
interception does not cover WebSocket connections; this filtering is not a
network sandbox for executable page content. Interception performance with warm
browser caches still needs a browser measurement.
