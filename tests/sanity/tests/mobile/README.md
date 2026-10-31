# Mobile acceptance tests

Five Playwright projects cover Chromium, Firefox, WebKit, iPhone 15 and Pixel 7.
Phone projects use touch input in portrait and landscape; desktop projects use mouse input.
The survey checks List and Board views, opening and canceling Create, and separate
description and comment editors. It does not submit text edits or attachments.
Synthetic navigation tests also cover readiness, session handling and input selection.

`MobileStepResult.outcome` is `ui` (UI assertions passed), `url-recovery` (a direct URL
recovered the diagnostic check), or `not-tested` (the UI path did not complete).
Recovery never counts as acceptance; confirmed phone gaps represent missing coverage.
Fixtures are created and read back via API, then deleted with their generated descendants;
cleanup is verified independently. Use a dedicated synthetic workspace and account with
an existing sanity Issue and project to supply fixture model settings.

The default sanity config (`tests/playwright.config.ts`) excludes `mobile/**`.
Run these tests only via `tests/mobile-pwa.config.ts`, after installing sanity dependencies
and Playwright browsers and starting the application.

## Environment variables

- `MOBILE_PWA_BASE_URL`: Required application URL for browser navigation and API access.
- `PLATFORM_WS`: Required dedicated synthetic workspace name used for login and API access.
- `PLATFORM_USER`: Required synthetic account email used for browser and API login.
- `MOBILE_PWA_PASSWORD`: Required password for the synthetic account.
- `MOBILE_PWA_OUTPUT`: Optional Playwright output directory for test artifacts.
- `MOBILE_PWA_REPORT`: Optional JSON reporter output file; unset writes to standard output.
- `MOBILE_PWA_ADAPTER`: Optional `legacy` mode reproduces the old viewlet lookup; leave unset for acceptance.
- `MOBILE_PWA_TARGET`: Optional target label recorded in test results.
- `PC_DEVELOP_COMMIT`: Optional baseline revision recorded in test results, without verification.
- `MOBILE_PWA_COMMIT`: Optional candidate revision recorded in test results, without verification.

## Example

```bash
export MOBILE_PWA_BASE_URL='https://app.example.test' \
  PLATFORM_WS='<synthetic-workspace>' PLATFORM_USER='<synthetic-account-email>' \
  MOBILE_PWA_PASSWORD='<synthetic-account-password>'
cd tests/sanity && npx playwright test -c tests/mobile-pwa.config.ts
```
