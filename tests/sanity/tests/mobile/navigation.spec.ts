// SPDX-License-Identifier: EPL-2.0
import { test, expect } from '@playwright/test'
import { activate, MobileBrowserSession, openNavigator, resetOverlays } from './fixtures'
import { NAVIGATOR_GAP_REASON } from './contracts'

// Synthetic pages exercise harness behavior without a deployment, login or fixture writes.
test('navigator waits for the authenticated shell before deciding to open', async ({ page }) => {
  await page.route('http://mobile-harness.invalid/**', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<meta name="viewport" content="width=device-width, initial-scale=1"><script>
        setTimeout(() => {
          document.body.innerHTML = '<button id="app-workbench:string:ShowMenu">Menu</button>' +
            '<main data-id="contentPanel" style="height:40px"></main>' +
            '<nav class="antiPanel-navigator" style="height:40px" hidden></nav>';
          document.querySelector('button').onclick = () => {
            document.querySelector('nav').hidden = false;
            document.querySelector('button').id = 'app-workbench:string:HideMenu';
          };
        }, 250);
      </script>`
    })
  })
  await resetOverlays(page, 'http://mobile-harness.invalid/')
  await openNavigator(page)
  await expect(page.locator('button[id="app-workbench:string:HideMenu"]')).toBeVisible()
})

test('a lost browser session is reported as authentication failure before navigation', async ({ page }) => {
  await page.route('http://mobile-harness.invalid/**', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: '<input name="email"><input name="current-password">' })
  })
  const failure = await resetOverlays(page, 'http://mobile-harness.invalid/').catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).name).toBe('BrowserSessionError')
  expect((failure as Error).message).toContain('account-service cookies')
})

test('only WebKit restores the captured login token and reauthenticates through the UI', async ({
  page,
  browserName
}) => {
  const origin = 'http://mobile-harness.invalid'
  const token = 'synthetic-mobile-session-token'
  let uiLogins = 0
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/cookie') {
      expect(request.method()).toBe('PUT')
      expect((await request.allHeaders()).authorization).toBe(`Bearer ${token}`)
      await route.fulfill({ body: '' })
      return
    }
    if (path === '/select') {
      uiLogins++
      await route.fulfill({
        contentType: 'text/html',
        body: `<div class="workspace" onclick="fetch('/cookie', {method:'PUT', headers:{Authorization:'Bearer ${token}'}})
          .then(() => { history.pushState({}, '', '/workbench/synthetic/tracker');
          document.body.innerHTML = '<button id=app-workbench:string:ShowMenu>Menu</button><main data-id=contentPanel style=height:40px></main>'; })">synthetic</div>`
      })
      return
    }
    // WebKit's intercepted requests omit injected Cookie headers. The mock server
    // uses the context store; the live survey verifies real reload persistence.
    const authenticated = (await page.context().cookies(origin)).some(
      (cookie) => cookie.name === 'account-metadata-Token' && cookie.value === token
    )
    await route.fulfill({
      contentType: 'text/html',
      body:
        path.startsWith('/workbench/') && authenticated
          ? '<button id="app-workbench:string:ShowMenu">Menu</button><main data-id="contentPanel" style="height:40px"></main>'
          : '<input name="email"><input name="current-password"><button onclick="location.href=\'/select\'">Log In</button>'
    })
  })
  const session = new MobileBrowserSession(page, {
    browserName,
    baseURL: origin,
    workspace: 'synthetic',
    user: 'synthetic',
    password: 'synthetic'
  })
  try {
    await session.login()
    expect(session.summary).toEqual({
      logins: 1,
      restores: browserName === 'webkit' ? 1 : 0,
      restoreFailed: 0,
      uiRelogins: 0
    })
    const url = `${origin}/workbench/synthetic/tracker`
    if (browserName === 'webkit') {
      const auth = (await page.context().cookies(origin)).find((cookie) => cookie.name === 'account-metadata-Token')
      expect(auth).toMatchObject({ value: token, httpOnly: true, domain: 'mobile-harness.invalid' })
      await resetOverlays(page, url)
      expect(uiLogins).toBe(1)
      await page.context().clearCookies()
      await resetOverlays(page, url)
      expect(session.summary).toEqual({ logins: 2, restores: 2, restoreFailed: 0, uiRelogins: 1 })
      expect(uiLogins).toBe(2)
      expect(page.url()).toBe(url)
    } else {
      const failure = await resetOverlays(page, url).catch((error: unknown) => error)
      expect((failure as Error).name).toBe('BrowserSessionError')
      expect(uiLogins).toBe(1)
      expect(await page.context().cookies(origin)).toEqual([])
    }
  } finally {
    session.dispose()
  }
})

test('only actual phone navigator interception establishes a known gap', async ({ page }, info) => {
  await page.setContent(`<div class="workbench-container">
    <button id="target" style="position:fixed;left:20px;top:20px;width:80px;height:44px">View</button>
    <nav class="antiPanel-navigator fly" style="position:fixed;inset:0;background:white;z-index:10"></nav>
  </div>`)
  page.setDefaultTimeout(300)
  const touch = info.project.use.hasTouch === true || info.project.use.isMobile === true
  await page.evaluate(() => Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true }))
  const failure = await activate(page, page.locator('#target')).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).name).toBe(touch ? 'NavigatorGapError' : 'TimeoutError')
  if (touch) expect((failure as Error).message).toBe(NAVIGATOR_GAP_REASON)
})

test('phone timeouts without navigator interception remain harness errors', async ({ page }) => {
  await page.setContent(`<button id="target" disabled>View</button>
    <nav class="antiPanel-navigator fly" style="position:fixed;inset:0;background:white;z-index:10"></nav>`)
  page.setDefaultTimeout(300)
  const failure = await activate(page, page.locator('#target')).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).name).toBe('TimeoutError')
})

// Deliberately contradict navigator so WebKit cannot silently downgrade phone actions to clicks.
test('activation follows project input mode even when navigator reports the opposite', async ({ page }, info) => {
  const touch = info.project.use.hasTouch === true || info.project.use.isMobile === true
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><button id="target">View</button>'
  )
  await page.evaluate(
    (reportedPoints) => {
      Object.defineProperty(navigator, 'maxTouchPoints', { value: reportedPoints, configurable: true })
      document.querySelector('button')?.addEventListener('touchstart', () => {
        document.body.dataset.touches = String(Number(document.body.dataset.touches ?? 0) + 1)
      })
      document.querySelector('button')?.addEventListener('click', () => {
        document.body.dataset.activated = 'true'
      })
    },
    touch ? 0 : 5
  )
  await activate(page, page.locator('#target'))
  await expect(page.locator('body')).toHaveAttribute('data-activated', 'true')
  expect(await page.locator('body').getAttribute('data-touches')).toBe(touch ? '1' : null)
})
