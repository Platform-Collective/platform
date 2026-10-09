// SPDX-License-Identifier: EPL-2.0

import type { LoginInfoByToken } from '@hcengineering/account-client'
import type { MeasureContext, PersonId, Ref, WorkspaceUuid } from '@hcengineering/core'
import type { GitlabIntegrationRepository } from '@hcengineering/gitlab'
import { assertOwner, resolveCaller, type VerifiedCaller } from './caller'
import type { GitlabAppInput, GitlabService } from './service'

export type RouteBody = Record<string, unknown>

export interface TokenDeps {
  // Verifies the signature and throws on an invalid token (decodeToken in production).
  decode: (token: string) => { workspace?: WorkspaceUuid, account: string }
  // Must be bound to the given token.
  listSocialIds: (token: string) => Promise<Array<{ _id: PersonId }>>
}

/** Verifies the posted token, requires a workspace in it, and checks that the posted social id is the caller's. */
export async function verifyCallerToken (body: RouteBody, deps: TokenDeps): Promise<VerifiedCaller> {
  const token = String(body.token)
  const decoded = deps.decode(token)
  // The social id is not part of the token: check that the posted one belongs to the caller's account.
  return await resolveCaller(decoded, body.accountId, async () => await deps.listSocialIds(token))
}

export interface RepositoryRouteDeps {
  verify: (body: RouteBody) => Promise<VerifiedCaller>
  service: Pick<GitlabService, 'enableRepository' | 'disableRepository'>
}

function repositoryIdOf (body: RouteBody): Ref<GitlabIntegrationRepository> {
  if (typeof body.repositoryId !== 'string' || body.repositoryId === '') {
    throw new Error('repositoryId is required')
  }
  return body.repositoryId as Ref<GitlabIntegrationRepository>
}

/** Repository routes check the posted social id like every other route. */
export async function repositoryEnableRoute (ctx: MeasureContext, body: RouteBody, deps: RepositoryRouteDeps): Promise<void> {
  const repositoryId = repositoryIdOf(body)
  const { workspace } = await deps.verify(body)
  await deps.service.enableRepository(ctx, workspace, repositoryId)
}

export async function repositoryDisableRoute (ctx: MeasureContext, body: RouteBody, deps: RepositoryRouteDeps): Promise<void> {
  const repositoryId = repositoryIdOf(body)
  const { workspace } = await deps.verify(body)
  await deps.service.disableRepository(ctx, workspace, repositoryId)
}

export function appInput (body: RouteBody): GitlabAppInput {
  if (typeof body.clientId !== 'string') {
    throw new Error('clientId must be a string')
  }
  if (body.host !== undefined && typeof body.host !== 'string') {
    throw new Error('host must be a string')
  }
  if (body.clientSecret !== undefined && typeof body.clientSecret !== 'string') {
    throw new Error('clientSecret must be a string')
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
