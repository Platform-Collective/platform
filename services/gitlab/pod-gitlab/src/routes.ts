// SPDX-License-Identifier: EPL-2.0

import type { LoginInfoByToken } from '@hcengineering/account-client'
import { AccountRole, type MeasureContext, type PersonId, type Ref, type WorkspaceUuid } from '@hcengineering/core'
import type { GitlabIntegrationRepository } from '@hcengineering/gitlab'
import { assertOwner, hasWorkspaceRole, resolveCaller, type VerifiedCaller } from './caller'
import { HttpError } from './http-error'
import type { GitlabAppInput, GitlabService, RepositoryCaller } from './service'

export type RouteBody = Record<string, unknown>

/** A required non-empty string field of a route body. */
export function requiredString (body: RouteBody, name: string): string {
  const value = body[name]
  if (typeof value !== 'string' || value === '') throw new HttpError(400, `${name} is required`)
  return value
}

export interface TokenDeps {
  // Verifies the signature and throws on an invalid token (decodeToken in production).
  decode: (token: string) => { workspace?: WorkspaceUuid, account: string }
  // Must be bound to the given token.
  listSocialIds: (token: string) => Promise<Array<{ _id: PersonId }>>
}

/** Verifies the posted token, requires a workspace in it, and checks that the posted social id is the caller's. */
export async function verifyCallerToken (body: RouteBody, deps: TokenDeps): Promise<VerifiedCaller> {
  const token = body.token
  if (typeof token !== 'string' || token === '') throw new HttpError(401, 'token is required')
  let decoded: { workspace?: WorkspaceUuid, account: string }
  try {
    decoded = deps.decode(token)
  } catch {
    throw new HttpError(401, 'Invalid token')
  }
  // The social id is not part of the token: check that the posted one belongs to the caller's account.
  return await resolveCaller(decoded, body.accountId, async () => await deps.listSocialIds(token))
}

export interface RepositoryRouteDeps {
  verify: (body: RouteBody) => Promise<VerifiedCaller>
  // Login info of the posted token; asked only when the caller did not connect the repository's integration
  loginInfo: (body: RouteBody) => Promise<LoginInfoByToken | undefined>
  service: Pick<GitlabService, 'enableRepository' | 'disableRepository'>
}

async function repositoryCaller (
  body: RouteBody,
  deps: RepositoryRouteDeps
): Promise<{
  workspace: WorkspaceUuid
  caller: RepositoryCaller
}> {
  const { workspace, accountId } = await deps.verify(body)
  return {
    workspace,
    caller: {
      accountId,
      isMaintainer: async () => hasWorkspaceRole(await deps.loginInfo(body), workspace, AccountRole.Maintainer)
    }
  }
}

/** Repository routes check the posted social id like every other route. */
export async function repositoryEnableRoute (
  ctx: MeasureContext,
  body: RouteBody,
  deps: RepositoryRouteDeps
): Promise<void> {
  const repositoryId = requiredString(body, 'repositoryId') as Ref<GitlabIntegrationRepository>
  const { workspace, caller } = await repositoryCaller(body, deps)
  await deps.service.enableRepository(ctx, workspace, repositoryId, caller)
}

export async function repositoryDisableRoute (
  ctx: MeasureContext,
  body: RouteBody,
  deps: RepositoryRouteDeps
): Promise<void> {
  const repositoryId = requiredString(body, 'repositoryId') as Ref<GitlabIntegrationRepository>
  const { workspace, caller } = await repositoryCaller(body, deps)
  await deps.service.disableRepository(ctx, workspace, repositoryId, caller)
}

export function appInput (body: RouteBody): GitlabAppInput {
  if (typeof body.clientId !== 'string') {
    throw new HttpError(400, 'clientId must be a string')
  }
  if (body.host !== undefined && typeof body.host !== 'string') {
    throw new HttpError(400, 'host must be a string')
  }
  if (body.clientSecret !== undefined && typeof body.clientSecret !== 'string') {
    throw new HttpError(400, 'clientSecret must be a string')
  }
  return { host: body.host, clientId: body.clientId, clientSecret: body.clientSecret }
}

export interface OwnerRouteDeps {
  verify: (body: RouteBody) => Promise<VerifiedCaller>
  // Login info of the posted token (getLoginInfoByToken in production); its role counts only for the verified workspace.
  loginInfo: (body: RouteBody) => Promise<LoginInfoByToken | undefined>
  service: Pick<GitlabService, 'saveApp' | 'removeApp' | 'disconnectAll'>
}

async function verifyOwner (body: RouteBody, deps: OwnerRouteDeps): Promise<VerifiedCaller> {
  const caller = await deps.verify(body)
  await assertOwner(caller.workspace, async () => await deps.loginInfo(body))
  return caller
}

export async function appConfigRoute (ctx: MeasureContext, body: RouteBody, deps: OwnerRouteDeps): Promise<void> {
  const input = appInput(body)
  const { workspace, accountId } = await verifyOwner(body, deps)
  await deps.service.saveApp(ctx, workspace, accountId, input)
}

export async function appRemoveRoute (ctx: MeasureContext, body: RouteBody, deps: OwnerRouteDeps): Promise<void> {
  const { workspace } = await verifyOwner(body, deps)
  await deps.service.removeApp(ctx, workspace)
}

export async function disconnectAllRoute (ctx: MeasureContext, body: RouteBody, deps: OwnerRouteDeps): Promise<void> {
  const { workspace } = await verifyOwner(body, deps)
  await deps.service.disconnectAll(ctx, workspace)
}
