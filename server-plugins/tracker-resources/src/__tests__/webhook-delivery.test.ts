//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { deliver, runDeliveries, type DeliveryJob, type DeliveryOptions } from '../webhook/delivery'
import { signPayload } from '../webhook/sign'
import { createSafeLookup, WebhookBlockedError, type WebhookRequest } from '../webhook/transport'

const job = (props: Partial<DeliveryJob> = {}): DeliveryJob => ({
  webhookId: 'w1',
  url: 'https://hooks.example.com/huly',
  deliveryId: 'd1',
  body: '{"action":"edited"}',
  ...props
})

function options (transport: DeliveryOptions['transport'], props: Partial<DeliveryOptions> = {}): DeliveryOptions {
  return { transport, allowInsecure: false, timeoutMs: 1000, retryDelayMs: 10, sleep: async () => {}, ...props }
}

describe('deliver', () => {
  it('posts the body with the event headers and the signature', async () => {
    const seen: WebhookRequest[] = []
    const res = await deliver(job({ secret: 's3cret' }), options(async (r) => { seen.push(r); return { status: 204 } }))
    expect(res).toEqual({ ok: true, attempts: 1, status: 204 })
    expect(seen).toHaveLength(1)
    expect(seen[0].url.href).toBe('https://hooks.example.com/huly')
    expect(seen[0].body).toBe('{"action":"edited"}')
    expect(seen[0].headers['X-Huly-Signature-256']).toBe(signPayload('s3cret', '{"action":"edited"}'))
    expect(seen[0].headers['X-Huly-Event']).toBe('project_item')
    expect(seen[0].headers['X-Huly-Delivery']).toBe('d1')
    expect(seen[0].headers['Content-Type']).toBe('application/json')
    expect(seen[0].timeoutMs).toBe(1000)
  })

  it('does not sign without a secret', async () => {
    const seen: WebhookRequest[] = []
    await deliver(job(), options(async (r) => { seen.push(r); return { status: 200 } }))
    await deliver(job({ secret: '' }), options(async (r) => { seen.push(r); return { status: 200 } }))
    expect(seen.every((r) => !('X-Huly-Signature-256' in r.headers))).toBe(true)
  })

  it('retries once after a network error and then succeeds', async () => {
    let calls = 0
    const sleeps: number[] = []
    const res = await deliver(
      job(),
      options(
        async () => {
          calls++
          if (calls === 1) throw new Error('ECONNRESET')
          return { status: 200 }
        },
        { sleep: async (ms) => { sleeps.push(ms) }, retryDelayMs: 250 }
      )
    )
    expect(res).toEqual({ ok: true, attempts: 2, status: 200 })
    expect(sleeps).toEqual([250])
  })

  it('retries a server error or 429 once, and gives up after the second failure', async () => {
    for (const status of [500, 502, 503, 429]) {
      let calls = 0
      const res = await deliver(job(), options(async () => { calls++; return { status } }))
      expect(calls).toBe(2)
      expect(res).toEqual({ ok: false, attempts: 2, status, failure: 'status' })
    }
    let calls = 0
    const res = await deliver(job(), options(async () => { calls++; throw new Error('timeout') }))
    expect(calls).toBe(2)
    expect(res).toEqual({ ok: false, attempts: 2, failure: 'network' })
  })

  it('does not retry another refusal', async () => {
    for (const status of [400, 401, 403, 404, 410, 301, 302]) {
      let calls = 0
      const res = await deliver(job(), options(async () => { calls++; return { status } }))
      expect(calls).toBe(1)
      expect(res).toEqual({ ok: false, attempts: 1, status, failure: 'status' })
    }
  })

  it('does not try a URL that is not allowed', async () => {
    let calls = 0
    const transport = async (): Promise<{ status: number }> => { calls++; return { status: 200 } }
    for (const url of ['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://169.254.169.254/x', 'https://localhost/x', 'https://u:p@hooks.example.com/x', 'not a url', '']) {
      expect(await deliver(job({ url }), options(transport))).toEqual({ ok: false, attempts: 0, failure: 'blocked' })
    }
    expect(calls).toBe(0)
  })

  it('allows http and local targets only in development mode', async () => {
    let calls = 0
    const transport = async (): Promise<{ status: number }> => { calls++; return { status: 200 } }
    const res = await deliver(job({ url: 'http://localhost:3000/hook' }), options(transport, { allowInsecure: true }))
    expect(res.ok).toBe(true)
    expect(calls).toBe(1)
  })

  it('never retries a blocked target and never throws', async () => {
    let calls = 0
    const res = await deliver(job(), options(async () => { calls++; throw new WebhookBlockedError('private') }))
    expect(calls).toBe(1)
    expect(res).toEqual({ ok: false, attempts: 1, failure: 'blocked' })
  })
})

