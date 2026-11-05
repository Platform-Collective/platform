// SPDX-License-Identifier: EPL-2.0

import type { Client, PersonId } from '@hcengineering/core'
import { getSavedMyIssuesScope } from './saved-view'

jest.mock('@hcengineering/contact', () => ({
  __esModule: true,
  default: { class: { SocialIdentity: 'social-identity', Person: 'person' } }
}))

const CREATOR = 'author-email' as PersonId
const findOne = jest.fn()
const findAll = jest.fn()
const client = { findOne, findAll } as unknown as Client

describe('saved My Issues scope', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    findOne.mockImplementation(async (_class, query) =>
      _class === 'social-identity'
        ? { _id: query._id, attachedTo: 'author-person' }
        : { _id: query._id, personUuid: 'author-account' }
    )
    findAll.mockResolvedValue([{ _id: CREATOR }, { _id: 'author-github' }])
  })

  it('resolves the creator identities, assignee and subscription account for another viewer', async () => {
    expect(await getSavedMyIssuesScope(client, CREATOR)).toEqual({
      employee: 'author-person',
      socialIds: ['author-email', 'author-github'],
      account: 'author-account'
    })
    expect(findOne.mock.calls).toEqual([
      ['social-identity', { _id: CREATOR }],
      ['person', { _id: 'author-person' }]
    ])
    expect(findAll).toHaveBeenCalledWith('social-identity', { attachedTo: 'author-person' })
  })

  it('keeps all creator identities when the view was created with a secondary identity', async () => {
    const result = await getSavedMyIssuesScope(client, 'author-github' as PersonId)
    expect(new Set(result.socialIds)).toEqual(new Set(['author-email', 'author-github']))
    expect(result.employee).toBe('author-person')
    expect(result.account).toBe('author-account')
  })

  it('uses current identity data each time instead of storing issue or status IDs', async () => {
    await getSavedMyIssuesScope(client, CREATOR)
    findAll.mockResolvedValue([{ _id: CREATOR }, { _id: 'author-new-identity' }])
    expect((await getSavedMyIssuesScope(client, CREATOR)).socialIds).toEqual([CREATOR, 'author-new-identity'])
    expect(findAll.mock.calls.every(([_class]) => _class === 'social-identity')).toBe(true)
  })

  it('preserves the creator ID if its social identity has been removed', async () => {
    findOne.mockResolvedValue(undefined)
    expect(await getSavedMyIssuesScope(client, CREATOR)).toEqual({
      employee: null,
      socialIds: [CREATOR],
      account: undefined
    })
    expect(findAll).not.toHaveBeenCalled()
  })

  it('does not substitute the viewer when the creator person has been removed', async () => {
    findOne.mockImplementation(async (_class) =>
      _class === 'social-identity' ? { attachedTo: 'removed-person' } : undefined
    )
    expect(await getSavedMyIssuesScope(client, CREATOR)).toEqual({
      employee: null,
      socialIds: ['author-email', 'author-github'],
      account: undefined
    })
  })

  it('does not substitute the viewer subscription account if the creator has none', async () => {
    findOne.mockImplementation(async (_class) =>
      _class === 'social-identity' ? { attachedTo: 'author-person' } : { _id: 'author-person' }
    )
    expect((await getSavedMyIssuesScope(client, CREATOR)).account).toBeUndefined()
  })

  it('propagates identity lookup failures to the component error handler', async () => {
    const error = new Error('Identity lookup failed')
    findOne.mockRejectedValue(error)
    await expect(getSavedMyIssuesScope(client, CREATOR)).rejects.toBe(error)
  })
})
