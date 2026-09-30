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

import { AccountRole, type AccountUuid, type TxOperations } from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'

import { fakeIdentity, fakeMeasureContext } from '../../__tests__/test-doubles'
import { toolContext, type ToolContext } from '../../mcp/tool'
import { type AccountApi } from '../../platform/account-api'
import { type WorkspaceSession } from '../../platform/workspace-client-provider'
import {
  accountTools,
  createInviteLinkTool,
  getWorkspaceTool,
  inviteMemberTool,
  listMembersTool,
  removeMemberTool,
  setMemberRoleTool,
  updateGuestSettingsTool,
  updateWorkspaceNameTool
} from '../account-tools'

const ME = 'account-1' as AccountUuid
const OTHER = 'account-2' as AccountUuid

const forbidden = (): PlatformError<Record<string, never>> => new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))

function fakeAccounts (overrides: Partial<AccountApi> = {}): { accounts: AccountApi, calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = []
  const record = (name: string, result?: unknown) => async (...args: unknown[]) => {
    calls.push([name, args])
    return result
  }
  const accounts = {
    getWorkspaceInfo: record('getWorkspaceInfo', {
      uuid: 'ws-1',
      name: 'Acme',
      url: 'acme',
      createdOn: Date.parse('2026-01-01T00:00:00Z'),
      allowReadOnlyGuest: true
    }),
    getWorkspaceMembers: record('getWorkspaceMembers', [
      { person: ME, role: AccountRole.Owner },
      { person: OTHER, role: AccountRole.User }
    ]),
    updateWorkspaceName: record('updateWorkspaceName'),
    updateWorkspaceRole: record('updateWorkspaceRole'),
    removeMember: record('removeMember'),
    sendInvite: record('sendInvite'),
    createInviteLink: record('createInviteLink', 'https://huly.test/invite/abc'),
    updateAllowReadOnlyGuests: record('updateAllowReadOnlyGuests'),
    updateAllowGuestSignUp: record('updateAllowGuestSignUp'),
    ...overrides
  }
  return { accounts: accounts as unknown as AccountApi, calls }
}

const PERSONS = [
  { _id: 'p1', name: 'Grace Hopper', personUuid: ME },
  { _id: 'p2', name: 'Alan Turing', personUuid: OTHER }
]

/** A client whose only capability is the Person lookup the member list performs. */
function personClient (persons: unknown[] = PERSONS): { client: TxOperations, queries: Array<Record<string, unknown>> } {
  const queries: Array<Record<string, unknown>> = []
  const client = {
    findAll: async (_cls: string, query: Record<string, unknown>) => {
      queries.push(query)
      return persons
    }
  }
  return { client: client as unknown as TxOperations, queries }
}

function context (accounts: AccountApi, client: TxOperations = personClient().client): ToolContext {
  const session: WorkspaceSession = {
    client,
    accounts,
    identity: fakeIdentity({ account: ME }),
    markup: { read: async () => '' }
  }
  return toolContext(session, fakeMeasureContext())
}

const textOf = (result: { content: unknown[] }): string => (result.content[0] as { text: string }).text

