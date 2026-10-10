// SPDX-License-Identifier: EPL-2.0
import {
  GitlabApi,
  GitlabApiError,
  GitlabReadonlyError,
  GitlabUploadTooLargeError,
  gitlabErrorSummary,
  isNotFound,
  uploadContentType,
  type FetchFn
} from '../gitlab/api'

interface Call {
  url: string
  init: RequestInit | undefined
}

function fakeFetch (responses: Array<{ status: number, body?: unknown, headers?: Record<string, string> }>): {
  fn: FetchFn
  calls: Call[]
} {
  const calls: Call[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = responses.shift()
    if (r === undefined) throw new Error(`unexpected call ${url}`)
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers })
  }) as unknown as FetchFn
  return { fn, calls }
}

// Answers every call with the same raw (non-JSON) body
function rawFetch (
  status: number,
  body: string | Uint8Array,
  headers: Record<string, string> = {}
): { fn: FetchFn, calls: Call[] } {
  const calls: Call[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(body as BodyInit, { status, headers })
  }) as unknown as FetchFn
  return { fn, calls }
}

const SECRET = '0123456789abcdef0123456789abcdef'

describe('GitlabApi', () => {
  it('sends bearer token to /api/v4 on a sub-path host', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { id: 1, username: 'u', name: 'U', avatar_url: null, web_url: 'w' } }
    ])
    const user = await new GitlabApi('https://git.corp.local/gitlab', 'tok', fn).getCurrentUser()
    expect(user.username).toBe('u')
    expect(calls[0].url).toBe('https://git.corp.local/gitlab/api/v4/user')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('keeps a non-JSON 2xx body out of the message, and its first 500 characters in detail', async () => {
    const body = `<html>login page ${'x'.repeat(2000)}</html>`
    const { fn } = rawFetch(200, body, { 'content-type': 'text/html' })
    const err = (await new GitlabApi('https://gitlab.com', 't', fn)
      .getCurrentUser()
      .catch((e: unknown) => e)) as GitlabApiError
    expect(err).toBeInstanceOf(GitlabApiError)
    expect(err.status).toBe(200)
    expect(err.message).toBe('GitLab GET /user returned an invalid JSON response')
    expect(err.message).not.toContain('login page')
    expect(err.detail).toBe(body.slice(0, 500))
  })

  it('follows x-next-page pagination', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: [{ id: 1 }], headers: { 'x-next-page': '2' } },
      { status: 200, body: [{ id: 2 }], headers: { 'x-next-page': '' } }
    ])
    const projects = await new GitlabApi('https://gitlab.com', 't', fn).listMaintainedProjects()
    expect(projects.map((p) => p.id)).toEqual([1, 2])
    expect(calls[0].url).toBe(
      'https://gitlab.com/api/v4/projects?membership=true&min_access_level=40&per_page=100&page=1'
    )
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
    const hook = await new GitlabApi('https://gitlab.com', 't', fn).ensureProjectHook(
      5,
      'https://hooks/api/webhook',
      's'
    )
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
    const hook = await new GitlabApi('https://gitlab.com', 't', fn).ensureProjectHook(
      5,
      'https://hooks/api/webhook',
      's'
    )
    expect(hook.id).toBe(7)
    expect(calls.map((c) => c.init?.method)).toEqual(['GET', 'GET', 'PUT'])
  })

  it('ensureProjectHook creates a hook when none matches', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: [{ id: 1, url: 'https://other' }] },
      { status: 201, body: { id: 9, url: 'https://hooks/api/webhook' } }
    ])
    const hook = await new GitlabApi('https://gitlab.com', 't', fn).ensureProjectHook(
      5,
      'https://hooks/api/webhook',
      's'
    )
    expect(hook.id).toBe(9)
    expect(calls[1].init?.method).toBe('POST')
    const body = JSON.parse(calls[1].init?.body as string)
    expect(body).toMatchObject({
      issues_events: true,
      merge_requests_events: true,
      note_events: true,
      push_events: false
    })
    // Confidential issues and internal notes are never imported, so their hooks stay off
    expect(body).toMatchObject({ confidential_issues_events: false, confidential_note_events: false })
  })

  it('deleteProjectHook ignores 404', async () => {
    const { fn } = fakeFetch([{ status: 404, body: { message: 'Not found' } }])
    await expect(new GitlabApi('https://gitlab.com', 't', fn).deleteProjectHook(5, 7)).resolves.toBeUndefined()
  })

  it('uploads a file as multipart form data', async () => {
    const url = `/uploads/${SECRET}/shot.png`
    const { fn, calls } = fakeFetch([
      { status: 201, body: { alt: 'shot', url, full_path: `/-/project/5${url}`, markdown: `![shot](${url})` } }
    ])
    const upload = await new GitlabApi('https://gitlab.com', 't', fn).uploadFile(
      5,
      'shot.png',
      Buffer.from('png-bytes'),
      'image/png'
    )
    expect(upload.url).toBe(url)
    expect(calls[0].url).toBe('https://gitlab.com/api/v4/projects/5/uploads')
    expect(calls[0].init?.method).toBe('POST')
    // fetch sets the multipart boundary itself
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    const file = (calls[0].init?.body as FormData).get('file') as File
    expect(file.name).toBe('shot.png')
    expect(file.type).toBe('image/png')
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('png-bytes')
  })

  it('downloads an upload by secret and file name, encoding the name once', async () => {
    const { fn, calls } = rawFetch(200, 'img', { 'content-type': 'image/png' })
    const got = await new GitlabApi('https://gitlab.com', 't', fn).downloadUpload(5, SECRET, 'my%20shot.png', 100)
    expect(calls[0].url).toBe(`https://gitlab.com/api/v4/projects/5/uploads/${SECRET}/my%20shot.png`)
    expect(got).toEqual({ data: Buffer.from('img'), contentType: 'image/png' })
  })

  // GitLab's API serves every upload as application/octet-stream; the image type comes from the bytes
  it.each([
    ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0], 'image/png'],
    ['jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0], 'image/jpeg'],
    ['gif', [...Buffer.from('GIF89a'), 0, 0, 0, 0, 0, 0], 'image/gif'],
    ['webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')], 'image/webp'],
    ['bmp', [...Buffer.from('BM'), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'image/bmp'],
    ['avif', [0, 0, 0, 0x1c, ...Buffer.from('ftypavif')], 'image/avif'],
    ['svg', [...Buffer.from('<svg xmlns=')], 'application/octet-stream'],
    ['text', [...Buffer.from('hello world!')], 'application/octet-stream']
  ])('recognises a %s served as application/octet-stream', async (_name, bytes, expected) => {
    const { fn } = rawFetch(200, new Uint8Array(bytes), { 'content-type': 'application/octet-stream' })
    const got = await new GitlabApi('https://gitlab.com', 't', fn).downloadUpload(5, SECRET, 'a.png', 100)
    expect(got.contentType).toBe(expected)
  })

  it('keeps a specific type GitLab sends', async () => {
    const { fn } = rawFetch(200, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { 'content-type': 'image/x-custom' })
    expect(
      (await new GitlabApi('https://gitlab.com', 't', fn).downloadUpload(5, SECRET, 'a.png', 100)).contentType
    ).toBe('image/x-custom')
  })

  it.each(['..', '.', '%2E%2E', '%2e'])('refuses the dot-segment file name %p without fetching', async (name) => {
    const { fn, calls } = rawFetch(200, 'img', { 'content-type': 'image/png' })
    await expect(new GitlabApi('https://gitlab.com', 't', fn).downloadUpload(5, SECRET, name, 100)).rejects.toThrow(
      'Invalid upload file name'
    )
    expect(calls).toHaveLength(0)
  })

  it('refuses a download larger than the limit', async () => {
    const { fn } = rawFetch(200, 'x'.repeat(11), { 'content-type': 'image/png' })
    await expect(
      new GitlabApi('https://gitlab.com', 't', fn).downloadUpload(5, SECRET, 'a.png', 10)
    ).rejects.toBeInstanceOf(GitlabUploadTooLargeError)
  })

  it('refuses a download whose content-length exceeds the limit without reading it', async () => {
    const { fn } = rawFetch(200, 'x'.repeat(11), { 'content-type': 'image/png', 'content-length': '11' })
    const err = await new GitlabApi('https://gitlab.com', 't', fn)
      .downloadUpload(5, SECRET, 'a.png', 10)
      .catch((e) => e)
    expect(err).toBeInstanceOf(GitlabUploadTooLargeError)
    expect(err.size).toBe(11)
    expect(err.limit).toBe(10)
  })

  it('reports a GitLab without the download endpoint as a 404 GitlabApiError', async () => {
    const { fn } = rawFetch(404, '{"error":"404 Not Found"}')
    const err = await new GitlabApi('https://gitlab.com', 't', fn)
      .downloadUpload(5, SECRET, 'a.png', 10)
      .catch((e) => e)
    expect(err).toBeInstanceOf(GitlabApiError)
    expect(err.status).toBe(404)
  })
})

