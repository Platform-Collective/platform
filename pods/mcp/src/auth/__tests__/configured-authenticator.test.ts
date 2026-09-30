/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { type AccountClient } from '@hcengineering/account-client'
import { type AccountUuid, type PersonUuid, type WorkspaceUuid } from '@hcengineering/core'
import { generateToken } from '@hcengineering/server-token'

import { fakeMeasureContext } from '../../__tests__/test-doubles'
import { loadConfig } from '../../config'
import { ConfiguredAuthenticator } from '../configured-authenticator'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const WORKSPACE = '22222222-2222-4222-8222-222222222222'
const workspaceToken = generateToken(ACCOUNT as PersonUuid, WORKSPACE as WorkspaceUuid)

const accountLevelInfo = { account: ACCOUNT as AccountUuid, token: 'account-level-token' }
const workspaceInfo = {
  account: ACCOUNT as AccountUuid,
  workspace: WORKSPACE as WorkspaceUuid,
  workspaceUrl: 'my-space',
  endpoint: 'ws://localhost:3333',
  token: workspaceToken,
  role: 1
}

interface Calls {
  selectWorkspace: string[]
  createdWith: Array<string | undefined>
}

function fakeClientFactory (
  overrides: Partial<Record<'getLoginInfoByToken' | 'login', () => Promise<unknown>>>,
  calls: Calls
): (url: string, token?: string) => AccountClient {
  return (_url, token) => {
    calls.createdWith.push(token)
    const client = {
      getLoginInfoByToken: overrides.getLoginInfoByToken ?? (async () => accountLevelInfo),
      login: overrides.login ?? (async () => accountLevelInfo),
      selectWorkspace: async (workspaceUrl: string) => {
        calls.selectWorkspace.push(workspaceUrl)
        return workspaceInfo
      }
    }
    return client as unknown as AccountClient
  }
}

const config = (env: Record<string, string>): ReturnType<typeof loadConfig> =>
  loadConfig({ SECRET: 'not-the-default', ...env })

describe('ConfiguredAuthenticator', () => {
  it('exchanges an account-level HULY_TOKEN for a workspace token', async () => {
    const calls: Calls = { selectWorkspace: [], createdWith: [] }
    const auth = new ConfiguredAuthenticator(
      fakeMeasureContext(),
      config({ HULY_TOKEN: 'static', HULY_WORKSPACE: 'my-space' }),
      fakeClientFactory({}, calls)
    )

    const identity = await auth.authenticate()

    expect(calls.selectWorkspace).toEqual(['my-space'])
    expect(calls.createdWith).toEqual(['static', 'static'])
    expect(identity.workspace).toBe(WORKSPACE)
    expect(identity.workspaceToken).toBe(workspaceToken)
    expect(identity.transactorUrl).toBe('http://localhost:3333')
  })

  it('logs in with email and password, then selects the workspace using the login token', async () => {
    const calls: Calls = { selectWorkspace: [], createdWith: [] }
    const auth = new ConfiguredAuthenticator(
      fakeMeasureContext(),
      config({ HULY_EMAIL: 'a@example.test', HULY_PASSWORD: 'pw', HULY_WORKSPACE: 'my-space' }),
      fakeClientFactory({}, calls)
    )

    await auth.authenticate()

    expect(calls.createdWith).toEqual([undefined, 'account-level-token'])
    expect(calls.selectWorkspace).toEqual(['my-space'])
  })

  it('uses a workspace-scoped token as is, without selecting again', async () => {
    const calls: Calls = { selectWorkspace: [], createdWith: [] }
    const auth = new ConfiguredAuthenticator(
      fakeMeasureContext(),
      config({ HULY_TOKEN: 'static', HULY_WORKSPACE: 'my-space' }),
      fakeClientFactory({ getLoginInfoByToken: async () => workspaceInfo }, calls)
    )

    await auth.authenticate()

    expect(calls.selectWorkspace).toEqual([])
  })

  it('explains that HULY_WORKSPACE is needed when the token is not workspace-bound', async () => {
    const calls: Calls = { selectWorkspace: [], createdWith: [] }
    const auth = new ConfiguredAuthenticator(fakeMeasureContext(), config({ HULY_TOKEN: 'static' }), fakeClientFactory({}, calls))

    await expect(auth.authenticate()).rejects.toThrow(/HULY_WORKSPACE/)
  })

  it('rejects a login that returns no token, such as one that needs two-factor', async () => {
    const calls: Calls = { selectWorkspace: [], createdWith: [] }
    const auth = new ConfiguredAuthenticator(
      fakeMeasureContext(),
      config({ HULY_EMAIL: 'a@example.test', HULY_PASSWORD: 'pw', HULY_WORKSPACE: 'my-space' }),
      fakeClientFactory({ login: async () => ({ account: ACCOUNT, tfaRequired: true }) }, calls)
    )

    await expect(auth.authenticate()).rejects.toThrow(/rejected/)
  })

  it('caches the resolved identity', async () => {
    const calls: Calls = { selectWorkspace: [], createdWith: [] }
    const auth = new ConfiguredAuthenticator(
      fakeMeasureContext(),
      config({ HULY_TOKEN: 'static', HULY_WORKSPACE: 'my-space' }),
      fakeClientFactory({}, calls)
    )

    await auth.authenticate()
    await auth.authenticate()

    expect(calls.selectWorkspace).toHaveLength(1)
  })
})
