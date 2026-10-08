// SPDX-License-Identifier: EPL-2.0
import { MeasureMetricsContext } from '@hcengineering/core'
import { createWebhookHandler, verifyGitlabToken, WebhookRouter } from '../webhook'

function fakeRes (): { status: jest.Mock, json: jest.Mock, code?: number } {
  const res: any = {}
  res.status = jest.fn((c: number) => { res.code = c; return res })
  res.json = jest.fn(() => res)
  return res
}

const ctx = new MeasureMetricsContext('test', {})

describe('verifyGitlabToken', () => {
  it('matches only the exact secret', () => {
    expect(verifyGitlabToken('s3cret', 's3cret')).toBe(true)
    expect(verifyGitlabToken('s3cre', 's3cret')).toBe(false)
    expect(verifyGitlabToken(undefined, 's3cret')).toBe(false)
  })
})

describe('createWebhookHandler', () => {
  it('rejects a bad token without dispatching', () => {
    const router = new WebhookRouter()
    const handler = jest.fn(async () => {})
    router.on('Issue Hook', handler)
    const res = fakeRes()
    createWebhookHandler(router, 'secret', ctx)({ header: (n: string) => (n === 'x-gitlab-token' ? 'nope' : 'Issue Hook'), body: {} }, res as any)
    expect(res.code).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('acks 200 and dispatches by X-Gitlab-Event', async () => {
    const router = new WebhookRouter()
    const handler = jest.fn(async () => {})
    router.on('Issue Hook', handler)
    const res = fakeRes()
    const headers: Record<string, string> = { 'x-gitlab-token': 'secret', 'x-gitlab-event': 'Issue Hook' }
    createWebhookHandler(router, 'secret', ctx)({ header: (n: string) => headers[n], body: { a: 1 } }, res as any)
    expect(res.code).toBe(200)
    await new Promise((resolve) => setImmediate(resolve))
    expect(handler).toHaveBeenCalledWith({ a: 1 })
  })

  it('still acks 200 when a handler throws', async () => {
    const router = new WebhookRouter()
    router.on('Note Hook', async () => { throw new Error('boom') })
    const res = fakeRes()
    const headers: Record<string, string> = { 'x-gitlab-token': 'secret', 'x-gitlab-event': 'Note Hook' }
    createWebhookHandler(router, 'secret', ctx)({ header: (n: string) => headers[n], body: {} }, res as any)
    expect(res.code).toBe(200)
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('dispatch reports whether any handler exists', async () => {
    const router = new WebhookRouter()
    expect(await router.dispatch('Unknown Hook', {})).toBe(false)
  })
})
