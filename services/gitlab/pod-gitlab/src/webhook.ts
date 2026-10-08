// SPDX-License-Identifier: EPL-2.0

import type { MeasureContext } from '@hcengineering/core'
import { timingSafeEqual } from 'crypto'

export type WebhookHandler = (payload: unknown) => Promise<void>

export interface WebhookRequest {
  header: (name: string) => string | undefined
  body: unknown
}

export interface WebhookResponse {
  status: (code: number) => WebhookResponse
  json: (body: unknown) => WebhookResponse
}

export function verifyGitlabToken (received: string | undefined, expected: string): boolean {
  if (received === undefined) {
    return false
  }
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Routes GitLab webhook payloads by the X-Gitlab-Event header value (e.g. "Issue Hook").
 */
export class WebhookRouter {
  private readonly handlers = new Map<string, WebhookHandler[]>()

  on (event: string, handler: WebhookHandler): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
  }

  async dispatch (event: string, payload: unknown): Promise<boolean> {
    const handlers = this.handlers.get(event) ?? []
    for (const handler of handlers) {
      await handler(payload)
    }
    return handlers.length > 0
  }
}

export function createWebhookHandler (
  router: WebhookRouter,
  secret: string,
  ctx: MeasureContext
): (req: WebhookRequest, res: WebhookResponse) => void {
  return (req, res) => {
    if (!verifyGitlabToken(req.header('x-gitlab-token'), secret)) {
      res.status(401).json({ error: 'invalid token' })
      return
    }
    const event = req.header('x-gitlab-event') ?? ''
    // Acknowledge immediately: GitLab disables hooks that time out or keep failing.
    res.status(200).json({})
    router.dispatch(event, req.body).catch((err: Error) => {
      ctx.error('gitlab webhook handler failed', { event, error: err.message })
    })
  }
}
