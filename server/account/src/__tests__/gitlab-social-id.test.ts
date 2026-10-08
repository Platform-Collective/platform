// SPDX-License-Identifier: EPL-2.0
jest.mock('@hcengineering/platform', () => {
  const actual = jest.requireActual('@hcengineering/platform')
  return { ...actual, ...actual.default, getMetadata: jest.fn() }
})

jest.mock('@hcengineering/server-token', () => ({
  decodeTokenVerbose: jest.fn(),
  decodeToken: jest.fn(),
  generateToken: jest.fn()
}))

/* eslint-disable import/first */
import { type MeasureContext, type PersonId, type PersonUuid, SocialIdType } from '@hcengineering/core'
import { decodeTokenVerbose } from '@hcengineering/server-token'
import { getMigrations } from '../collections/postgres/migrations'
import { ensurePerson } from '../operations'
import { addSocialIdToPerson } from '../serviceOperations'
import type { AccountDB } from '../types'
import * as utils from '../utils'

const ctx = { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as unknown as MeasureContext

describe('GitLab social ids', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({ account: 'svc', extra: { service: 'gitlab' } })
  })

  it('has a gitlab social id type', () => {
    expect(SocialIdType.GITLAB).toBe('gitlab')
  })

  it('lets the gitlab service ensure a person without a workspace role check', async () => {
    const db = {
      socialId: { findOne: jest.fn(async () => ({ _id: 'sid-1' as PersonId, personUuid: 'p-1' as PersonUuid })) },
      getWorkspaceRole: jest.fn()
    } as unknown as AccountDB
    const result = await ensurePerson(ctx, db, null, 'token', {
      socialType: SocialIdType.GITLAB,
      socialValue: '42@gitlab.com',
      firstName: 'Alice',
      lastName: ''
    })
    expect(result).toEqual({ uuid: 'p-1', socialId: 'sid-1' })
    expect((db as any).getWorkspaceRole).not.toHaveBeenCalled()
  })

  it('lets the gitlab service add a social id to a person', async () => {
    const spy = jest.spyOn(utils, 'addSocialIdBase').mockResolvedValue('sid-2' as PersonId)
    const result = await addSocialIdToPerson(ctx, {} as unknown as AccountDB, null, 'token', {
      person: 'p-1' as PersonUuid,
      type: SocialIdType.GITLAB,
      value: '42@gitlab.com',
      confirmed: true,
      displayValue: 'alice'
    })
    expect(result).toBe('sid-2')
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'p-1', SocialIdType.GITLAB, '42@gitlab.com', true, 'alice')
    spy.mockRestore()
  })

  it.each(['postgres', 'cockroach'] as const)('migrates the %s social_id_type enum', (flavor) => {
    const migration = getMigrations('global_account', flavor).find(([key]) => key === 'account_db_v30_add_gitlab_social_id_type')
    expect(migration).toBeDefined()
    expect(migration?.[1]).toContain("'gitlab'")
  })
})
