// SPDX-License-Identifier: EPL-2.0
import { GitlabApi, type FetchFn } from '../gitlab/api'

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
const base = `${host}/api/v4/projects/42/merge_requests/3`
const user = { id: 7, username: 'u7', name: 'U7', avatar_url: null }
const note = { id: 51, body: 'Hm', author: user, created_at: 'c', updated_at: 'u', system: false, noteable_type: 'MergeRequest', type: 'DiffNote' }
const discussion = { id: 'd1', individual_note: false, notes: [note] }

describe('GitlabApi approvals', () => {
  it('reads approvals, approves and revokes', async () => {
    const approvals = { approved_by: [{ user }] }
    const { fn, calls } = recorder([{ body: approvals }, { status: 201, body: approvals }, { status: 201, body: { approved_by: [] } }])
    const api = new GitlabApi(host, 't', fn)
    expect(await api.getMergeRequestApprovals(42, 3)).toEqual(approvals)
    await api.approveMergeRequest(42, 3)
    await api.unapproveMergeRequest(42, 3)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${base}/approvals`, `POST ${base}/approve`, `POST ${base}/unapprove`])
  })

  it('treats revoking an approval that does not exist as done', async () => {
    const { fn } = recorder([{ status: 404, body: { message: '404 Not found' } }])
    await expect(new GitlabApi(host, 't', fn).unapproveMergeRequest(42, 3)).resolves.toBeUndefined()
  })

  it('reports an approval GitLab refuses', async () => {
    const { fn } = recorder([{ status: 401, body: { message: '401 Unauthorized' } }])
    await expect(new GitlabApi(host, 't', fn).approveMergeRequest(42, 3)).rejects.toMatchObject({ status: 401 })
  })
})

describe('GitlabApi discussions', () => {
  it('lists discussions across pages and gets one', async () => {
    const { fn, calls } = recorder([
      { body: [discussion], headers: { 'x-next-page': '2' } },
      { body: [{ ...discussion, id: 'd2' }], headers: { 'x-next-page': '' } },
      { body: discussion }
    ])
    const api = new GitlabApi(host, 't', fn)
    expect((await api.listMergeRequestDiscussions(42, 3)).map((it) => it.id)).toEqual(['d1', 'd2'])
    expect((await api.getMergeRequestDiscussion(42, 3, 'd1')).id).toBe('d1')
    expect(calls.map((c) => c.url)).toEqual([
      `${base}/discussions?per_page=100&page=1`,
      `${base}/discussions?per_page=100&page=2`,
      `${base}/discussions/d1`
    ])
  })

  it('replies, edits and deletes discussion notes; a missing note counts as deleted', async () => {
    const { fn, calls } = recorder([{ status: 201, body: note }, { body: note }, { text: '' }, { status: 404, body: { message: 'gone' } }])
    const api = new GitlabApi(host, 't', fn)
    await api.createMergeRequestDiscussionNote(42, 3, 'd1', 'Reply')
    await api.updateMergeRequestDiscussionNote(42, 3, 'd1', 51, 'Edited')
    await api.deleteMergeRequestDiscussionNote(42, 3, 'd1', 51)
    await api.deleteMergeRequestDiscussionNote(42, 3, 'd1', 52)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${base}/discussions/d1/notes`,
      `PUT ${base}/discussions/d1/notes/51`,
      `DELETE ${base}/discussions/d1/notes/51`,
      `DELETE ${base}/discussions/d1/notes/52`
    ])
    expect(calls[0].body).toEqual({ body: 'Reply' })
    expect(calls[1].body).toEqual({ body: 'Edited' })
  })

  it('resolves and reopens a discussion', async () => {
    const { fn, calls } = recorder([{ body: discussion }, { body: discussion }])
    const api = new GitlabApi(host, 't', fn)
    await api.resolveMergeRequestDiscussion(42, 3, 'd1', true)
    await api.resolveMergeRequestDiscussion(42, 3, 'd1', false)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `PUT ${base}/discussions/d1?resolved=true`,
      `PUT ${base}/discussions/d1?resolved=false`
    ])
  })
})
