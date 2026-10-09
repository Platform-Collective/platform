// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import { MeasureMetricsContext } from '@hcengineering/core'
import { hookSecret } from '../hooks'
import { createWebhookHandler, type HookSecretResolver, scopedResolver, verifyGitlabToken, WebhookRouter } from '../webhook'

const fixedSecret = (secret: string): HookSecretResolver => () => ({ secret })

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
    createWebhookHandler(router, fixedSecret('secret'), ctx)({ header: (n: string) => (n === 'x-gitlab-token' ? 'nope' : 'Issue Hook'), body: {} }, res as any)
    expect(res.code).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('acks 200 and dispatches by X-Gitlab-Event', async () => {
    const router = new WebhookRouter()
    const handler = jest.fn(async () => {})
    router.on('Issue Hook', handler)
    const res = fakeRes()
    const headers: Record<string, string> = { 'x-gitlab-token': 'secret', 'x-gitlab-event': 'Issue Hook' }
    createWebhookHandler(router, fixedSecret('secret'), ctx)({ header: (n: string) => headers[n], body: { a: 1 } }, res as any)
    expect(res.code).toBe(200)
    await new Promise((resolve) => setImmediate(resolve))
    expect(handler).toHaveBeenCalledWith({ a: 1 }, undefined)
  })

  it('still acks 200 when a handler throws', async () => {
    const router = new WebhookRouter()
    router.on('Note Hook', async () => { throw new Error('boom') })
    const res = fakeRes()
    const headers: Record<string, string> = { 'x-gitlab-token': 'secret', 'x-gitlab-event': 'Note Hook' }
    createWebhookHandler(router, fixedSecret('secret'), ctx)({ header: (n: string) => headers[n], body: {} }, res as any)
    expect(res.code).toBe(200)
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('dispatch reports whether any handler exists', async () => {
    const router = new WebhookRouter()
    expect(await router.dispatch('Unknown Hook', {})).toBe(false)
  })
})

describe('scoped webhooks', () => {
  const target = { workspace: 'ws-1', integration: 'int-1' }

  function call (token: string, params: Record<string, string>): { res: any, handler: jest.Mock } {
    const router = new WebhookRouter()
    const handler = jest.fn(async () => {})
    router.on('Issue Hook', handler)
    const res = fakeRes()
    const headers: Record<string, string> = { 'x-gitlab-token': token, 'x-gitlab-event': 'Issue Hook' }
    createWebhookHandler(router, scopedResolver('master'), ctx)({ header: (n: string) => headers[n], body: { a: 1 }, params }, res)
    return { res, handler }
  }

  it('accepts the integration\'s derived secret and passes its target on', async () => {
    const { res, handler } = call(hookSecret('master', target as any), target)
    expect(res.code).toBe(200)
    await new Promise((resolve) => setImmediate(resolve))
    expect(handler).toHaveBeenCalledWith({ a: 1 }, target)
  })

  it('rejects the shared master secret on a scoped URL', () => {
    const { res, handler } = call('master', target)
    expect(res.code).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects another integration\'s secret', () => {
    const { res } = call(hookSecret('master', { workspace: 'ws-1', integration: 'int-2' } as any), target)
    expect(res.code).toBe(401)
  })

  it('rejects a URL without a target', () => {
    const { res } = call(hookSecret('master', target as any), {})
    expect(res.code).toBe(401)
  })
})
