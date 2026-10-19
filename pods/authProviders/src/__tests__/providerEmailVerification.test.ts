import Router from 'koa-router'
import { Strategy as GitHubStrategy } from 'passport-github2'
import { registerGithub } from '../github'
import { registerGoogle } from '../google'
import { handleProviderAuth } from '../utils'

jest.mock('passport-google-oauth20', () => ({ Strategy: jest.fn() }))
jest.mock('passport-github2', () => ({ Strategy: jest.fn() }))
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  handleProviderAuth: jest.fn()
}))

function makeMeasureCtx (): any {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}

function setupProvider (provider: 'google' | 'github'): { measureCtx: any, passport: any, router: Router<any, any> } {
  const passport: any = { use: jest.fn(), authenticate: jest.fn() }
  const router = new Router<any, any>()
  const measureCtx = makeMeasureCtx()
  const register = provider === 'google' ? registerGoogle : registerGithub
  register(
    measureCtx,
    passport,
    router,
    'http://accounts.example.com',
    Promise.resolve({} as any),
    'http://front.example.com',
    {}
  )
  return { measureCtx, passport, router }
}

async function invokeProviderHandler (
  router: Router<any, any>,
  provider: 'google' | 'github',
  user: any
): Promise<void> {
  const layer = router.stack.find((entry) => entry.path === `/auth/${provider}/callback`)
  expect(layer).toBeDefined()
  await (layer as any).stack[1]({ query: {}, state: { user }, redirect: jest.fn() }, async () => {})
}

describe('provider email verification', () => {
  const env = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...env,
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GITHUB_CLIENT_ID: 'github-client-id',
      GITHUB_CLIENT_SECRET: 'github-client-secret'
    }
    ;(handleProviderAuth as jest.Mock).mockResolvedValue('http://front.example.com/login/auth')
  })

  afterEach(() => {
    process.env = env
  })

  test('Google passes an email to handleProviderAuth only when email_verified is true', async () => {
    const { router } = setupProvider('google')

    await invokeProviderHandler(router, 'google', {
      emails: [{ value: 'admin@example.com', verified: false }],
      name: { givenName: 'Ada', familyName: 'Lovelace' }
    })
    expect(handleProviderAuth).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'google',
      undefined,
      expect.anything(),
      undefined,
      'Ada',
      'Lovelace',
      expect.anything(),
      undefined
    )

    await invokeProviderHandler(router, 'google', {
      emails: [{ value: 'admin@example.com', verified: true }],
      name: { givenName: 'Ada', familyName: 'Lovelace' }
    })
    expect(handleProviderAuth).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'google',
      undefined,
      expect.anything(),
      'admin@example.com',
      'Ada',
      'Lovelace',
      expect.anything(),
      undefined
    )
  })

  test('GitHub passes only a primary verified email from its fetched emails API response', async () => {
    const { router } = setupProvider('github')

    expect(GitHubStrategy).toHaveBeenCalledWith(expect.objectContaining({ allRawEmails: true }), expect.any(Function))

    await invokeProviderHandler(router, 'github', {
      emails: [
        { value: 'unverified@example.com', primary: true, verified: false },
        { value: 'non-primary@example.com', primary: false, verified: true }
      ],
      username: 'octocat'
    })
    expect(handleProviderAuth).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'github',
      undefined,
      expect.anything(),
      undefined,
      'octocat',
      '',
      expect.anything(),
      undefined
    )

    await invokeProviderHandler(router, 'github', {
      emails: [{ value: 'admin@example.com', primary: true, verified: true }],
      username: 'octocat'
    })
    expect(handleProviderAuth).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'github',
      undefined,
      expect.anything(),
      'admin@example.com',
      'octocat',
      '',
      expect.anything(),
      undefined
    )
  })

  test('GitHub treats an email without fetched primary and verification metadata as unverified', async () => {
    const { router } = setupProvider('github')

    await invokeProviderHandler(router, 'github', {
      emails: [{ value: 'profile@example.com' }],
      username: 'octocat'
    })

    expect(handleProviderAuth).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'github',
      undefined,
      expect.anything(),
      undefined,
      'octocat',
      '',
      expect.anything(),
      undefined
    )
  })

  test.each([
    ['state from another browser', 'another-browser-nonce', 'mismatch'],
    ['missing state cookie', undefined, 'missing_cookie']
  ])('%s is rejected before provider authentication', async (_scenario, cookieNonce, reason) => {
    for (const provider of ['google', 'github'] as const) {
      const { measureCtx, passport, router } = setupProvider(provider)
      passport.authenticate.mockReturnValue(async () => {})
      const layer = router.stack.find((entry) => entry.path === `/auth/${provider}/callback`)
      expect(layer).toBeDefined()
      const koaCtx: any = {
        query: { state: encodeURIComponent(JSON.stringify({ nonce: 'state-nonce' })) },
        state: {},
        cookies: { get: jest.fn().mockReturnValue(cookieNonce), set: jest.fn() },
        redirect: jest.fn()
      }

      await (layer as any).stack[0](koaCtx, async () => {})

      expect(passport.authenticate).not.toHaveBeenCalled()
      expect(koaCtx.redirect).toHaveBeenCalledWith('http://front.example.com/login')
      expect(measureCtx.warn).toHaveBeenCalledWith('auth state rejected', { provider, reason })
      expect(koaCtx.cookies.get).toHaveBeenCalledWith('auth_state_token', { signed: true })
      expect(koaCtx.cookies.set).toHaveBeenCalledWith(
        'auth_state_token',
        null,
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', signed: true, secure: false })
      )
    }
  })
})
