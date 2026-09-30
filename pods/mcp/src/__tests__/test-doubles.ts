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

import { type AccountUuid, type MeasureContext, type TxOperations, type WorkspaceUuid } from '@hcengineering/core'

import { type SessionIdentity } from '../auth/authenticator'
import { type WorkspaceSession } from '../platform/workspace-client-provider'
import { toolContext, type ToolContext } from '../mcp/tool'

/**
 * Test doubles for the MCP layer.
 *
 * The assertions here deliberately go through a named variable rather than an
 * inline object literal, because the repository's ESLint config forbids
 * asserting an object literal (`consistent-type-assertions`). Keeping the casts
 * in one file also means the protocol tests stay free of Huly specifics.
 */

const ACCOUNT = 'account-1' as AccountUuid
const WORKSPACE = 'workspace-1' as WorkspaceUuid

export const fakeIdentity = (overrides: Partial<SessionIdentity> = {}): SessionIdentity => {
  const base: SessionIdentity = {
    account: ACCOUNT,
    workspace: WORKSPACE,
    token: { account: ACCOUNT, workspace: WORKSPACE },
    workspaceToken: 'raw-token',
    transactorUrl: 'http://transactor.test',
    readOnly: false
  }
  return { ...base, ...overrides }
}

export const fakeWorkspaceSession = (identity: SessionIdentity = fakeIdentity()): WorkspaceSession => {
  // `Object.create` rather than a literal: the repo's ESLint config forbids
  // asserting an object literal, and an empty client is a legal stub here.
  const base = {
    identity,
    client: Object.create(null) as TxOperations,
    markup: { read: async (_ref: string) => '' }
  }
  return base as unknown as WorkspaceSession
}

export const fakeToolContext = (
  identity: SessionIdentity = fakeIdentity(),
  ctx: MeasureContext = fakeMeasureContext()
): ToolContext => toolContext(fakeWorkspaceSession(identity), ctx)

/**
 * A MeasureContext that satisfies the handful of methods the MCP layer calls.
 *
 * `with` is the important one: tools and the dispatcher wrap their work in it,
 * so a stub that does not invoke the callback would silently skip every test.
 */
export const fakeMeasureContext = (): MeasureContext => {
  const ctx: Record<string, unknown> = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    setLevel: () => {},
    newChild: () => ctx,
    with: async <T>(_name: string, _params: unknown, fn: (child: MeasureContext) => Promise<T>) =>
      await fn(ctx as unknown as MeasureContext)
  }
  return ctx as unknown as MeasureContext
}

/** Builds a ProcessEnv without asserting an object literal. */
export const fakeEnv = (values: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...values }
  return env
}
