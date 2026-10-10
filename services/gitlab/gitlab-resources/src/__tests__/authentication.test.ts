// SPDX-License-Identifier: EPL-2.0

import { type Account } from '@hcengineering/core'
import { type GitlabAuthentication } from '@hcengineering/gitlab'

interface FakeQuery {
  query: jest.Mock
  unsubscribe: jest.Mock
}

const queries: FakeQuery[] = []

jest.mock('@hcengineering/presentation', () => ({
  createQuery: () => {
    const query: FakeQuery = { query: jest.fn(), unsubscribe: jest.fn() }
    queries.push(query)
    return query
  }
}))

describe('gitlabAuthentication', () => {
  beforeEach(() => {
    queries.length = 0
    jest.resetModules()
  })

  it('loads without a signed-in account (the OAuth landing tab has no session)', async () => {
    await expect(import('../components/authentication')).resolves.toBeDefined()
    expect(queries).toHaveLength(0)
  })

  it("queries the current account's authentication while subscribed", async () => {
    // resetModules gives the module under test a fresh core, so the account is set on that instance
    const core: { setCurrentAccount: (account: Account) => void } = await import('@hcengineering/core')
    core.setCurrentAccount({ primarySocialId: 'social-1' } as unknown as Account)
    const { gitlabAuthentication } = await import('../components/authentication')
    const seen: Array<GitlabAuthentication | undefined> = []

    const unsubscribe = gitlabAuthentication.subscribe((value) => seen.push(value))
    expect(queries).toHaveLength(1)
    const [, filter, onResult] = queries[0].query.mock.calls[0]
    expect(filter).toEqual({ attachedTo: 'social-1' })

    const authentication = { login: 'octocat' } as unknown as GitlabAuthentication
    onResult([authentication])
    expect(seen).toEqual([undefined, authentication])

    unsubscribe()
    expect(queries[0].unsubscribe).toHaveBeenCalled()
  })
})
