//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Data } from '@hcengineering/core'
import {
  MAX_PROJECT_WEBHOOKS,
  MAX_WEBHOOK_SECRET_LENGTH,
  normalizeWebhookEvents,
  validateWebhookUrl,
  WEBHOOK_EVENTS,
  type ProjectWebhook,
  type WebhookEvent,
  type WebhookUrlError
} from '@hcengineering/tracker'

/**
 * What the webhook form holds.
 */
export interface WebhookDraft {
  url: string
  enabled: boolean
  events: WebhookEvent[]
  // New secret; empty keeps the current one (the current one is never shown)
  secret: string
}

export type WebhookDraftError = WebhookUrlError | 'noEvents' | 'secretTooLong' | 'tooMany'

/**
 * The first problem of a draft, or undefined when it can be saved. The URL is checked with the same rules as the server
 * (https only, no credentials, no internal host or address); the server resolves names again at delivery.
 */
export function validateWebhookDraft (
  draft: WebhookDraft,
  existingCount: number,
  isNew: boolean
): WebhookDraftError | undefined {
  if (isNew && existingCount >= MAX_PROJECT_WEBHOOKS) return 'tooMany'
  const url = validateWebhookUrl(draft.url)
  if (url.ok === false) return url.error
  if (normalizeWebhookEvents(draft.events).length === 0) return 'noEvents'
  if (draft.secret.length > MAX_WEBHOOK_SECRET_LENGTH) return 'secretTooLong'
  return undefined
}

/**
 * The fields of the webhook doc for a draft. `hasSecret` becomes true once a secret was typed, and stays as it was
 * otherwise.
 */
export function webhookData (draft: WebhookDraft, current?: Pick<ProjectWebhook, 'hasSecret'>): Data<ProjectWebhook> {
  return {
    url: draft.url.trim(),
    enabled: draft.enabled,
    events: normalizeWebhookEvents(draft.events),
    hasSecret: draft.secret !== '' || current?.hasSecret === true
  }
}

/** A draft for a new webhook: all events, enabled. */
export function newWebhookDraft (): WebhookDraft {
  return { url: '', enabled: true, events: [...WEBHOOK_EVENTS], secret: '' }
}

/** A draft that edits a webhook; the secret starts empty. */
export function editWebhookDraft (webhook: Pick<ProjectWebhook, 'url' | 'enabled' | 'events'>): WebhookDraft {
  return { url: webhook.url, enabled: webhook.enabled, events: normalizeWebhookEvents(webhook.events), secret: '' }
}

/** Toggles one event of a draft. */
export function toggleDraftEvent (events: readonly WebhookEvent[], event: WebhookEvent, on: boolean): WebhookEvent[] {
  return normalizeWebhookEvents(on ? [...events, event] : events.filter((e) => e !== event))
}

/**
 * A random secret: 32 random bytes as hex. `random` fills a byte array (the platform's `crypto.getRandomValues`).
 */
export function generateWebhookSecret (random: (bytes: Uint8Array) => Uint8Array): string {
  return Array.from(random(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
}
