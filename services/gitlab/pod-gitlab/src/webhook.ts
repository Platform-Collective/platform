// SPDX-License-Identifier: EPL-2.0

import type { MeasureContext } from '@hcengineering/core'
import { timingSafeEqual } from 'crypto'
import { hookSecret, hookTargetOf, type HookTarget } from './hooks'

export type WebhookHandler = (payload: unknown, target?: HookTarget) => Promise<void>

export interface WebhookRequest {
  header: (name: string) => string | undefined
  body: unknown
  // Route parameters of a scoped hook URL (workspace, integration)
  params?: Record<string, string | undefined>
}

/** The secret a request must carry and the integration it is scoped to; undefined rejects the request. */
export type HookSecretResolver = (req: WebhookRequest) => { secret: string, target?: HookTarget } | undefined

/** Scoped hooks: the secret is derived from the master secret and the URL's workspace and integration. */
export function scopedResolver (master: string): HookSecretResolver {
  return (req) => {
    const target = hookTargetOf(req.params ?? {})
    return target === undefined ? undefined : { secret: hookSecret(master, target), target }
  }
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

  async dispatch (event: string, payload: unknown, target?: HookTarget): Promise<boolean> {
    const handlers = this.handlers.get(event) ?? []
    for (const handler of handlers) {
      await handler(payload, target)
    }
    return handlers.length > 0
  }
}

export function createWebhookHandler (
  router: WebhookRouter,
  resolve: HookSecretResolver,
  ctx: MeasureContext
): (req: WebhookRequest, res: WebhookResponse) => void {
  return (req, res) => {
    const expected = resolve(req)
    if (expected === undefined || !verifyGitlabToken(req.header('x-gitlab-token'), expected.secret)) {
      res.status(401).json({ error: 'invalid token' })
      return
    }
    const event = req.header('x-gitlab-event') ?? ''
    // Acknowledge immediately: GitLab disables hooks that time out or keep failing.
    res.status(200).json({})
    router.dispatch(event, req.body, expected.target).catch((err: Error) => {
      ctx.error('gitlab webhook handler failed', { event, error: err.message })
    })
  }
}
