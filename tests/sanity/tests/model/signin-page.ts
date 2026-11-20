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

import { expect, type Locator, type Page } from '@playwright/test'
import { CommonPage } from './common-page'
import { SignUpData } from './common-types'

export class SignInJoinPage extends CommonPage {
  readonly page: Page

  constructor (page: Page) {
    super(page)
    this.page = page
  }

  inputEmail = (): Locator => this.page.locator('input[name="email"]')
  inputFirstName = (): Locator => this.page.locator('input[name="given-name"]')
  inputLastName = (): Locator => this.page.locator('input[name="family-name"]')
  inputPassword = (): Locator => this.page.locator('//div[text()="Password"]/../input')
  inputRepeatPassword = (): Locator => this.page.locator('//div[text()="Repeat password"]/../input')
  buttonSubmit = (): Locator => this.page.locator('button[data-id="join-form-submit"]')
  buttonToggle = (): Locator => this.page.locator('button[data-id="join-form-toggle"]')
  buttonJoinWithThisAccount = (): Locator => this.page.locator('button[data-id="join-with-this-account"]')
  buttonUseDifferentAccount = (): Locator => this.page.locator('button[data-id="join-use-different-account"]')

  async join (data: Pick<SignUpData, 'email' | 'password'>): Promise<void> {
    await Promise.race([
      this.buttonSubmit().waitFor({ state: 'visible', timeout: 10000 }),
      this.buttonJoinWithThisAccount().waitFor({ state: 'visible', timeout: 10000 })
    ])

    const submitBtn = this.buttonSubmit()
    const toggleBtn = this.buttonToggle()
    const joinWithAccountBtn = this.buttonJoinWithThisAccount()

    if (await joinWithAccountBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.buttonUseDifferentAccount().click()
      await this.inputEmail().waitFor({ state: 'visible', timeout: 5000 })
    }

    const submitText = await submitBtn.textContent().catch(() => '')
    if (submitText != null && submitText.toLowerCase().includes('sign up')) {
      await toggleBtn.click()
      await this.inputEmail().waitFor({ state: 'visible', timeout: 5000 })
    }
    await this.inputEmail().fill(data.email)
    await this.inputPassword().fill(data.password)
    await expect(this.buttonSubmit()).toBeEnabled()
    await this.buttonSubmit().click()
  }

  async signUpAndJoin (data: SignUpData): Promise<void> {
    await this.buttonSubmit().waitFor({ state: 'visible', timeout: 10000 })
    const submitText = await this.buttonSubmit().textContent()
    if (submitText?.toLowerCase().includes('sign up') !== true) {
      await this.buttonToggle().click()
    }

    await this.inputFirstName().fill(data.firstName)
    await this.inputLastName().fill(data.lastName)
    await this.inputEmail().fill(data.email)
    await this.inputPassword().fill(data.password)
    await this.inputRepeatPassword().fill(data.password)
    await expect(this.buttonSubmit()).toBeEnabled()
    await this.buttonSubmit().click()
  }
}
