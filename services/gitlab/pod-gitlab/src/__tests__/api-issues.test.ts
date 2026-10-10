// SPDX-License-Identifier: EPL-2.0
import { abortableSleep, GitlabApi, GitlabApiError, retryDelayMs, type FetchFn } from '../gitlab/api'
import { waitUntil } from './helpers/sync'

interface Reply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

function recorder (replies: Reply[]): { fn: FetchFn, calls: Array<{ method: string, url: string, body?: unknown }> } {
  const calls: Array<{ method: string, url: string, body?: unknown }> = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined
    })
    const next = replies.shift() ?? { status: 404, body: { message: 'unexpected' } }
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: next.headers
    })
  }) as unknown as FetchFn
  return { fn, calls }
}

async function collect<T> (pages: AsyncIterable<T[]>): Promise<T[]> {
  const result: T[] = []
  for await (const page of pages) result.push(...page)
  return result
}

const host = 'https://gitlab.example.com'
const issue = { id: 1001, iid: 1, title: 'T', state: 'opened', updated_at: '2026-01-01T00:00:00.000Z' }

describe('GitlabApi issues and notes', () => {
  it('moves an issue to another project', async () => {
    const { fn, calls } = recorder([{ status: 201, body: { ...issue, iid: 8, project_id: 43 } }])
    const moved = await new GitlabApi(host, 't', fn).moveIssue(42, 1, 43)
    expect(moved.iid).toBe(8)
    expect(calls).toEqual([
      { method: 'POST', url: `${host}/api/v4/projects/42/issues/1/move`, body: { to_project_id: 43 } }
    ])
  })

  it('lists issues updated after a time, oldest first, across pages', async () => {
    const { fn, calls } = recorder([
      { body: [issue], headers: { 'x-next-page': '2' } },
      { body: [{ ...issue, iid: 2 }], headers: { 'x-next-page': '' } }
    ])
    const result = await collect(new GitlabApi(host, 't', fn).listIssuePages(42, '2026-01-01T00:00:00.000Z'))
    expect(result.map((it) => it.iid)).toEqual([1, 2])
    expect(calls[0].url).toBe(
      `${host}/api/v4/projects/42/issues?order_by=updated_at&sort=asc&updated_after=2026-01-01T00%3A00%3A00.000Z&per_page=100&page=1`
    )
    expect(calls[1].url).toContain('page=2')
  })

  it('lists all issues when no time is given', async () => {
    const { fn, calls } = recorder([{ body: [], headers: {} }])
    await collect(new GitlabApi(host, 't', fn).listIssuePages(42))
    expect(calls[0].url).toBe(`${host}/api/v4/projects/42/issues?order_by=updated_at&sort=asc&per_page=100&page=1`)
  })

  it('gets, creates and updates issues', async () => {
    const { fn, calls } = recorder([{ body: issue }, { body: issue }, { body: { ...issue, state: 'closed' } }])
    const api = new GitlabApi(host, 't', fn)
    await api.getIssue(42, 1)
    await api.createIssue(42, { title: 'T', description: 'D', assignee_ids: [7] })
    const updated = await api.updateIssue(42, 1, { state_event: 'close' })
    expect(updated.state).toBe('closed')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${host}/api/v4/projects/42/issues/1`,
      `POST ${host}/api/v4/projects/42/issues`,
      `PUT ${host}/api/v4/projects/42/issues/1`
    ])
    expect(calls[1].body).toEqual({ title: 'T', description: 'D', assignee_ids: [7] })
    expect(calls[2].body).toEqual({ state_event: 'close' })
  })

  it('lists, gets, creates, updates and deletes notes', async () => {
    const note = { id: 9, body: 'hi' }
    const { fn, calls } = recorder([
      { body: [note], headers: { 'x-next-page': '' } },
      { body: note },
      { body: note },
      { body: note },
      { body: {} }
    ])
    const api = new GitlabApi(host, 't', fn)
    await api.listNotes(42, 'issues', 1)
    await api.getNote(42, 'issues', 1, 9)
    await api.createNote(42, 'issues', 1, 'hi')
    await api.updateNote(42, 'issues', 1, 9, 'edited')
    await api.deleteNote(42, 'issues', 1, 9)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${host}/api/v4/projects/42/issues/1/notes?order_by=created_at&sort=asc&per_page=100&page=1`,
      `GET ${host}/api/v4/projects/42/issues/1/notes/9`,
      `POST ${host}/api/v4/projects/42/issues/1/notes`,
      `PUT ${host}/api/v4/projects/42/issues/1/notes/9`,
      `DELETE ${host}/api/v4/projects/42/issues/1/notes/9`
    ])
    expect(calls[2].body).toEqual({ body: 'hi' })
    expect(calls[3].body).toEqual({ body: 'edited' })
  })

  it('treats deleting an already deleted note as done', async () => {
    const { fn } = recorder([{ status: 404, body: { message: '404 Not found' } }])
    await expect(new GitlabApi(host, 't', fn).deleteNote(42, 'issues', 1, 9)).resolves.toBeUndefined()
  })

  it('retries a rate-limited request after Retry-After', async () => {
    const { fn, calls } = recorder([{ status: 429, headers: { 'retry-after': '2' }, body: {} }, { body: issue }])
    const sleep = jest.fn(async () => {})
    const result = await new GitlabApi(host, 't', fn, sleep).getIssue(42, 1)
    expect(result.iid).toBe(1)
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(calls).toHaveLength(2)
  })

  it('gives up after three retries', async () => {
    const limited = { status: 429, body: {} }
    const { fn } = recorder([limited, limited, limited, limited])
    const sleep = jest.fn(async () => {})
    const err = await new GitlabApi(host, 't', fn, sleep).getIssue(42, 1).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitlabApiError)
    expect((err as GitlabApiError).status).toBe(429)
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it('waits for RateLimit-Reset when GitLab sends no Retry-After', async () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const reset = String(now / 1000 + 7)
    const { fn } = recorder([{ status: 429, headers: { 'ratelimit-reset': reset }, body: {} }, { body: issue }])
    const sleep = jest.fn(async () => {})
    await new GitlabApi(host, 't', fn, sleep, () => now).getIssue(42, 1)
    expect(sleep).toHaveBeenCalledWith(7000)
  })

  it('tells when the rate limit resets once it gives up', async () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const limited = { status: 429, headers: { 'ratelimit-reset': String(now / 1000 + 600) }, body: {} }
    const { fn } = recorder([limited, limited, limited, limited])
    const err = (await new GitlabApi(
      host,
      't',
      fn,
      async () => {},
      () => now
    )
      .getIssue(42, 1)
      .catch((e: unknown) => e)) as GitlabApiError
    expect(err.retryAt).toBe(now + 600_000)
  })

  it('retryDelayMs prefers Retry-After, caps at a minute and falls back to a second', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(retryDelayMs(new Headers({ 'retry-after': '2', 'ratelimit-reset': '9999' }), now)).toBe(2000)
    expect(retryDelayMs(new Headers({ 'ratelimit-reset': String(now / 1000 + 3600) }), now)).toBe(60_000)
    expect(retryDelayMs(new Headers({ 'ratelimit-reset': String(now / 1000 - 5) }), now)).toBe(0)
    expect(retryDelayMs(new Headers({}), now)).toBe(1000)
  })

  it('reads a RateLimit-Reset below 1e9 as seconds from now', async () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(retryDelayMs(new Headers({ 'ratelimit-reset': '7' }), now)).toBe(7000)
    const limited = { status: 429, headers: { 'ratelimit-reset': '600' }, body: {} }
    const { fn } = recorder([limited, limited, limited, limited])
    const err = (await new GitlabApi(
      host,
      't',
      fn,
      async () => {},
      () => now
    )
      .getIssue(42, 1)
      .catch((e: unknown) => e)) as GitlabApiError
    expect(err.retryAt).toBe(now + 600_000)
  })

  it('keeps a non-JSON error body out of the message, and its first 500 characters in detail', async () => {
    const { fn } = recorder([{ status: 500, body: `<html>internal admin ${'x'.repeat(2000)}</html>` }])
    const err = (await new GitlabApi(host, 't', fn).getIssue(42, 1).catch((e: unknown) => e)) as GitlabApiError
    expect(err.status).toBe(500)
    expect(err.message).toBe('GitLab GET /projects/42/issues/1 failed: 500')
    expect(err.detail).toContain('<html>internal admin')
    expect(err.detail?.length).toBe(500)
  })

  it("keeps GitLab's own JSON message, shortened to 200 characters", async () => {
    const { fn } = recorder([
      { status: 422, body: { message: { title: ['is too long'] } } },
      { status: 400, body: { error: 'y'.repeat(300) } }
    ])
    const api = new GitlabApi(host, 't', fn)
    const invalid = (await api.getIssue(42, 1).catch((e: unknown) => e)) as GitlabApiError
    expect(invalid.message).toBe('GitLab GET /projects/42/issues/1 failed: 422 {"title":["is too long"]}')
    const long = (await api.getIssue(42, 1).catch((e: unknown) => e)) as GitlabApiError
    expect(long.message).toBe(`GitLab GET /projects/42/issues/1 failed: 400 ${'y'.repeat(200)}`)
  })
})

describe('abortableSleep', () => {
  it('ends a 429 wait as soon as its signal aborts', async () => {
    const controller = new AbortController()
    const fn = jest.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '60' } }))
    const started = Date.now()
    const call = new GitlabApi('https://gitlab.com', 't', fn as any, abortableSleep(controller.signal)).getIssue(42, 1)
    await waitUntil(() => fn.mock.calls.length === 1)
    controller.abort(new Error('closing'))
    await expect(call).rejects.toThrow('closing')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('refuses to start a wait after the signal aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('closed'))
    await expect(abortableSleep(controller.signal)(10)).rejects.toThrow('closed')
  })
})
