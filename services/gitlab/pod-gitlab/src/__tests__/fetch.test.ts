// SPDX-License-Identifier: EPL-2.0
import { createSafeFetch, SafeFetchError, type Lookup, type SafeFetchErrorCode } from '@hcengineering/safe-fetch'
import http from 'http'
import { type AddressInfo } from 'net'
import { type FetchFn, GitlabApi } from '../gitlab/api'
import {
  assertGitlabHostAllowed,
  createGitlabFetch,
  gitlabSafeFetchOptions,
  MAX_REDIRECTS,
  type GitlabHostPolicy
} from '../gitlab/fetch'

const strict: GitlabHostPolicy = { allowInsecure: false, allowedHosts: [] }
const dev: GitlabHostPolicy = { allowInsecure: true, allowedHosts: [] }

function resolves (map: Record<string, string[]>): Lookup {
  return async (hostname) => {
    const addresses = map[hostname]
    if (addresses === undefined) throw new Error(`ENOTFOUND ${hostname}`)
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
}

async function codeOf (promise: Promise<unknown>): Promise<SafeFetchErrorCode | undefined> {
  try {
    await promise
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code
    throw err
  }
  return undefined
}

describe('createGitlabFetch', () => {
  function base (): jest.Mock {
    return jest.fn(async (_url: string, _init?: RequestInit) => new Response('body', { status: 200 }))
  }

  it('with GITLAB_ALLOWED_HOSTS calls only the listed hosts', async () => {
    const policy = { allowInsecure: false, allowedHosts: ['git.corp.example'] }
    const fetchFn = base()
    const call = createGitlabFetch(policy, 1000, fetchFn)
    expect((await call('https://Git.Corp.Example/api/v4/user')).status).toBe(200)
    expect(await codeOf(call('https://gitlab.com/api/v4/user'))).toBe('BLOCKED_HOST')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('never follows a redirect unless the call asks for it', async () => {
    const fetchFn = base()
    const call = createGitlabFetch(strict, 1000, fetchFn)
    await call('https://gitlab.example.com/oauth/token', { method: 'POST' })
    await call('https://gitlab.example.com/uploads/x', { redirect: 'follow' })
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(fetchFn.mock.calls[1][1]).toMatchObject({ redirect: 'follow' })
  })

  it('names the GitLab host, not its address, when the connection fails', async () => {
    const fetchFn = jest.fn(async () => {
      throw new SafeFetchError('FETCH_FAILED', 'Request failed: connect ECONNREFUSED 10.0.0.5:443', 'https://x')
    })
    const err = await createGitlabFetch(
      strict,
      1000,
      fetchFn
    )('https://gitlab.example.com/api/v4/user').catch((e: unknown) => e)
    expect((err as SafeFetchError).code).toBe('FETCH_FAILED')
    expect((err as SafeFetchError).message).toBe('Request to GitLab host gitlab.example.com failed')
    expect((err as SafeFetchError).url).toBeUndefined()
  })
})

describe('assertGitlabHostAllowed', () => {
  const lookup = resolves({
    'gitlab.example.com': ['93.184.216.34'],
    'git.corp.example': ['10.0.0.5'],
    'mixed.example.com': ['93.184.216.36', '127.0.0.1'],
    localhost: ['127.0.0.1']
  })

  async function check (url: string, policy: GitlabHostPolicy): Promise<SafeFetchErrorCode | undefined> {
    return await codeOf(assertGitlabHostAllowed(url, policy, lookup))
  }

  it('accepts a host whose every address is public', async () => {
    expect(await check('https://gitlab.example.com', strict)).toBeUndefined()
  })

  it.each([
    ['a private address', 'https://git.corp.example', 'BLOCKED_ADDRESS'],
    ['a host with one private address', 'https://mixed.example.com', 'BLOCKED_ADDRESS'],
    ['a private IP literal', 'https://169.254.169.254', 'BLOCKED_ADDRESS'],
    ['localhost', 'https://localhost', 'BLOCKED_HOST'],
    ['plain http', 'http://gitlab.example.com', 'INVALID_PROTOCOL']
  ])('refuses %s', async (_name, url, code) => {
    expect(await check(url, strict)).toBe(code)
  })

  it('names the refused host, never the addresses it resolves to', async () => {
    const err = await assertGitlabHostAllowed('https://mixed.example.com', strict, lookup).catch((e: unknown) => e)
    expect((err as Error).message).toBe('GitLab host mixed.example.com is not allowed')
  })

  it('names the host of a valid URL that safe-fetch refuses before resolving it', async () => {
    await expect(assertGitlabHostAllowed('https://10.0.0.1', strict, lookup)).rejects.toThrow(
      'GitLab host 10.0.0.1 is not allowed'
    )
    await expect(assertGitlabHostAllowed('http://gitlab.example.com', strict, lookup)).rejects.toThrow(
      'GitLab host gitlab.example.com is not allowed'
    )
    await expect(assertGitlabHostAllowed('not a url', strict, lookup)).rejects.toThrow('Invalid GitLab URL')
    expect(await codeOf(assertGitlabHostAllowed('ftp://x', strict))).toBe('INVALID_PROTOCOL')
  })

  it('with GITLAB_ALLOWED_HOSTS accepts only the listed hosts, private ones included', async () => {
    const policy = { allowInsecure: false, allowedHosts: ['git.corp.example'] }
    expect(await check('https://git.corp.example', policy)).toBeUndefined()
    expect(await check('https://gitlab.example.com', policy)).toBe('BLOCKED_HOST')
  })

  it('accepts plain http and private hosts in dev mode (GITLAB_ALLOW_INSECURE_HOSTS)', async () => {
    expect(await check('http://git.corp.example', dev)).toBeUndefined()
    expect(await check('http://localhost', dev)).toBeUndefined()
  })
})

// GitLab with object storage answers an upload download with a redirect to the object store
describe('createGitlabFetch: upload downloads', () => {
  interface Server {
    origin: string
    authorization: Array<string | undefined>
    close: () => Promise<void>
  }

  // Answers each path with its redirect, or with the image
  async function serve (redirects: Record<string, string>): Promise<Server> {
    const authorization: Array<string | undefined> = []
    const server = http.createServer((req, res) => {
      authorization.push(req.headers.authorization)
      const location = redirects[req.url ?? '']
      if (location !== undefined) {
        res.writeHead(302, { location }).end()
      } else {
        res.writeHead(200, { 'content-type': 'image/png' }).end('img')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return {
      origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      authorization,
      close: async () => {
        await new Promise((resolve) => server.close(resolve))
      }
    }
  }

  const UPLOAD = '/api/v4/projects/5/uploads/abc/shot.png'
  const servers: Server[] = []
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(async (it) => {
        await it.close()
      })
    )
  })

  async function start (redirects: Record<string, string>): Promise<Server> {
    const server = await serve(redirects)
    servers.push(server)
    return server
  }

  // Local test servers are private addresses over http: dev mode lets the pod reach them
  function api (gitlab: Server, policy: GitlabHostPolicy = dev): GitlabApi {
    const fetchFn: FetchFn = createGitlabFetch(policy, 1000)
    return new GitlabApi(gitlab.origin, 'secret-token', fetchFn)
  }

  it('follows a redirect to another origin, without the Authorization header', async () => {
    const store = await start({})
    const gitlab = await start({ [UPLOAD]: `${store.origin}/bucket/shot.png` })
    const got = await api(gitlab).downloadUpload(5, 'abc', 'shot.png', 100)
    expect(got).toEqual({ data: Buffer.from('img'), contentType: 'image/png' })
    expect(gitlab.authorization).toEqual(['Bearer secret-token'])
    expect(store.authorization).toEqual([undefined])
  })

  it('keeps the Authorization header on a same-origin redirect', async () => {
    const gitlab = await start({ [UPLOAD]: '/api/v4/projects/6/uploads/abc/shot.png' })
    await api(gitlab).downloadUpload(5, 'abc', 'shot.png', 100)
    expect(gitlab.authorization).toEqual(['Bearer secret-token', 'Bearer secret-token'])
  })

  it('refuses a redirect to a private address outside dev mode', async () => {
    const gitlab = await start({ [UPLOAD]: 'https://169.254.169.254/latest' })
    // The listed GitLab host may be private; the object store it redirects to may not
    const policy = { allowInsecure: false, allowedHosts: ['127.0.0.1'] }
    const options = { ...gitlabSafeFetchOptions(policy, 1000), allowHttp: true }
    const call = new GitlabApi(gitlab.origin, 't', createGitlabFetch(policy, 1000, createSafeFetch(options)))
    const err = await call.downloadUpload(5, 'abc', 'shot.png', 100).catch((e: unknown) => e)
    expect((err as SafeFetchError).code).toBe('BLOCKED_ADDRESS')
    // Neither the redirect target nor its address reaches the caller
    expect((err as SafeFetchError).message).toBe('GitLab host 127.0.0.1, or a host it redirected to, is not allowed')
    expect((err as SafeFetchError).url).toBeUndefined()
  })

  it(`follows at most ${MAX_REDIRECTS} redirects`, async () => {
    const hops = (count: number): Record<string, string> =>
      Object.fromEntries(
        Array.from({ length: count }, (_, n) => [n === 0 ? UPLOAD : `/hop${n}`, `/hop${n + 1}`] as const)
      )
    const three = await start(hops(MAX_REDIRECTS))
    expect((await api(three).downloadUpload(5, 'abc', 'shot.png', 100)).data).toEqual(Buffer.from('img'))
    const four = await start(hops(MAX_REDIRECTS + 1))
    expect(await codeOf(api(four).downloadUpload(5, 'abc', 'shot.png', 100))).toBe('TOO_MANY_REDIRECTS')
  })

  it('refuses a redirect on every other GitLab call', async () => {
    const gitlab = await start({ '/api/v4/projects/5/issues/1': '/elsewhere' })
    const err = await api(gitlab)
      .getIssue(5, 1)
      .catch((e: unknown) => e)
    expect((err as SafeFetchError).code).toBe('REDIRECT_NOT_ALLOWED')
    expect((err as SafeFetchError).message).not.toContain('/elsewhere')
    expect(gitlab.authorization).toHaveLength(1)
  })
})
