/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { type Locator, type Page } from '@playwright/test'

export class OtpPage {
  readonly page: Page

  constructor (page: Page) {
    this.page = page
  }

  codeInput = (index: number): Locator => this.page.locator(`input[name="otp${index}"]`)
  sentTo = (email: string): Locator => this.page.locator('.email', { hasText: email })

  async waitForForm (email: string): Promise<void> {
    await this.sentTo(email).waitFor({ state: 'visible' })
  }

  async enterCode (code: string): Promise<void> {
    // The form moves focus to the next cell and submits after the last digit
    for (let i = 0; i < code.length; i++) {
      await this.codeInput(i + 1).fill(code[i])
    }
  }
}