describe('runDeliveries', () => {
  it('limits how many run at once and keeps the order of the results', async () => {
    let active = 0
    let peak = 0
    const transport = async (r: WebhookRequest): Promise<{ status: number }> => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return { status: r.body === 'bad' ? 400 : 200 }
    }
    const jobs = Array.from({ length: 12 }, (_, i) => job({ deliveryId: `d${i}`, body: i === 3 ? 'bad' : 'ok' }))
    const results = await runDeliveries(jobs, options(transport), 3)
    expect(peak).toBeLessThanOrEqual(3)
    expect(results).toHaveLength(12)
    expect(results[3].ok).toBe(false)
    expect(results.filter((r) => r.ok)).toHaveLength(11)
  })

  it('has nothing to do for no jobs', async () => {
    expect(await runDeliveries([], options(async () => ({ status: 200 })))).toEqual([])
  })
})

describe('createSafeLookup (SSRF guard)', () => {
  type Answer = Array<{ address: string, family: number }>
  const resolver = (answer: Answer | Error) => (_host: string, _o: { all: true }, cb: (err: Error | null, a: Answer) => void): void => {
    if (answer instanceof Error) cb(answer, [])
    else cb(null, answer)
  }
  const run = async (lookup: ReturnType<typeof createSafeLookup>, options: any = { all: true }): Promise<{ err: any, res: any[] }> =>
    await new Promise((resolve) => {
      lookup('hooks.example.com', options, (err: any, ...res: any[]) => { resolve({ err, res }) })
    })

  it('answers with public addresses, in the shape the socket asked for', async () => {
    const lookup = createSafeLookup(false, resolver([{ address: '93.184.216.34', family: 4 }]) as any)
    expect((await run(lookup, { all: true })).res).toEqual([[{ address: '93.184.216.34', family: 4 }]])
    expect((await run(lookup, {})).res).toEqual(['93.184.216.34', 4])
  })

  it('refuses a name that resolves to a private address, also among public ones', async () => {
    for (const address of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      const lookup = createSafeLookup(false, resolver([{ address, family: address.includes(':') ? 6 : 4 }]) as any)
      const { err } = await run(lookup)
      expect(err).toBeInstanceOf(WebhookBlockedError)
    }
    const mixed = createSafeLookup(false, resolver([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]) as any)
    expect((await run(mixed)).err).toBeInstanceOf(WebhookBlockedError)
  })

  it('refuses a name that does not resolve and passes DNS errors on', async () => {
    expect((await run(createSafeLookup(false, resolver([]) as any))).err).toBeInstanceOf(WebhookBlockedError)
    const dnsError = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
    expect((await run(createSafeLookup(false, resolver(dnsError) as any))).err).toBe(dnsError)
  })

  it('allows private addresses only in development mode', async () => {
    const lookup = createSafeLookup(true, resolver([{ address: '127.0.0.1', family: 4 }]) as any)
    expect((await run(lookup)).err).toBeNull()
  })
})
