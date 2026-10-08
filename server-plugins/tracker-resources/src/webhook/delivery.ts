//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { validateWebhookUrl } from '@hcengineering/tracker'

import { signPayload, SIGNATURE_HEADER } from './sign'
import { WebhookBlockedError, type WebhookTransport } from './transport'

/** Name of the event in the `X-Huly-Event` header. */
export const EVENT_NAME = 'project_item'

/** One delivery to make. */
export interface DeliveryJob {
  webhookId: string
  url: string
  // Signs the delivery; absent: not signed
  secret?: string
  deliveryId: string
  // The exact body to send
  body: string
}

export interface DeliveryOptions {
  transport: WebhookTransport
  // http and private targets (development)
  allowInsecure: boolean
  timeoutMs: number
  // Wait before the second attempt
  retryDelayMs: number
  sleep?: (ms: number) => Promise<void>
}

export interface DeliveryResult {
  ok: boolean
  attempts: number
  status?: number
  // `blocked` (not allowed, not tried), `status` (a refused status) or `network` (no answer)
  failure?: 'blocked' | 'status' | 'network'
}

/** Defaults: a receiver that does not answer within 5 seconds has failed. */
export const DEFAULT_TIMEOUT_MS = 5000
export const DEFAULT_RETRY_DELAY_MS = 1000

const defaultSleep = async (ms: number): Promise<void> => await new Promise((resolve) => setTimeout(resolve, ms))

// A server error or too many requests may pass; any other answer is final
function isRetryableStatus (status: number): boolean {
  return status >= 500 || status === 429
}

/**
 * Makes one delivery: the URL is validated, the body signed, and the request tried twice at most (a second time after a
 * network error, a timeout, a 5xx or a 429; never after another answer and never after a blocked target). It never
 * throws: the outcome is the result.
 */
export async function deliver (job: DeliveryJob, options: DeliveryOptions): Promise<DeliveryResult> {
  const checked = validateWebhookUrl(job.url, { allowInsecure: options.allowInsecure })
  if (checked.ok === false) return { ok: false, attempts: 0, failure: 'blocked' }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Huly-Webhook/1.0',
    'X-Huly-Event': EVENT_NAME,
    'X-Huly-Delivery': job.deliveryId
  }
  if (job.secret !== undefined && job.secret !== '') headers[SIGNATURE_HEADER] = signPayload(job.secret, job.body)

  const sleep = options.sleep ?? defaultSleep
  let last: DeliveryResult = { ok: false, attempts: 0, failure: 'network' }
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) await sleep(options.retryDelayMs)
    try {
      const res = await options.transport({ url: checked.url, headers, body: job.body, timeoutMs: options.timeoutMs })
      if (res.status >= 200 && res.status < 300) return { ok: true, attempts: attempt, status: res.status }
      last = { ok: false, attempts: attempt, status: res.status, failure: 'status' }
      if (!isRetryableStatus(res.status)) return last
    } catch (err: any) {
      if (err instanceof WebhookBlockedError) return { ok: false, attempts: attempt, failure: 'blocked' }
      last = { ok: false, attempts: attempt, failure: 'network' }
    }
  }
  return last
}

/**
 * Runs deliveries with a bounded number at a time. A failing delivery does not stop the others.
 */
export async function runDeliveries (
  jobs: readonly DeliveryJob[],
  options: DeliveryOptions,
  concurrency = 5
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = new Array(jobs.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const index = next++
      results[index] = await deliver(jobs[index], options)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => await worker()))
  return results
}
