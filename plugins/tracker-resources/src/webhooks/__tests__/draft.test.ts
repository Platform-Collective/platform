//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { MAX_PROJECT_WEBHOOKS } from '@hcengineering/tracker'

import {
  editWebhookDraft,
  generateWebhookSecret,
  newWebhookDraft,
  toggleDraftEvent,
  validateWebhookDraft,
  webhookData
} from '../draft'

const valid = { ...newWebhookDraft(), url: 'https://hooks.example.com/huly' }

describe('validateWebhookDraft', () => {
  it('accepts a valid draft', () => {
    expect(validateWebhookDraft(valid, 0, true)).toBeUndefined()
  })

  it('reports the url problems', () => {
    expect(validateWebhookDraft({ ...valid, url: '' }, 0, true)).toBe('empty')
    expect(validateWebhookDraft({ ...valid, url: 'nope' }, 0, true)).toBe('invalid')
    expect(validateWebhookDraft({ ...valid, url: 'http://hooks.example.com/' }, 0, true)).toBe('protocol')
    expect(validateWebhookDraft({ ...valid, url: 'https://127.0.0.1/' }, 0, true)).toBe('address')
    expect(validateWebhookDraft({ ...valid, url: 'https://intranet/' }, 0, true)).toBe('host')
  })

  it('needs an event, bounds the secret and the number of webhooks', () => {
    expect(validateWebhookDraft({ ...valid, events: [] }, 0, true)).toBe('noEvents')
    expect(validateWebhookDraft({ ...valid, secret: 'x'.repeat(300) }, 0, true)).toBe('secretTooLong')
    expect(validateWebhookDraft(valid, MAX_PROJECT_WEBHOOKS, true)).toBe('tooMany')
    // An existing webhook can still be edited at the limit
    expect(validateWebhookDraft(valid, MAX_PROJECT_WEBHOOKS, false)).toBeUndefined()
  })
})

describe('webhookData', () => {
  it('trims the url and keeps the known events in order', () => {
    expect(webhookData({ ...valid, url: '  https://x.example.com/a  ', events: ['deleted', 'created'] })).toEqual({
      url: 'https://x.example.com/a',
      enabled: true,
      events: ['created', 'deleted'],
      hasSecret: false
    })
  })

  it('has a secret once one was typed and keeps it otherwise', () => {
    expect(webhookData({ ...valid, secret: 's' }).hasSecret).toBe(true)
    expect(webhookData(valid, { hasSecret: true }).hasSecret).toBe(true)
    expect(webhookData(valid, { hasSecret: false }).hasSecret).toBe(false)
  })

  it('never carries the secret in the doc', () => {
    expect(Object.values(webhookData({ ...valid, secret: 'top-secret' }))).not.toContain('top-secret')
    expect(JSON.stringify(webhookData({ ...valid, secret: 'top-secret' }))).not.toContain('top-secret')
  })
})

describe('drafts', () => {
  it('starts a new draft with every event and an edit draft without a secret', () => {
    expect(newWebhookDraft().events).toEqual(['created', 'edited', 'archived', 'restored', 'deleted'])
    expect(editWebhookDraft({ url: 'https://a/', enabled: false, events: ['deleted'] })).toEqual({
      url: 'https://a/',
      enabled: false,
      events: ['deleted'],
      secret: ''
    })
  })

  it('toggles events', () => {
    expect(toggleDraftEvent(['created'], 'edited', true)).toEqual(['created', 'edited'])
    expect(toggleDraftEvent(['created', 'edited'], 'created', false)).toEqual(['edited'])
    expect(toggleDraftEvent(['created'], 'created', true)).toEqual(['created'])
  })

  it('generates a 64 character hex secret from random bytes', () => {
    const secret = generateWebhookSecret((bytes) => bytes.map((_, i) => i * 8))
    expect(secret).toHaveLength(64)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(secret.slice(0, 6)).toBe('000810')
  })
})
