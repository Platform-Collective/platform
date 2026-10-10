// SPDX-License-Identifier: EPL-2.0
import { type FetchFn, GitlabApi } from '../gitlab/api'
import { GitlabRedirectError, safeFetch } from '../gitlab/fetch'
import { GitlabHostRefusedError, HostGuard, type LookupFn } from '../host-guard'

function base (status: number, headers: Record<string, string> = {}): jest.Mock {
  return jest.fn(async (_url: string, _init?: RequestInit) => new Response('body', { status, headers }))
}

const allowAll = { assertAllowed: async () => {}, assertRedirectAllowed: async () => {} }

describe('safeFetch', () => {
  it('asks the guard before calling GitLab', async () => {
    const fetchFn = base(200)
    const guard = {
      assertAllowed: jest.fn(async () => {
        throw new GitlabHostRefusedError('10.0.0.1')
      }),
      assertRedirectAllowed: jest.fn(async () => {})
    }
    await expect(
      safeFetch({ guard, timeoutMs: 1000 }, fetchFn as unknown as FetchFn)('https://10.0.0.1/api/v4/user')
    ).rejects.toBeInstanceOf(GitlabHostRefusedError)
    expect(guard.assertAllowed).toHaveBeenCalledWith('https://10.0.0.1/api/v4/user')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('never follows a redirect', async () => {
    const fetchFn = base(302, { location: 'http://169.254.169.254/latest' })
    const err = await safeFetch({ guard: allowAll, timeoutMs: 1000 }, fetchFn as unknown as FetchFn)(
      'https://gitlab.example.com/oauth/token',
      { method: 'POST' }
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitlabRedirectError)
    expect((err as GitlabRedirectError).status).toBe(302)
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual' })
  })

  it("adds a time limit, and keeps the caller's own signal", async () => {
    const fetchFn = base(200)
    const call = safeFetch({ guard: allowAll, timeoutMs: 1000 }, fetchFn as unknown as FetchFn)
    expect((await call('https://gitlab.example.com/a')).status).toBe(200)
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    const own = new AbortController().signal
    await call('https://gitlab.example.com/b', { signal: own })
    expect(fetchFn.mock.calls[1][1].signal).toBe(own)
  })

  it('aborts a call that takes longer than the limit', async () => {
    const hanging = jest.fn(
      async (_url: string, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason)
          })
        })
    )
    const err = await safeFetch(
      { guard: allowAll, timeoutMs: 10 },
      hanging as unknown as FetchFn
    )('https://gitlab.example.com/slow').catch((e: unknown) => e)
    expect((err as Error).name).toBe('TimeoutError')
  })
})

