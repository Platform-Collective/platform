// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import type { LoginInfoByToken } from '@hcengineering/account-client'
import { TxOperations, type MeasureContext } from '@hcengineering/core'
import { gitlabIntegrationKind } from '@hcengineering/gitlab'
import { setMetadata } from '@hcengineering/platform'
import serverClient, { getAccountClient } from '@hcengineering/server-client'
import { buildStorageFromConfig, storageConfigFromEnv } from '@hcengineering/server-storage'
import { decodeToken } from '@hcengineering/server-token'
import bp from 'body-parser'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import { GitlabAppStore, toOAuthConfig } from './apps'
import type { VerifiedCaller } from './caller'
import { ACCOUNT_CLIENT_TIMEOUT_MS, createPlatformClient, systemToken } from './client'
import type { Config } from './config'
import { GitlabApiError, isGitlabWriteAllowed } from './gitlab/api'
import { safeFetch } from './gitlab/fetch'
import { cachedImageLoader, IMAGE_HEADERS, imageRoute, imageStatus, type ImageRouteDeps } from './image-route'
import { WEBHOOK_PATH } from './hooks'
import { HostGuard } from './host-guard'
import { errorResponse } from './http-error'
import {
  appConfigRoute,
  appRemoveRoute,
  disconnectAllRoute,
  repositoryDisableRoute,
  repositoryEnableRoute,
  requiredString,
  verifyCallerToken,
  type OwnerRouteDeps,
  type RepositoryRouteDeps,
  type RouteBody,
  type TokenDeps
} from './routes'
import { GitlabService } from './service'
import { errorMessage, toError } from './sync/errors'
import { linkGitlabIdentity } from './sync/persons'
import { GitlabUserManager } from './users'
import { createWebhookHandler, scopedResolver, WebhookRouter } from './webhook'
import { createWorkspaceWorker } from './worker/factory'
import { GitlabPlatform, workspacesWithGitlab } from './worker/platform'
import { workspaceWorkerState } from './workspace-state'
import type { GitlabHookPayload } from './worker/worker'

// Webhook payloads (merge requests with many changes) are the large bodies
const MAX_BODY = '10mb'

// decodeToken verifies the signature and throws on an invalid token.
const tokenDeps: TokenDeps = {
  decode: (token) => decodeToken(token),
  listSocialIds: async (token) => await getAccountClient(token, ACCOUNT_CLIENT_TIMEOUT_MS).getSocialIds()
}

async function verifiedCaller (body: RouteBody): Promise<VerifiedCaller> {
  return await verifyCallerToken(body, tokenDeps)
}

async function loginInfo (body: RouteBody): Promise<LoginInfoByToken | undefined> {
  return await getAccountClient(String(body.token), ACCOUNT_CLIENT_TIMEOUT_MS).getLoginInfoByToken()
}