describe('GITLAB_READONLY', () => {
  afterEach(() => {
    delete process.env.GITLAB_READONLY
  })

  it('refuses a write without calling GitLab', async () => {
    process.env.GITLAB_READONLY = 'true'
    const { fn, calls } = fakeFetch([])
    await expect(new GitlabApi('https://gitlab.com', 't', fn).updateIssue(5, 1, { title: 'x' })).rejects.toThrow(
      GitlabReadonlyError
    )
    expect(calls).toEqual([])
  })

  it('refuses an upload', async () => {
    process.env.GITLAB_READONLY = 'true'
    const { fn, calls } = fakeFetch([])
    await expect(
      new GitlabApi('https://gitlab.com', 't', fn).uploadFile(5, 'a.png', Buffer.from('x'), 'image/png')
    ).rejects.toThrow(GitlabReadonlyError)
    expect(calls).toEqual([])
  })

  it('still reads and manages project hooks', async () => {
    process.env.GITLAB_READONLY = 'true'
    const { fn, calls } = fakeFetch([
      { status: 200, body: { id: 1001, iid: 1 } },
      { status: 200, body: [] },
      { status: 201, body: { id: 9, url: 'https://hooks/x' } },
      { status: 204 }
    ])
    const api = new GitlabApi('https://gitlab.com', 't', fn)
    await api.getIssue(5, 1)
    await api.ensureProjectHook(5, 'https://hooks/x', 's')
    await api.deleteProjectHook(5, 9)
    expect(calls.map((it) => it.init?.method)).toEqual(['GET', 'GET', 'POST', 'DELETE'])
  })

  it('writes when GITLAB_READONLY is anything but true', async () => {
    process.env.GITLAB_READONLY = 'false'
    const { fn, calls } = fakeFetch([{ status: 200, body: { id: 1001, iid: 1 } }])
    await new GitlabApi('https://gitlab.com', 't', fn).updateIssue(5, 1, { title: 'x' })
    expect(calls).toHaveLength(1)
  })
})

