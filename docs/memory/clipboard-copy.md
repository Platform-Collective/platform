# Clipboard copy pitfalls

Two failure classes, both end as `NotAllowedError` from `navigator.clipboard.write`:

1. **Unsupported MIME in ClipboardItem.** Browsers accept only `text/plain`, `text/html`, `image/png`.
   `text/markdown` and custom types (`application/x-platform-table-metadata`) always throw.
   Markdown is copied as `text/plain`; table metadata is embedded as an HTML comment
   `<!-- platform-table-metadata:{...} -->` in the text (parsed by text editors on paste).

2. **Await before write loses user gesture (Safari).** `clipboard.write` must run within the
   user-gesture activation. Fix: create `ClipboardItem` synchronously and pass a *Promise* of
   the text into it (WebKit-sanctioned pattern, see webkit.org/blog/10855). Both
   `copyText` (view-resources/src/actionImpl.ts) and `copyTextToClipboard`
   (packages/presentation/src/utils.ts) accept `string | Promise<string>` - callers doing async
   work (getResource, getMarkup, network fetch) must pass the promise, NOT await first.

Fixed (2026-06-11): `CopyTextToClipboard`, `CopyContentAction`, `copyMarkdown` in actionImpl.ts;
`copyGuestLink` in love-resources/src/utils.ts.

Known residual risks:
- converter-resources/src/markdown/copyActions.ts: table markdown built (awaited) before
  `copyMarkdown` - OK while builds are fast (in-memory), risky if they start hitting network
- calendar-resources ScheduleNavSection.svelte:100: copy inside MessageBox confirm `action`
  callback - gesture from original click is gone; needs UX change (direct copy button)
