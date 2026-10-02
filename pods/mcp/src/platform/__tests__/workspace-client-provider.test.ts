// SPDX-License-Identifier: EPL-2.0

import { type TxOperations } from '@hcengineering/core'

import { fakeIdentity, fakeMeasureContext } from '../../__tests__/test-doubles'
import { type SessionIdentity } from '../../auth/authenticator'
import { type AccountApi, type AccountApiFactory } from '../account-api'
import { CachingWorkspaceClientProvider, type ClientFactory } from '../workspace-client-provider'

/** A client stub that is only good enough to be closed during teardown. */
const fakeClient = (): TxOperations => {
  const client = { close: async () => {} }
  return client as unknown as TxOperations
}

const createAccounts: AccountApiFactory = () => Object.create(null) as AccountApi

interface ProviderHarness {
  provider: CachingWorkspaceClientProvider
  /** One entry per client build, in call order — proves how many cache entries were filled. */
  built: SessionIdentity[]
}

const makeProvider = (): ProviderHarness => {
  const built: SessionIdentity[] = []
  const createClient: ClientFactory = async (identity) => {
    built.push(identity)
    return fakeClient()
  }

  const provider = new CachingWorkspaceClientProvider({
    ctx: fakeMeasureContext(),
    createClient,
    createAccounts,
    // Long enough that the sweeper never fires inside a test.
    sweepIntervalMs: 600_000
  })
  return { provider, built }
}

describe('CachingWorkspaceClientProvider cache key', () => {
  it('serves a read-only identity from its own entry, not from a full-access one', async () => {
    const { provider, built } = makeProvider()
    const full = fakeIdentity({ workspaceToken: 'full-token' })
    const readOnly = fakeIdentity({ readOnly: true, workspaceToken: 'read-only-token' })

    // The full-access identity fills the cache first — the scenario from the
    // review: the read-only request must NOT inherit that entry.
    await provider.get(full)
    const readOnlySession = await provider.get(readOnly)

    expect(readOnlySession.identity.readOnly).toBe(true)
    expect(readOnlySession.identity.workspaceToken).toBe('read-only-token')
    expect(provider.size).toBe(2)
    expect(built.map((identity) => identity.readOnly)).toEqual([false, true])

    await provider.close()
  })

  it('hands out the requesting identity even when the cache is already warm', async () => {
    const { provider, built } = makeProvider()
    await provider.get(fakeIdentity({ workspaceToken: 'first-token' }))
    const session = await provider.get(fakeIdentity({ workspaceToken: 'second-token' }))

    // Same privilege class means one shared client, but the identity a tool
    // sees (and the write gate reads) belongs to THIS request.
    expect(built).toHaveLength(1)
    expect(session.identity.workspaceToken).toBe('second-token')
    expect(provider.size).toBe(1)

    await provider.close()
  })

  it('still collapses concurrent first-hits into a single build', async () => {
    const { provider, built } = makeProvider()
    const identity = fakeIdentity()

    const [first, second] = await Promise.all([provider.get(identity), provider.get(identity)])

    expect(built).toHaveLength(1)
    expect(first.client).toBe(second.client)

    await provider.close()
  })
})
