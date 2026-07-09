# Platform Mobile App (Capacitor)

iOS and Android app that wraps the Platform web frontend using [Capacitor](https://capacitorjs.com/). The same Svelte app built by `dev/prod` is copied into `www/` and loaded by the native shell.

## Prerequisites

- Node.js and Rush (see root [README](../README.md))
- **iOS**: macOS with Xcode
- **Android**: [Android Studio](https://developer.android.com/studio)

## Quick start

From the repo root:

1. Build the web app: `rush build --to @hcengineering/prod`
2. `cd mobile`
3. `npm run sync` (copies web assets to `www/` and runs `cap sync`)
4. `npm run open:ios` or `npm run open:android` to open the native IDE

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build:web` | Copy `dev/prod/dist` and `dev/prod/public` into `mobile/www`. Run after building the web app. |
| `npm run sync` | Run `build:web` then `cap sync` (updates native projects with `www` content). |
| `npm run open:ios` | Open the iOS project in Xcode. |
| `npm run open:android` | Open the Android project in Android Studio. |
| `npm run run:ios` | Run on iOS simulator/device. |
| `npm run run:android` | Run on Android emulator/device. |

## Configuration

- **capacitor.config.ts**: `appId` is `io.huly.platform`; `appName` is `Huly`. Change these if you need a different bundle ID or display name.
- **Local-first load**: The app loads from the bundled `www/` directory (no `server.url`), so it opens without requiring a connection to any server. The login page and shell are served from local resources.
- **Backend URL**: The web app reads `/config.json` from the bundle. The copy script uses `dev/prod/public/config-mobile.json` as `www/config.json` when present (full backend URLs); otherwise it copies `config.json`. Set the `MOBILE_CONFIG` environment variable to pick a different file from `dev/prod/public` (e.g. `MOBILE_CONFIG=config-mobile-huly.json npm run sync` for the huly.app cloud backend — this is what CI uses). On Android emulator, replace `localhost` with `10.0.2.2` in `config-mobile.json` if the app cannot reach the backend.
- **Server unavailable**: When the user tries to use backend features (e.g. login) and the server is unreachable, the app shows a “Server unavailable” message in the login (or relevant) UI. To use the webpack dev server for live reload, temporarily add `server: { url: 'http://localhost:8080', cleartext: true }` to `capacitor.config.ts` and run `npx cap sync`.

## Native Shell Architecture

The mobile app implements a native shell that handles error states when the server is unavailable:

### Error Handling

- **Android**: `MainActivity.java` includes a custom `WebViewClient` that intercepts WebView load errors (connection refused, timeout, no network) and displays a native error screen with a Retry button.
- **iOS**: `CustomBridgeViewController.swift` implements `WKNavigationDelegate` to intercept navigation errors and show a native error overlay.

### Network Monitoring

Both platforms monitor network connectivity:
- When network is lost, the native shell shows an error screen
- When network is restored, the error message updates to indicate retry is available
- The `@capacitor/network` plugin provides JavaScript-level network status if needed

### Splash Screen

The `@capacitor/splash-screen` plugin is configured with manual control (`launchAutoHide: false`). The native shell keeps the splash screen visible until the WebView successfully loads, providing a smooth transition.

### Error Screen

When the server is unavailable:
1. Native error screen appears with app branding
2. User sees "Connection Error" message with description
3. "Retry" button reloads the WebView
4. On success, error screen hides and web app is displayed

## Permissions and downloads

- **Android**: camera, microphone and notification permissions are declared in `AndroidManifest.xml`; Capacitor's built-in `BridgeWebChromeClient` prompts for camera/mic at runtime when the web app calls `getUserMedia` (calls, voice messages, photo capture). Notification permission (Android 13+) is requested once on first launch (`requestNotificationPermissionIfNeeded` in `MainActivity.java`). Attachment downloads from the WebView are routed to the system `DownloadManager` (see `setupDownloadListener`) and land in the public Downloads folder. `blob:` URLs are not supported by DownloadManager and are currently ignored.
- **iOS**: usage descriptions for camera, microphone and photo library are set in `Info.plist` (required — iOS kills the app on access without them). Capacitor's `WebViewDelegationHandler` auto-grants WKWebView media-capture requests; the one-time system permission dialogs are driven by the usage descriptions.
- **Known gap**: OAuth logins (GitHub/Google) do not complete inside the WebView — the provider redirects back to the web origin, not the app. Email/password login works. Fixing this requires opening OAuth in the system browser plus a deep-link return (planned).

## Icons and splash

App and splash icons use the Huly branding from [dev/prod/public/huly/](../dev/prod/public/huly/) (same source as the web app: `icon-1024.png`, etc.). To refresh mobile icons after updating Huly assets, copy `dev/prod/public/huly/icon-1024.png` to:

- **Android**: `android/app/src/main/res/mipmap-*/ic_launcher.png`, `ic_launcher_foreground.png`, `ic_launcher_round.png`, and `drawable*/splash.png`.
- **iOS**: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` and `Splash.imageset/splash-2732x2732*.png`.

## Web assets

The `www/` directory is generated by `npm run build:web` and is ignored by git. Always run `npm run sync` after building the web app or changing public assets so the native projects have the latest content.

## CI builds

The `Mobile` workflow (`.github/workflows/mobile.yml`) builds an Android debug APK and uploads it as the `huly-android-debug-apk` artifact. It runs on pushes/PRs touching `mobile/`, and can be started manually (Actions → Mobile → Run workflow) with an optional `config` input selecting which `dev/prod/public/config-*.json` to bundle (default `config-mobile-huly.json`, pointing to the huly.app cloud backend).

Debug builds are signed with the stable keystore committed at `android/app/debug.keystore` (standard debug credentials, not a secret), so any debug APK — from CI or a local machine — installs over a previously installed one without uninstalling. `versionCode`/`versionName` can be overridden via the `MOBILE_VERSION_CODE`/`MOBILE_VERSION_NAME` environment variables; CI sets them from the workflow run number.

iOS is not built in CI yet: an installable artifact requires a macOS runner plus an Apple Developer certificate and provisioning profile.

## Adding platforms (first-time setup)

If the `ios/` or `android/` folders are missing (e.g. after a fresh clone), run once from `mobile/`:

```bash
npm run add:ios
npm run add:android
```

Then run `npm run sync` before opening the native projects.
