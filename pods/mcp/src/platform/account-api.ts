// SPDX-License-Identifier: EPL-2.0

import { getClient as getAccountClient } from '@hcengineering/account-client'
import {
  type AccountRole,
  type AccountUuid,
  type WorkspaceInfoWithStatus,
  type WorkspaceMemberInfo
} from '@hcengineering/core'

import { type SessionIdentity } from '../auth/authenticator'

/**
 * The slice of the account service the tools use.
 *
 * Kept narrow on purpose: the full `AccountClient` has a hundred methods, most
 * of which (merging accounts, deleting a workspace, minting tokens) an agent
 * should not reach. Every call runs with the caller's own workspace token, so
 * the account service applies its own role checks; nothing here grants rights.
 */
export interface AccountApi {
  getWorkspaceInfo: () => Promise<WorkspaceInfoWithStatus>
  getWorkspaceMembers: () => Promise<WorkspaceMemberInfo[]>
  updateWorkspaceName: (name: string) => Promise<void>
  updateWorkspaceRole: (account: AccountUuid, role: AccountRole) => Promise<void>
  /** Removes a member (the account service calls this "leaving"). */
  removeMember: (account: AccountUuid) => Promise<void>
  sendInvite: (email: string, role: AccountRole) => Promise<void>
  createInviteLink: (email: string, role: AccountRole, expHours: number) => Promise<string>
  updateAllowReadOnlyGuests: (allowed: boolean) => Promise<void>
  updateAllowGuestSignUp: (allowed: boolean) => Promise<void>
}

export type AccountApiFactory = (identity: SessionIdentity) => AccountApi

/** Builds the account API over the real account client, authenticated as the caller. */
export const createAccountApi = (accountsUrl: string): AccountApiFactory => {
  return (identity) => {
    const client = getAccountClient(accountsUrl, identity.workspaceToken)
    return {
      getWorkspaceInfo: async () => await client.getWorkspaceInfo(),
      getWorkspaceMembers: async () => await client.getWorkspaceMembers(),
      updateWorkspaceName: async (name) => {
        await client.updateWorkspaceName(name)
      },
      updateWorkspaceRole: async (account, role) => {
        await client.updateWorkspaceRole(account, role)
      },
      removeMember: async (account) => {
        await client.leaveWorkspace(account)
      },
      sendInvite: async (email, role) => {
        await client.sendInvite(email, role)
      },
      // Auto-join is off: the invitee must accept, rather than being enrolled by whoever holds the link.
      createInviteLink: async (email, role, expHours) =>
        await client.createInviteLink(email, role, false, '', '', undefined, expHours),
      updateAllowReadOnlyGuests: async (allowed) => {
        await client.updateAllowReadOnlyGuests(allowed)
      },
      updateAllowGuestSignUp: async (allowed) => {
        await client.updateAllowGuestSignUp(allowed)
      }
    }
  }
}