// GitLab with object storage answers an upload download with a redirect to the object store
describe('safeFetch: upload downloads', () => {
  const GITLAB = 'https://gitlab.internal'
  const UPLOAD = `${GITLAB}/api/v4/projects/5/uploads/abc/shot.png`

  function resolves (map: Record<string, string[]>): LookupFn {
    return async (hostname) => {
      const addresses = map[hostname]
      if (addresses === undefined) throw new Error(`ENOTFOUND ${hostname}`)
      return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
    }
  }

  // The GitLab host is trusted by the allow-list; the object store hosts are not on it
  const guard = new HostGuard(
    { allowInsecure: false, allowedHosts: ['gitlab.internal'] },
    resolves({
      'objects.example.com': ['93.184.216.34'],
      'cdn.example.com': ['93.184.216.35'],
      'minio.internal': ['10.0.0.5'],
      'mixed.example.com': ['93.184.216.36', '127.0.0.1']
    })
  )

  function guarded (fetchFn: jest.Mock, hostGuard: HostGuard = guard): FetchFn {
    return safeFetch({ guard: hostGuard, timeoutMs: 1000 }, fetchFn as unknown as FetchFn)
  }

  // Answers each URL with its redirect, or with the image
  function chain (redirects: Record<string, string>): jest.Mock {
    return jest.fn(async (url: string, _init?: RequestInit) => {
      const location = redirects[url]
      return location !== undefined
        ? new Response(null, { status: 302, headers: { location } })
        : new Response('img', { status: 200, headers: { 'content-type': 'image/png' } })
    })
  }

  function authorizationOf (call: unknown[]): string | null {
    return new Headers((call[1] as RequestInit).headers).get('authorization')
  }

  it('follows a redirect to a public object store, without the Authorization header', async () => {
    const store = 'https://objects.example.com/bucket/shot.png?X-Amz-Signature=s'
    const fetchFn = chain({ [UPLOAD]: store })
    const api = new GitlabApi(GITLAB, 'secret-token', guarded(fetchFn))
    const got = await api.downloadUpload(5, 'abc', 'shot.png', 100)
    expect(got).toEqual({ data: Buffer.from('img'), contentType: 'image/png' })
    expect(fetchFn.mock.calls.map((it) => it[0])).toEqual([UPLOAD, store])
    expect(authorizationOf(fetchFn.mock.calls[0])).toBe('Bearer secret-token')
    expect(authorizationOf(fetchFn.mock.calls[1])).toBeNull()
    expect(fetchFn.mock.calls[1][1]).toMatchObject({ redirect: 'manual' })
  })

  it('keeps the Authorization header on a same-origin redirect', async () => {
    const moved = `${GITLAB}/api/v4/projects/6/uploads/abc/shot.png`
    const fetchFn = chain({ [UPLOAD]: '/api/v4/projects/6/uploads/abc/shot.png' })
    const api = new GitlabApi(GITLAB, 'secret-token', guarded(fetchFn))
    await api.downloadUpload(5, 'abc', 'shot.png', 100)
    expect(fetchFn.mock.calls[1][0]).toBe(moved)
    expect(authorizationOf(fetchFn.mock.calls[1])).toBe('Bearer secret-token')
  })

  it.each([
    ['a private address', 'https://minio.internal/bucket/shot.png'],
    ['a host with one private address', 'https://mixed.example.com/shot.png'],
    ['a private IP literal', 'https://169.254.169.254/latest'],
    ['plain http', 'http://objects.example.com/shot.png'],
    ['an unknown host', 'https://nowhere.example.com/shot.png']
  ])('refuses a redirect to %s', async (_name, location) => {
    const fetchFn = chain({ [UPLOAD]: location })
    const api = new GitlabApi(GITLAB, 't', guarded(fetchFn))
    await expect(api.downloadUpload(5, 'abc', 'shot.png', 100)).rejects.toBeInstanceOf(GitlabHostRefusedError)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('follows at most three redirects', async () => {
    const hop = (n: number): string => `https://cdn.example.com/hop${n}`
    const three = chain({ [UPLOAD]: hop(1), [hop(1)]: hop(2), [hop(2)]: hop(3) })
    const viaThree = await new GitlabApi(GITLAB, 't', guarded(three)).downloadUpload(5, 'abc', 'shot.png', 100)
    expect(viaThree.data).toEqual(Buffer.from('img'))
    const four = chain({ [UPLOAD]: hop(1), [hop(1)]: hop(2), [hop(2)]: hop(3), [hop(3)]: hop(4) })
    const err = await new GitlabApi(GITLAB, 't', guarded(four))
      .downloadUpload(5, 'abc', 'shot.png', 100)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitlabRedirectError)
    expect(four).toHaveBeenCalledTimes(4)
  })

  it('refuses a redirect without a location', async () => {
    const fetchFn = jest.fn(async () => new Response(null, { status: 302 }))
    const err = await safeFetch({ guard, timeoutMs: 1000 }, fetchFn as unknown as FetchFn)(UPLOAD, {
      redirect: 'follow'
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitlabRedirectError)
  })

  it('accepts any redirect target in dev mode (GITLAB_ALLOW_INSECURE_HOSTS)', async () => {
    const dev = new HostGuard({ allowInsecure: true, allowedHosts: [] }, resolves({}))
    const upload = 'http://gitlab.local/api/v4/projects/5/uploads/abc/shot.png'
    const fetchFn = chain({ [upload]: 'http://minio.local/shot.png' })
    const api = new GitlabApi('http://gitlab.local', 't', guarded(fetchFn, dev))
    expect((await api.downloadUpload(5, 'abc', 'shot.png', 100)).data).toEqual(Buffer.from('img'))
  })

  it('keeps redirect = error for every other GitLab call', async () => {
    const fetchFn = chain({ [`${GITLAB}/api/v4/projects/5/issues/1`]: 'https://objects.example.com/x' })
    const api = new GitlabApi(GITLAB, 't', guarded(fetchFn))
    await expect(api.getIssue(5, 1)).rejects.toBeInstanceOf(GitlabRedirectError)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
