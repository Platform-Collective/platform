// SPDX-License-Identifier: EPL-2.0

import {
  AccountRole,
  SocialIdType,
  type AccountUuid,
  type MeasureContext,
  type WorkspaceUuid
} from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { decodeToken, generateToken } from '@hcengineering/server-token'
import { authenticator } from 'otplib'

import { createWorkspace, leaveWorkspace, verify2fa } from '../operations'
import * as admin from '../admin'
import { accountPlugin } from '../plugin'
import { type AccountDB } from '../types'
import { joinWithProvider, loginOrSignUpWithProvider, reissueToken, selectWorkspace } from '../utils'

const account = '11111111-1111-4111-8111-111111111111' as AccountUuid
const workspace = '22222222-2222-4222-8222-222222222222' as WorkspaceUuid
const subject = '33333333-3333-4333-8333-333333333333' as AccountUuid
const nil = '00000000-0000-0000-0000-000000000000' as AccountUuid
const ctx = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as MeasureContext
const secret = authenticator.generateSecret()

function makeDb (): AccountDB {
  const socialId = { _id: 1, personUuid: account, type: SocialIdType.OIDC, value: 'subject', verifiedOn: 1 }
  return {
    person: { findOne: jest.fn().mockResolvedValue({ uuid: account, firstName: 'Test', lastName: 'User' }) },
    account: { findOne: jest.fn().mockResolvedValue({ uuid: account, tfaSecret: secret }) },
    socialId: {
      findOne: jest.fn().mockResolvedValue(socialId),
      find: jest.fn().mockImplementation(async (query) => (query.type === SocialIdType.HULY ? [] : [socialId]))
    },
    workspace: {
      findOne: jest.fn().mockResolvedValue({ uuid: workspace, url: 'test', region: '' }),
      find: jest.fn().mockResolvedValue([])
    },
    workspaceStatus: { findOne: jest.fn().mockResolvedValue(null) },
    invite: {
      findOne: jest.fn().mockResolvedValue({
        id: 'invite',
        workspaceUuid: workspace,
        role: AccountRole.User,
        remainingUses: 2
      }),
      update: jest.fn().mockResolvedValue(undefined)
    },
    createWorkspace: jest.fn().mockResolvedValue(workspace),
    assignWorkspace: jest.fn().mockResolvedValue(undefined),
    unassignWorkspace: jest.fn().mockResolvedValue(undefined),
    getWorkspaceRole: jest.fn().mockResolvedValue(AccountRole.User)
  } as unknown as AccountDB
}

describe('bounded provider sessions', () => {
  beforeEach(() => {
    setMetadata(accountPlugin.metadata.Transactors, 'ws://localhost:3333')
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('reissue retains deadlines and extras, drops sub/grant and keeps the existing account', () => {
    const exp = Math.floor(Date.now() / 1000) + 120
    const nbf = exp - 120
    const original = generateToken(account, workspace, { authMethod: 'oidc' }, undefined, {
      exp,
      nbf,
      sub: subject,
      grant: { workspace, role: AccountRole.Guest }
    })
    expect(decodeToken(reissueToken(decodeToken(original)))).toEqual({
      account,
      extra: { authMethod: 'oidc' },
      exp,
      nbf
    })
  })

  test('an unbounded token is byte-identical to the legacy mint', () => {
    const original = generateToken(account, workspace, { admin: 'true' })
    expect(reissueToken(decodeToken(original))).toBe(generateToken(account, undefined, { admin: 'true' }))
  })

  test.each([SocialIdType.OIDC, SocialIdType.GOOGLE, SocialIdType.GITHUB])('%s stays unbounded', async (type) => {
    const result = await loginOrSignUpWithProvider(ctx, makeDb(), null, 'test@example.com', 'Test', 'User', {
      type,
      value: 'subject'
    })
    expect(result?.token).toBe(generateToken(account, undefined, {}))
  })

  test('configured login and invite preserve expiry and OIDC extras through workspace selection', async () => {
    const db = makeDb()
    const exp = Math.floor(Date.now() / 1000) + 120
    const options = { exp, authMethod: 'oidc' }
    jest.spyOn(admin, 'isAdminEmail').mockReturnValue(true)
    const login = await loginOrSignUpWithProvider(
      ctx,
      db,
      null,
      'test@example.com',
      'Test',
      'User',
      { type: SocialIdType.OIDC, value: 'subject' },
      false,
      options
    )
    expect(decodeToken(login?.token ?? '')).toEqual({ account, extra: { authMethod: 'oidc', admin: 'true' }, exp })
    const selected = await selectWorkspace(ctx, db, null, login?.token ?? '', {
      workspaceUrl: 'test',
      kind: 'external'
    })
    expect(decodeToken(selected.token ?? '')).toMatchObject({
      account,
      workspace,
      exp,
      extra: { authMethod: 'oidc', admin: 'true' }
    })
    const invited = await joinWithProvider(
      ctx,
      db,
      null,
      'test@example.com',
      'Test',
      'User',
      'invite',
      { type: SocialIdType.OIDC, value: 'subject' },
      false,
      options
    )
    expect(decodeToken(invited?.token ?? '')).toMatchObject({
      account,
      workspace,
      exp,
      extra: { authMethod: 'oidc', admin: 'true' }
    })
  })

  test('creating and leaving workspaces retain deadlines', async () => {
    const db = makeDb()
    const exp = Math.floor(Date.now() / 1000) + 120
    const nbf = exp - 120
    const token = generateToken(account, undefined, { authMethod: 'oidc' }, undefined, { exp, nbf })
    const created = await createWorkspace(ctx, db, null, token, { workspaceName: 'Session test' })
    expect(decodeToken(created.token ?? '')).toMatchObject({
      account,
      workspace,
      exp,
      nbf,
      extra: { authMethod: 'oidc' }
    })
    const left = await leaveWorkspace(ctx, db, null, created.token ?? '', { account })
    expect(decodeToken(left?.token ?? '')).toEqual({ account, exp, nbf, extra: { authMethod: 'oidc' } })
  })

  test.each(['password', 'otp'])('%s 2FA resolves the NIL-account challenge with or without expiry', async (method) => {
    const db = makeDb()
    for (const exp of [undefined, Math.floor(Date.now() / 1000) + 120]) {
      const extra: Record<string, string> = method === 'password' ? { authMethod: 'password' } : {}
      const challenge = generateToken(nil, undefined, { ...extra, tfaAccount: account }, undefined, { exp })
      const login = await verify2fa(ctx, db, null, challenge, { code: authenticator.generate(secret) })
      expect(login.account).toBe(account)
      expect(login.token).toBe(generateToken(account, undefined, extra, undefined, { exp }))
      const selected = await selectWorkspace(ctx, db, null, login.token ?? '', {
        workspaceUrl: 'test',
        kind: 'external'
      })
      expect(decodeToken(selected.token ?? '')).toMatchObject({ account, workspace })
      expect(decodeToken(selected.token ?? '').exp).toBe(exp)
      expect(decodeToken(selected.token ?? '').extra?.tfaAccount).toBeUndefined()
    }
  })
})
