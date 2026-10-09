// SPDX-License-Identifier: EPL-2.0
import { GitlabApi, GitlabApiError, type FetchFn } from '../gitlab/api'

interface Reply {
  status?: number
  body?: unknown
  text?: string
  headers?: Record<string, string>
}

function recorder (replies: Reply[]): { fn: FetchFn, calls: Array<{ method: string, url: string, body?: unknown }> } {
  const calls: Array<{ method: string, url: string, body?: unknown }> = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined })
    const next = replies.shift() ?? { status: 404, body: { message: 'unexpected' } }
    const payload = next.text ?? (next.body === undefined ? '' : JSON.stringify(next.body))
    return new Response(payload, { status: next.status ?? 200, headers: next.headers })
  }) as unknown as FetchFn
  return { fn, calls }
}

const host = 'https://gitlab.example.com'
const mr = { id: 2003, iid: 3, title: 'T', state: 'opened', updated_at: '2026-01-01T00:00:00.000Z' }
const base = `${host}/api/v4/projects/42/merge_requests`

describe('GitlabApi merge requests', () => {
  it('lists merge requests of all states updated after a time, oldest first', async () => {
    const { fn, calls } = recorder([{ body: [mr], headers: { 'x-next-page': '' } }])
    const result = await new GitlabApi(host, 't', fn).listMergeRequests(42, '2026-01-01T00:00:00.000Z')
    expect(result.map((it) => it.iid)).toEqual([3])
    expect(calls[0].url).toBe(
      `${base}?order_by=updated_at&sort=asc&state=all&updated_after=2026-01-01T00%3A00%3A00.000Z&per_page=100&page=1`
    )
  })

  it('gets and updates a merge request', async () => {
    const { fn, calls } = recorder([{ body: mr }, { body: { ...mr, state: 'closed' } }])
    const api = new GitlabApi(host, 't', fn)
    await api.getMergeRequest(42, 3)
    const updated = await api.updateMergeRequest(42, 3, { reviewer_ids: [7], state_event: 'close' })
    expect(updated.state).toBe('closed')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${base}/3`, `PUT ${base}/3`])
    expect(calls[1].body).toEqual({ reviewer_ids: [7], state_event: 'close' })
  })

  it('lists reviewers with their review state, and commits across pages', async () => {
    const reviewer = { user: { id: 7, username: 'u7', name: 'U7', avatar_url: null }, state: 'approved' }
    const { fn, calls } = recorder([
      { body: [reviewer] },
      { body: [{ id: 'a' }], headers: { 'x-next-page': '2' } },
      { body: [{ id: 'b' }], headers: { 'x-next-page': '' } }
    ])
    const api = new GitlabApi(host, 't', fn)
    expect(await api.listMergeRequestReviewers(42, 3)).toEqual([reviewer])
    expect((await api.listMergeRequestCommits(42, 3)).map((it) => it.id)).toEqual(['a', 'b'])
    expect(calls[0].url).toBe(`${base}/3/reviewers`)
    expect(calls[1].url).toBe(`${base}/3/commits?per_page=100&page=1`)
  })

  it('returns the raw diff as text, and lists per-file diffs in unified format', async () => {
    const raw = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n'
    const file = { old_path: 'x', new_path: 'x', a_mode: '100644', b_mode: '100644', diff: '@@ -1 +1 @@\n-a\n+b\n', new_file: false, renamed_file: false, deleted_file: false }
    const { fn, calls } = recorder([{ text: raw }, { body: [file], headers: { 'x-next-page': '' } }])
    const api = new GitlabApi(host, 't', fn)
    expect(await api.getMergeRequestRawDiffs(42, 3)).toBe(raw)
    expect(await api.listMergeRequestDiffs(42, 3)).toEqual([file])
    expect(calls[0].url).toBe(`${base}/3/raw_diffs`)
    expect(calls[1].url).toBe(`${base}/3/diffs?unidiff=true&per_page=100&page=1`)
  })

  it('reports a missing raw diff endpoint as a 404 error', async () => {
    const { fn } = recorder([{ status: 404, body: { message: '404 Not found' } }])
    const err = await new GitlabApi(host, 't', fn).getMergeRequestRawDiffs(42, 3).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitlabApiError)
    expect((err as GitlabApiError).status).toBe(404)
  })

  it('lists, gets, creates, updates and deletes merge request notes', async () => {
    const note = { id: 9, body: 'hi' }
    const { fn, calls } = recorder([
      { body: [note], headers: { 'x-next-page': '' } },
      { body: note },
      { body: note },
      { body: note },
      { body: {} }
    ])
    const api = new GitlabApi(host, 't', fn)
    await api.listMergeRequestNotes(42, 3)
    await api.getMergeRequestNote(42, 3, 9)
    await api.createMergeRequestNote(42, 3, 'hi')
    await api.updateMergeRequestNote(42, 3, 9, 'edited')
    await api.deleteMergeRequestNote(42, 3, 9)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${base}/3/notes?order_by=created_at&sort=asc&per_page=100&page=1`,
      `GET ${base}/3/notes/9`,
      `POST ${base}/3/notes`,
      `PUT ${base}/3/notes/9`,
      `DELETE ${base}/3/notes/9`
    ])
    expect(calls[2].body).toEqual({ body: 'hi' })
  })

  it('treats deleting an already deleted merge request note as done', async () => {
    const { fn } = recorder([{ status: 404, body: { message: '404 Not found' } }])
    await expect(new GitlabApi(host, 't', fn).deleteMergeRequestNote(42, 3, 9)).resolves.toBeUndefined()
  })
})
