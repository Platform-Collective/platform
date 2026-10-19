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

import { expect, type APIRequestContext } from '@playwright/test'

interface MailpitMessage {
  ID: string
  Subject: string
  Created: string
}

interface MailpitSearchResult {
  messages: MailpitMessage[] | null
}

interface MailpitMessageContent {
  HTML?: string
  Text?: string
}

/**
 * Minimal client for the Mailpit REST API used to read emails sent by the mail service.
 */
export class Mailpit {
  constructor (
    private readonly request: APIRequestContext,
    private readonly baseUrl: string
  ) {}

  async listMessages (to: string): Promise<MailpitMessage[]> {
    const response = await this.request.get(`${this.baseUrl}/api/v1/search`, {
      params: { query: `to:"${to}"`, limit: 50 }
    })
    expect(response.ok(), `Mailpit search failed: ${response.status()}`).toBe(true)
    const result = (await response.json()) as MailpitSearchResult
    return result.messages ?? []
  }

  async messageIds (to: string): Promise<Set<string>> {
    return new Set((await this.listMessages(to)).map((m) => m.ID))
  }

  async readMessage (id: string): Promise<MailpitMessageContent> {
    const response = await this.request.get(`${this.baseUrl}/api/v1/message/${id}`)
    expect(response.ok(), `Mailpit message request failed: ${response.status()}`).toBe(true)
    return (await response.json()) as MailpitMessageContent
  }

  /**
   * Waits for a new email (not in `knownIds`) addressed to `to` and returns the
   * 6-digit OTP code from its subject ("<app> confirmation code: 123456").
   */
  async waitForOtpCode (to: string, knownIds = new Set<string>()): Promise<string> {
    let code: string | undefined
    await expect
      .poll(
        async () => {
          const fresh = (await this.listMessages(to)).filter((m) => !knownIds.has(m.ID))
          code = fresh.map((m) => /\b(\d{6})\b/.exec(m.Subject)?.[1]).find((c) => c !== undefined)
          return code
        },
        { message: `OTP email for ${to} was not received`, timeout: 30_000, intervals: [500, 1000, 2000] }
      )
      .toBeDefined()
    return code as string
  }

  /**
   * Waits for a new account-confirmation email and returns its confirmation URL.
   */
  async waitForConfirmationLink (to: string, knownIds = new Set<string>()): Promise<string> {
    let link: string | undefined
    await expect
      .poll(
        async () => {
          const fresh = (await this.listMessages(to)).filter((m) => !knownIds.has(m.ID))
          const messages = await Promise.all(fresh.map(async (message) => await this.readMessage(message.ID)))
          link = messages
            .map((message) => `${message.HTML ?? ''}\n${message.Text ?? ''}`)
            .map((content) => /https?:\/\/[^\s"'<>]+\/login\/confirm\?id=[^\s"'<>]+/.exec(content)?.[0])
            .find((url) => url !== undefined)
          return link
        },
        { message: `Confirmation email for ${to} was not received`, timeout: 30_000, intervals: [500, 1000, 2000] }
      )
      .toBeDefined()
    return link as string
  }
}