export async function start (ctx: MeasureContext, config: Config): Promise<() => Promise<void>> {
  setMetadata(serverClient.metadata.Endpoint, config.AccountsURL)
  setMetadata(serverClient.metadata.UserAgent, config.ServiceID)
  if (!isGitlabWriteAllowed()) {
    ctx.warn('GitLab is read-only (GITLAB_READONLY=true): changes made in Huly are kept and not sent to GitLab')
  }

  // Merge request diffs are stored only when the pod has blob storage
  const storage =
    config.StorageConfig !== undefined ? buildStorageFromConfig(storageConfigFromEnv(config.StorageConfig)) : undefined

  const accountClient = getAccountClient(systemToken(), ACCOUNT_CLIENT_TIMEOUT_MS)
  const apps = new GitlabAppStore(accountClient)
  const hostGuard = new HostGuard({
    allowInsecure: config.AllowInsecureHosts === true,
    allowedHosts: config.AllowedHosts
  })
  // Every GitLab call: allowed hosts only, no redirects, a time limit
  const gitlabFetch = safeFetch({ guard: hostGuard, timeoutMs: config.RequestTimeoutMs })
  const users = new GitlabUserManager(
    accountClient,
    async (workspace) => {
      const app = await apps.get(workspace)
      return app === undefined ? undefined : toOAuthConfig(app, config.RedirectURI)
    },
    gitlabFetch
  )
  const platform = new GitlabPlatform({
    ctx,
    listWorkspaces: async () =>
      workspacesWithGitlab(await accountClient.listIntegrations({ kind: gitlabIntegrationKind })),
    createWorker: async (workspace) =>
      await createWorkspaceWorker(ctx, workspace, config, {
        users,
        accounts: accountClient,
        storage,
        fetchFn: gitlabFetch
      }),
    workspaceState: async (workspace) => {
      const info = await getAccountClient(systemToken(workspace), ACCOUNT_CLIENT_TIMEOUT_MS).getWorkspaceInfo()
      return workspaceWorkerState(info, config.WorkspaceInactivityDays, Date.now())
    }
  })
  platform.start()
  const webhookRouter = new WebhookRouter()
  for (const kind of ['Issue Hook', 'Note Hook', 'Merge Request Hook'] as const) {
    webhookRouter.on(kind, async (payload, target) => {
      await platform.dispatch(kind, payload as GitlabHookPayload, target)
    })
  }
  const service = new GitlabService({
    config,
    users,
    accounts: accountClient,
    apps,
    hostGuard,
    fetchFn: gitlabFetch,
    openSession: async (workspace, accountId) => {
      // Reuse the workspace worker's connection when there is one
      const lease = platform.getWorker(workspace)?.lease(accountId)
      if (lease !== undefined) {
        // The worker keeps its connection open until the request releases it
        return {
          client: lease.client,
          close: async () => {
            lease.release()
          }
        }
      }
      const raw = await createPlatformClient(ctx, workspace, config)
      return {
        client: new TxOperations(raw, accountId),
        close: async () => {
          await raw.close()
        }
      }
    },
    linkIdentity: async (client, personUuid, host, user) => {
      await linkGitlabIdentity(client, accountClient, personUuid, host, user, Date.now())
    },
    onWorkspaceChanged: (workspace) => {
      // At once: a disconnected member's token must not be used for the rest of the cache period
      platform.getWorker(workspace)?.forgetTokens()
      void platform.checkWorkspaces().then(() => {
        platform.getWorker(workspace)?.requestFullSync()
      })
    }
  })

  const app = express()
  app.use(cors())
  app.use(bp.json({ limit: MAX_BODY }))

  const scoped = createWebhookHandler(webhookRouter, scopedResolver(config.WebhookSecret), ctx)
  app.post(`${WEBHOOK_PATH}/:workspace/:integration`, (req: Request, res: Response) => {
    scoped({ header: (name) => req.header(name), body: req.body, params: req.params }, res)
  })

  const failed = (name: string, res: Response, err: unknown): void => {
    const { status, body } = errorResponse(err)
    Analytics.handleError(toError(err))
    ctx.error(`/api/v1/${name} failed`, {
      status,
      error: body.error,
      detail: err instanceof GitlabApiError ? err.detail : undefined
    })
    res.status(status).json(body)
  }

  const route =
    (name: string, fn: (body: RouteBody) => Promise<unknown>) =>
    (req: Request, res: Response): void => {
      fn((req.body ?? {}) as RouteBody)
        .then((result) => res.status(200).json(result ?? {}))
        .catch((err: unknown) => {
          failed(name, res, err)
        })
    }

  app.post(
    '/api/v1/authorize-url',
    route('authorize-url', async (body) => {
      const { workspace, account, accountId } = await verifiedCaller(body)
      return {
        url: await service.authorizeUrl(
          { workspace, account, accountId },
          typeof body.origin === 'string' ? body.origin : undefined
        )
      }
    })
  )
  app.post(
    '/api/v1/app-status',
    route('app-status', async (body) => {
      const { workspace } = await verifiedCaller(body)
      return await service.appStatus(workspace, typeof body.origin === 'string' ? body.origin : undefined)
    })
  )
  // Owner-only routes: a verified workspace token, then the caller's role in that same workspace.
  const ownerDeps: OwnerRouteDeps = { verify: verifiedCaller, loginInfo, service }
  app.post(
    '/api/v1/app-config',
    route('app-config', async (body) => {
      await appConfigRoute(ctx, body, ownerDeps)
    })
  )
  app.post(
    '/api/v1/app-remove',
    route('app-remove', async (body) => {
      await appRemoveRoute(ctx, body, ownerDeps)
    })
  )
  app.post(
    '/api/v1/disconnect-all',
    route('disconnect-all', async (body) => {
      await disconnectAllRoute(ctx, body, ownerDeps)
    })
  )
  app.post(
    '/api/v1/auth',
    route('auth', async (body) => {
      const { workspace, account } = await verifiedCaller(body)
      await service.authorize(ctx, {
        code: requiredString(body, 'code'),
        state: requiredString(body, 'state'),
        caller: { workspace, account }
      })
    })
  )
  app.post(
    '/api/v1/refresh',
    route('refresh', async (body) => {
      const { workspace, accountId } = await verifiedCaller(body)
      await service.refresh(ctx, workspace, accountId)
    })
  )
  const repositoryDeps: RepositoryRouteDeps = { verify: verifiedCaller, loginInfo, service }
  app.post(
    '/api/v1/repository-enable',
    route('repository-enable', async (body) => {
      await repositoryEnableRoute(ctx, body, repositoryDeps)
    })
  )
  app.post(
    '/api/v1/repository-disable',
    route('repository-disable', async (body) => {
      await repositoryDisableRoute(ctx, body, repositoryDeps)
    })
  )
  app.post(
    '/api/v1/disconnect',
    route('disconnect', async (body) => {
      const { workspace, accountId } = await verifiedCaller(body)
      await service.disconnect(ctx, workspace, accountId)
    })
  )

  const imageDeps: ImageRouteDeps = {
    verify: verifiedCaller,
    image: cachedImageLoader(
      async (workspace, actor, url) =>
        (await platform.getWorker(workspace)?.gitlabImage(url, actor)) ?? { kind: 'unavailable' }
    ),
    onError: (err) => {
      Analytics.handleError(toError(err))
      ctx.error('/api/v1/image failed', { error: errorMessage(err) })
    }
  }
  app.post('/api/v1/image', (req: Request, res: Response) => {
    imageRoute(req.body, imageDeps)
      .then((result) => {
        if (result.kind === 'image') {
          res
            .status(200)
            .set({ ...IMAGE_HEADERS, 'Content-Type': result.contentType })
            .send(result.data)
          return
        }
        res.status(imageStatus(result.kind)).json({ error: result.kind })
      })
      .catch((err: unknown) => {
        failed('image', res, err)
      })
  })

  const server = app.listen(config.Port, () => {
    ctx.info('GitLab service listening', { port: config.Port })
  })
  return async () => {
    // No new requests; the ones running finish (bounded by the shutdown timeout in index.ts)
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    await platform.close()
    await storage?.close()
  }
}