describe('isNotFound', () => {
  it('is true only for a GitLab 404', () => {
    expect(isNotFound(new GitlabApiError(404, 'x'))).toBe(true)
    expect(isNotFound(new GitlabApiError(403, 'x'))).toBe(false)
    expect(isNotFound(new Error('404'))).toBe(false)
    expect(isNotFound(undefined)).toBe(false)
  })
})

describe('gitlabErrorSummary', () => {
  it('keeps GitLab JSON message/error text and nothing else', () => {
    expect(gitlabErrorSummary('{"message":"title is too long"}')).toBe('title is too long')
    expect(gitlabErrorSummary('{"error":{"title":["bad"]}}')).toBe('{"title":["bad"]}')
    expect(gitlabErrorSummary('<html>boom</html>')).toBeUndefined()
    expect(gitlabErrorSummary(`{"message":"${'x'.repeat(300)}"}`)).toHaveLength(200)
  })
})

describe('uploadContentType', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])

  it('keeps a declared specific type', () => {
    expect(uploadContentType('application/pdf', png)).toBe('application/pdf')
  })

  it('replaces octet-stream by the image type the bytes show', () => {
    expect(uploadContentType('application/octet-stream', png)).toBe('image/png')
    expect(uploadContentType(null, png)).toBe('image/png')
  })

  it('stays octet-stream for unknown bytes', () => {
    expect(uploadContentType('application/octet-stream', Buffer.from('plain text'))).toBe('application/octet-stream')
  })
})
