// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import type { LoginInfoByToken } from '@hcengineering/account-client'
import {
  systemAccountUuid,
  TxOperations,
  type MeasureContext,
  type Ref,
  type WorkspaceUuid
} from '@hcengineering/core'
import { gitlabIntegrationKind, type GitlabIntegrationRepository } from '@hcengineering/gitlab'
import { setMetadata } from '@hcengineering/platform'
import serverClient, { getAccountClient } from '@hcengineering/server-client'
import { decodeToken, generateToken } from '@hcengineering/server-token'
import bp from 'body-parser'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import { GitlabAppStore, toOAuthConfig } from './apps'
import type { VerifiedCaller } from './caller'
import { createPlatformClient } from './client'
import type { Config } from './config'
import {
  appConfigRoute,
  appRemoveRoute,
  disconnectAllRoute,
  repositoryWorkspace,
  verifyCallerToken,
  type OwnerRouteDeps,
  type RouteBody,
  type TokenDeps
} from './routes'
import { GitlabService } from './service'
import { linkGitlabIdentity } from './sync/persons'
import { GitlabUserManager } from './users'
import { createWebhookHandler, WebhookRouter } from './webhook'
import { createWorkspaceWorker } from './worker/factory'
import { GitlabPlatform, workspacesWithGitlab } from './worker/platform'
import type { GitlabHookPayload } from './worker/worker'

export const webhookRouter = new WebhookRouter()

// decodeToken verifies the signature and throws on an invalid token.
const tokenDeps: TokenDeps = {
  decode: (token) => decodeToken(token),
  listSocialIds: async (token) => await getAccountClient(token, 30000).getSocialIds()
}

function tokenWorkspace (body: RouteBody): WorkspaceUuid {
  return repositoryWorkspace(body, tokenDeps.decode)
}

async function verifiedCaller (body: RouteBody): Promise<VerifiedCaller> {
  return await verifyCallerToken(body, tokenDeps)
}

async function loginInfo (body: RouteBody): Promise<LoginInfoByToken | undefined> {
  return await getAccountClient(String(body.token), 30000).getLoginInfoByToken()
}

export async function start (ctx: MeasureContext, config: Config): Promise<() => Promise<void>> {
  setMetadata(serverClient.metadata.Endpoint, config.AccountsURL)
  setMetadata(serverClient.metadata.UserAgent, config.ServiceID)

  const accountClient = getAccountClient(generateToken(systemAccountUuid, undefined, { service: 'gitlab' }), 30000)
  const apps = new GitlabAppStore(accountClient)
  const users = new GitlabUserManager(accountClient, async (workspace) => {
    const app = await apps.get(workspace)
    return app === undefined ? undefined : toOAuthConfig(app, config.RedirectURI)
  })
  const platform = new GitlabPlatform({
    ctx,
    listWorkspaces: async () => workspacesWithGitlab(await accountClient.listIntegrations({ kind: gitlabIntegrationKind })),
    createWorker: async (workspace) => await createWorkspaceWorker(ctx, workspace, config, { users, accounts: accountClient })
  })
  platform.start()
  webhookRouter.on('Issue Hook', async (payload) => {
    await platform.dispatch('Issue Hook', payload as GitlabHookPayload)
  })
  webhookRouter.on('Note Hook', async (payload) => {
    await platform.dispatch('Note Hook', payload as GitlabHookPayload)
  })
  const service = new GitlabService({
    config,
    users,
    accounts: accountClient,
    apps,
    openSession: async (workspace, accountId) => {
      // Reuse the workspace worker's connection when there is one
      const pooled = platform.getWorker(workspace)?.session(accountId)
      if (pooled !== undefined) {
        return { client: pooled, close: async () => {} }
      }
      const raw = await createPlatformClient(ctx, workspace, config)
      return { client: new TxOperations(raw, accountId), close: async () => { await raw.close() } }
    },
    linkIdentity: async (client, personUuid, host, user) => {
      await linkGitlabIdentity(client, accountClient, personUuid, host, user, Date.now())
    },
    onWorkspaceChanged: (workspace) => {
      void platform.checkWorkspaces().then(() => {
        platform.getWorker(workspace)?.requestFullSync()
      })
    }
  })

  const app = express()
  app.use(cors())
  app.use(bp.json({ limit: '10mb' }))

  const webhook = createWebhookHandler(webhookRouter, config.WebhookSecret, ctx)
  app.post('/api/webhook', (req: Request, res: Response) => {
    webhook({ header: (name) => req.header(name), body: req.body }, res)
  })

  const route =
    (name: string, fn: (body: Record<string, any>) => Promise<unknown>) =>
      (req: Request, res: Response): void => {
        fn(req.body)
          .then((result) => res.status(200).json(result ?? {}))
          .catch((err: Error) => {
            Analytics.handleError(err)
            ctx.error(`/api/v1/${name} failed`, { error: err.message })
            res.status(400).json({ error: err.message })
          })
      }

  app.post('/api/v1/authorize-url', route('authorize-url', async (body) => {
    const { workspace, account, accountId } = await verifiedCaller(body)
    return { url: await service.authorizeUrl({ workspace, account, accountId }, typeof body.origin === 'string' ? body.origin : undefined) }
  }))
  app.post('/api/v1/app-status', route('app-status', async (body) => {
    const { workspace } = await verifiedCaller(body)
    return await service.appStatus(workspace, typeof body.origin === 'string' ? body.origin : undefined)
  }))
  // Owner-only routes: a verified workspace token, then the caller's role in that same workspace.
  const ownerDeps: OwnerRouteDeps = { verify: verifiedCaller, loginInfo, service }
  app.post('/api/v1/app-config', route('app-config', async (body) => {
    await appConfigRoute(ctx, body, ownerDeps)
  }))
  app.post('/api/v1/app-remove', route('app-remove', async (body) => {
    await appRemoveRoute(ctx, body, ownerDeps)
  }))
  app.post('/api/v1/disconnect-all', route('disconnect-all', async (body) => {
    await disconnectAllRoute(ctx, body, ownerDeps)
  }))
  app.post('/api/v1/auth', route('auth', async (body) => {
    const { workspace, account } = await verifiedCaller(body)
    await service.authorize(ctx, { code: String(body.code), state: String(body.state), caller: { workspace, account } })
  }))
  app.post('/api/v1/refresh', route('refresh', async (body) => {
    const { workspace, accountId } = await verifiedCaller(body)
    await service.refresh(ctx, workspace, accountId)
  }))
  app.post('/api/v1/repository-enable', route('repository-enable', async (body) => {
    const workspace = tokenWorkspace(body)
    await service.enableRepository(ctx, workspace, body.repositoryId as Ref<GitlabIntegrationRepository>)
  }))
  app.post('/api/v1/repository-disable', route('repository-disable', async (body) => {
    const workspace = tokenWorkspace(body)
    await service.disableRepository(ctx, workspace, body.repositoryId as Ref<GitlabIntegrationRepository>)
  }))
  app.post('/api/v1/disconnect', route('disconnect', async (body) => {
    const { workspace, accountId } = await verifiedCaller(body)
    await service.disconnect(ctx, workspace, accountId)
  }))

  const server = app.listen(config.Port, () => {
    ctx.info('GitLab service listening', { port: config.Port })
  })
  return async () => {
    server.close()
    await platform.close()
  }
}
