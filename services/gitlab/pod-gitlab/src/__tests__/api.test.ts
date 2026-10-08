// SPDX-License-Identifier: EPL-2.0
import { GitlabApi, GitlabApiError, type FetchFn } from '../gitlab/api'

interface Call { url: string, init: RequestInit | undefined }

function fakeFetch (responses: Array<{ status: number, body?: unknown, headers?: Record<string, string> }>): { fn: FetchFn, calls: Call[] } {
  const calls: Call[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = responses.shift()
    if (r === undefined) throw new Error(`unexpected call ${url}`)
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers })
  }) as unknown as FetchFn
  return { fn, calls }
}

describe('GitlabApi', () => {
  it('sends bearer token to /api/v4 on a sub-path host', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { id: 1, username: 'u', name: 'U', avatar_url: null, web_url: 'w' } }])
    const user = await new GitlabApi('https://git.corp.local/gitlab', 'tok', fn).getCurrentUser()
    expect(user.username).toBe('u')
    expect(calls[0].url).toBe('https://git.corp.local/gitlab/api/v4/user')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('follows x-next-page pagination', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: [{ id: 1 }], headers: { 'x-next-page': '2' } },
      { status: 200, body: [{ id: 2 }], headers: { 'x-next-page': '' } }
    ])
    const projects = await new GitlabApi('https://gitlab.com', 't', fn).listMaintainedProjects()
    expect(projects.map((p) => p.id)).toEqual([1, 2])
    expect(calls[0].url).toBe('https://gitlab.com/api/v4/projects?membership=true&min_access_level=40&per_page=100&page=1')
    expect(calls[1].url).toContain('page=2')
  })

  it('throws GitlabApiError with status on failure', async () => {
    const { fn } = fakeFetch([{ status: 403, body: { message: '403 Forbidden' } }])
    const err = await new GitlabApi('https://gitlab.com', 't', fn).getCurrentUser().catch((e) => e)
    expect(err).toBeInstanceOf(GitlabApiError)
    expect(err.status).toBe(403)
  })

  it('ensureProjectHook reuses an existing hook with the same url', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: [{ id: 7, url: 'https://hooks/api/webhook' }] },
      { status: 200, body: { id: 7, url: 'https://hooks/api/webhook' } }
    ])
    const hook = await new GitlabApi('https://gitlab.com', 't', fn).ensureProjectHook(5, 'https://hooks/api/webhook', 's')
    expect(hook.id).toBe(7)
    expect(calls.map((c) => c.init?.method)).toEqual(['GET', 'PUT'])
    expect(calls[0].url).toBe('https://gitlab.com/api/v4/projects/5/hooks?per_page=100&page=1')
    expect(calls[1].url).toBe('https://gitlab.com/api/v4/projects/5/hooks/7')
    expect(JSON.parse(calls[1].init?.body as string).token).toBe('s')
  })

  it('ensureProjectHook finds an existing hook on a later page', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: [{ id: 1, url: 'https://other' }], headers: { 'x-next-page': '2' } },
      { status: 200, body: [{ id: 7, url: 'https://hooks/api/webhook' }], headers: { 'x-next-page': '' } },
      { status: 200, body: { id: 7, url: 'https://hooks/api/webhook' } }
    ])
    const hook = await new GitlabApi('https://gitlab.com', 't', fn).ensureProjectHook(5, 'https://hooks/api/webhook', 's')
    expect(hook.id).toBe(7)
    expect(calls.map((c) => c.init?.method)).toEqual(['GET', 'GET', 'PUT'])
  })

  it('ensureProjectHook creates a hook when none matches', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: [{ id: 1, url: 'https://other' }] },
      { status: 201, body: { id: 9, url: 'https://hooks/api/webhook' } }
    ])
    const hook = await new GitlabApi('https://gitlab.com', 't', fn).ensureProjectHook(5, 'https://hooks/api/webhook', 's')
    expect(hook.id).toBe(9)
    expect(calls[1].init?.method).toBe('POST')
    const body = JSON.parse(calls[1].init?.body as string)
    expect(body).toMatchObject({ issues_events: true, merge_requests_events: true, note_events: true, push_events: false })
    // Confidential issues and internal notes are never imported (D6), so their hooks stay off
    expect(body).toMatchObject({ confidential_issues_events: false, confidential_note_events: false })
  })

  it('deleteProjectHook ignores 404', async () => {
    const { fn } = fakeFetch([{ status: 404, body: { message: 'Not found' } }])
    await expect(new GitlabApi('https://gitlab.com', 't', fn).deleteProjectHook(5, 7)).resolves.toBeUndefined()
  })
})