describe('workspace administration tools', () => {
  it('reports settings together with the caller role', async () => {
    const { accounts } = fakeAccounts()

    const result = await getWorkspaceTool.handler(context(accounts), {})

    expect(JSON.parse(textOf(result))).toMatchObject({
      name: 'Acme',
      url: 'acme',
      allowReadOnlyGuests: true,
      allowGuestSignUp: false,
      yourRole: 'Owner'
    })
  })

  it('lists members with names, role names and a marker for the caller', async () => {
    const { accounts } = fakeAccounts()

    const result = await listMembersTool.handler(context(accounts), {})

    expect(JSON.parse(textOf(result)).members).toEqual([
      { accountId: ME, name: 'Grace Hopper', role: 'Owner', you: true },
      { accountId: OTHER, name: 'Alan Turing', role: 'User', you: false }
    ])
  })

  it('resolves names with one workspace query and leaves unknown members unnamed', async () => {
    const { accounts } = fakeAccounts()
    const { client, queries } = personClient([PERSONS[0]])

    const result = await listMembersTool.handler(context(accounts, client), {})

    expect(queries).toEqual([{ personUuid: { $in: [ME, OTHER] } }])
    expect(JSON.parse(textOf(result)).members[1]).toMatchObject({ accountId: OTHER, name: null })
  })

  it('maps a role name to the account role when changing a member', async () => {
    const { accounts, calls } = fakeAccounts()

    await setMemberRoleTool.handler(context(accounts), { accountId: OTHER, role: 'Maintainer' })

    expect(calls).toContainEqual(['updateWorkspaceRole', [OTHER, AccountRole.Maintainer]])
  })

  it('never offers the platform Admin role', () => {
    const role = (setMemberRoleTool.inputSchema.properties as Record<string, { enum?: string[] }>).role
    expect(role.enum).toEqual(['ReadOnlyGuest', 'DocGuest', 'Guest', 'User', 'Maintainer', 'Owner'])
  })

  it('translates a Forbidden status into a message naming the action', async () => {
    const { accounts } = fakeAccounts({
      updateWorkspaceRole: async () => {
        throw forbidden()
      }
    })

    const result = await setMemberRoleTool.handler(context(accounts), { accountId: OTHER, role: 'Owner' })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('does not allow you to change member roles')
  })

  it('lets unexpected errors propagate so the registry reports them', async () => {
    const { accounts } = fakeAccounts({
      removeMember: async () => {
        throw new Error('network down')
      }
    })

    await expect(removeMemberTool.handler(context(accounts), { accountId: OTHER })).rejects.toThrow('network down')
  })

  it('removes a member, marks the tool destructive and invites with the User role by default', async () => {
    const { accounts, calls } = fakeAccounts()

    await removeMemberTool.handler(context(accounts), { accountId: OTHER })
    await inviteMemberTool.handler(context(accounts), { email: 'new@example.test' })

    expect(removeMemberTool.destructive).toBe(true)
    expect(calls).toContainEqual(['removeMember', [OTHER]])
    expect(calls).toContainEqual(['sendInvite', ['new@example.test', AccountRole.User]])
  })

  it('points at the link tool when the invitation email cannot be sent, but still reports Forbidden as a role problem', async () => {
    const broken = fakeAccounts({
      sendInvite: async () => {
        throw new PlatformError(new Status(Severity.ERROR, platform.status.InternalServerError, {}))
      }
    })
    const failed = await inviteMemberTool.handler(context(broken.accounts), { email: 'new@example.test' })
    expect(failed.isError).toBe(true)
    expect(textOf(failed)).toContain('huly_create_invite_link')

    const denied = fakeAccounts({
      sendInvite: async () => {
        throw forbidden()
      }
    })
    const refused = await inviteMemberTool.handler(context(denied.accounts), { email: 'new@example.test' })
    expect(textOf(refused)).toContain('does not allow you to invite members')
  })

  it('creates an invite link with the requested expiry', async () => {
    const { accounts, calls } = fakeAccounts()

    const result = await createInviteLinkTool.handler(context(accounts), {
      email: 'new@example.test',
      role: 'Guest',
      expiresInHours: 24
    })

    expect(calls).toContainEqual(['createInviteLink', ['new@example.test', AccountRole.Guest, 24]])
    expect(JSON.parse(textOf(result)).link).toBe('https://huly.test/invite/abc')
  })

  it('changes only the guest settings that were passed and refuses an empty call', async () => {
    const { accounts, calls } = fakeAccounts()

    await updateGuestSettingsTool.handler(context(accounts), { allowGuestSignUp: true })
    expect(calls.map(([name]) => name)).toEqual(['updateAllowGuestSignUp'])

    const empty = await updateGuestSettingsTool.handler(context(accounts), {})
    expect(textOf(empty)).toContain('Nothing to change')
    expect(calls).toHaveLength(1)
  })

  it('renames the workspace', async () => {
    const { accounts, calls } = fakeAccounts()

    await updateWorkspaceNameTool.handler(context(accounts), { name: 'Acme Inc' })

    expect(calls).toContainEqual(['updateWorkspaceName', ['Acme Inc']])
  })

  it('exposes only read tools as read-only', () => {
    expect(accountTools.filter((tool) => tool.readOnly).map((tool) => tool.name)).toEqual([
      'huly_get_workspace',
      'huly_list_members'
    ])
  })
})
