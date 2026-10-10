// SPDX-License-Identifier: EPL-2.0

import type { LoginInfoByToken } from '@hcengineering/account-client'
import { AccountRole, hasAccountRole, type Account, type PersonId, type WorkspaceUuid } from '@hcengineering/core'
import { HttpError } from './http-error'

export interface VerifiedCaller {
  workspace: WorkspaceUuid
  // Huly account uuid from the verified token
  account: string
  // A social id that belongs to the caller
  accountId: PersonId
}

function isWorkspace (value: unknown): value is WorkspaceUuid {
  return typeof value === 'string' && value !== ''
}

/**
 * Returns the workspace of a verified token, and throws for an account-level token without one.
 * Every workspace-scoped lookup depends on it: the account service ignores an undefined `workspaceUuid`
 * filter, so a missing workspace would widen a lookup to every workspace.
 */
export function requireTokenWorkspace (decoded: { workspace?: unknown }): WorkspaceUuid {
  if (!isWorkspace(decoded.workspace)) {
    throw new HttpError(401, 'A workspace token is required')
  }
  return decoded.workspace
}

/** Defence in depth for stores: refuses an empty or missing workspace before any account-service call. */
export function assertWorkspace (workspace: WorkspaceUuid | undefined): asserts workspace is WorkspaceUuid {
  if (!isWorkspace(workspace)) {
    throw new Error('workspace is required')
  }
}

/**
 * Resolves the caller from a verified token and checks that the client-supplied social id belongs to that account.
 * `listSocialIds` must be bound to the caller's own token.
 */
export async function resolveCaller (
  decoded: { workspace?: WorkspaceUuid, account: string },
  claimed: unknown,
  listSocialIds: () => Promise<Array<{ _id: PersonId }>>
): Promise<VerifiedCaller> {
  const workspace = requireTokenWorkspace(decoded)
  if (typeof claimed !== 'string' || claimed === '') {
    throw new HttpError(400, 'accountId is required')
  }
  const ids = await listSocialIds()
  if (!ids.some((it) => it._id === claimed)) {
    throw new HttpError(403, 'accountId does not belong to the caller')
  }
  return { workspace, account: decoded.account, accountId: claimed as PersonId }
}

/** The caller's role, counted only when the login info is a workspace login info for `workspace`. */
export function roleInWorkspace (info: LoginInfoByToken | undefined, workspace: WorkspaceUuid): AccountRole | undefined {
  if (info == null || !('role' in info) || !('workspace' in info)) return undefined
  return info.workspace === workspace ? info.role : undefined
}

/** True when the caller's role in `workspace` is `role` or higher. */
export function hasWorkspaceRole (
  info: LoginInfoByToken | undefined,
  workspace: WorkspaceUuid,
  role: AccountRole
): boolean {
  const actual = roleInWorkspace(info, workspace)
  return actual !== undefined && hasAccountRole({ role: actual } as unknown as Account, role)
}

/**
 * Throws unless the caller's role in `workspace` is Owner or higher.
 * `getLoginInfo` must be bound to the caller's own token.
 */
export async function assertOwner (
  workspace: WorkspaceUuid,
  getLoginInfo: () => Promise<LoginInfoByToken | undefined>
): Promise<void> {
  assertWorkspace(workspace)
  if (!hasWorkspaceRole(await getLoginInfo(), workspace, AccountRole.Owner)) {
    throw new HttpError(403, 'Only workspace owners can change the GitLab application')
  }
}
