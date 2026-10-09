//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { expect, test, type Page } from '@playwright/test'
import { Mailpit } from './model/mailpit'
import { OtpPage } from './model/otp-page'
import { LoginPage } from './model/login-page'
import { SignUpPage } from './model/signup-page'
import { SelectWorkspacePage } from './model/select-workspace-page'
import { MailpitURL, PlatformOtpURI } from './utils'

// Runs against the OTP contour (front-otp + account-otp + mail + mailpit) from tests/docker-compose.yaml
test.describe('OTP login', () => {
  test.skip(
    PlatformOtpURI === undefined || PlatformOtpURI === '' || MailpitURL === undefined || MailpitURL === '',
    'PLATFORM_OTP_URI and MAILPIT_URL must be set'
  )

  async function expectLoggedInWithoutWorkspace (page: Page): Promise<void> {
    // A freshly registered user has no workspaces yet
    await expect(new SelectWorkspacePage(page).buttonCreateWorkspace()).toBeVisible()
  }

  test('sign up and log in with an email code', async ({ page, browser, request }) => {
    const mailpit = new Mailpit(request, MailpitURL as string)
    const email = `otp-${Date.now()}-${Math.floor(Math.random() * 1e6)}@tracex.local`

    await test.step('sign up with OTP', async () => {
      const known = await mailpit.messageIds(email)
      await (await page.goto(`${PlatformOtpURI}/login/signup`))?.finished()

      const signUpPage = new SignUpPage(page)
      await signUpPage.enterFirstName('Otp')
      await signUpPage.enterLastName('Tester')
      await signUpPage.enterEmail(email)
      await signUpPage.clickSignUp()

      const otpPage = new OtpPage(page)
      await otpPage.waitForForm(email)
      await otpPage.enterCode(await mailpit.waitForOtpCode(email, known))
      await expectLoggedInWithoutWorkspace(page)
    })

    await test.step('log in with OTP in a fresh session', async () => {
      const context = await browser.newContext()
      try {
        const loginPageTab = await context.newPage()
        const known = await mailpit.messageIds(email)
        await (await loginPageTab.goto(`${PlatformOtpURI}/login/login`))?.finished()

        const loginPage = new LoginPage(loginPageTab)
        await loginPage.inputEmail().fill(email)
        await loginPage.buttonLogin().click()

        const otpPage = new OtpPage(loginPageTab)
        await otpPage.waitForForm(email)
        await otpPage.enterCode(await mailpit.waitForOtpCode(email, known))
        await expectLoggedInWithoutWorkspace(loginPageTab)
      } finally {
        await context.close()
      }
    })
  })

  test('wrong code is rejected', async ({ page, request }) => {
    const mailpit = new Mailpit(request, MailpitURL as string)
    const email = `otp-wrong-${Date.now()}-${Math.floor(Math.random() * 1e6)}@tracex.local`

    const known = await mailpit.messageIds(email)
    await (await page.goto(`${PlatformOtpURI}/login/signup`))?.finished()
    const signUpPage = new SignUpPage(page)
    await signUpPage.enterFirstName('Otp')
    await signUpPage.enterLastName('Wrong')
    await signUpPage.enterEmail(email)
    await signUpPage.clickSignUp()

    const otpPage = new OtpPage(page)
    await otpPage.waitForForm(email)
    const code = await mailpit.waitForOtpCode(email, known)
    const wrong = code === '000000' ? '111111' : '000000'
    await otpPage.enterCode(wrong)

    await expect(page.getByText('Invalid code')).toBeVisible()
    await expect(new SelectWorkspacePage(page).buttonCreateWorkspace()).toBeHidden()
  })
})
