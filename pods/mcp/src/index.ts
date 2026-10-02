// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { configureAnalytics, createOpenTelemetryMetricsContext, SplitLogger } from '@hcengineering/analytics-service'
import { newMetrics } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { initStatisticsContext } from '@hcengineering/server-core'
import serverToken from '@hcengineering/server-token'
import { join } from 'node:path'

import { createAuthenticator } from './auth/authenticator-factory'
import { loadConfig } from './config'
import { RateLimiter } from './middleware/rate-limiter'
import { createAccountApi } from './platform/account-api'
import { createCollaboratorWriter } from './platform/collaborator-writer'
import { CachingWorkspaceClientProvider } from './platform/workspace-client-provider'
import { createServer, listen } from './server'
import { buildRegistry } from './tools/register'

/** How often idle sessions and rate-limit buckets are reclaimed. */
const SWEEP_INTERVAL_MS = 60_000

async function main (): Promise<void> {
  // Boot-time config: a missing SECRET or an unusable credential combination
  // must stop the process here, not on the first request.
  const config = loadConfig()
  const application = config.ServiceID

  // Both of these must be set before any token is touched: without the secret,
  // server-token falls back to the literal string "secret" and would accept
  // forged tokens. loadConfig already refuses to boot on a default secret.
  setMetadata(serverToken.metadata.Secret, config.Secret)
  setMetadata(serverToken.metadata.Service, application)

  configureAnalytics(application, process.env.VERSION ?? '0.7.0')
  Analytics.setTag('application', application)

  const ctx = initStatisticsContext(application, {
    factory: () =>
      createOpenTelemetryMetricsContext(
        application,
        {},
        {},
        newMetrics(),
        new SplitLogger(application, {
          root: join(process.cwd(), 'logs'),
          enableConsole: (process.env.ENABLE_CONSOLE ?? 'true') === 'true'
        })
      )
  })

  const registry = buildRegistry()
  const authenticator = createAuthenticator(ctx, config)
  const clients = new CachingWorkspaceClientProvider({
    ctx,
    idleTtlMs: config.ClientCacheTtlMs,
    createAccounts: createAccountApi(config.AccountsUrl),
    createMarkupWriter: createCollaboratorWriter(config.CollaboratorUrl)
  })
  const limiter = new RateLimiter(ctx, config.RequestRateLimit, config.RequestRateWindowMs)

  const { app, sessions, transport } = createServer({
    ctx,
    config,
    registry,
    clients,
    authenticator,
    limiter
  })

  // Unref'd so the sweeper never keeps the process alive by itself.
  const sweeper = setInterval(() => {
    sessions.sweep()
    limiter.sweep()
  }, SWEEP_INTERVAL_MS)
  sweeper.unref()

  const server = listen(app, config.Port, config.Host)

  ctx.info('mcp server ready', {
    port: config.Port,
    authMode: config.AuthMode,
    readOnly: config.ReadOnly,
    tools: registry.size,
    accountsUrl: config.AccountsUrl
  })

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true

    ctx.info('mcp server shutting down', { signal })
    clearInterval(sweeper)

    transport.closeAll()
    sessions.closeAll()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    // Close the server sockets outright; an open SSE stream would otherwise
    // keep `server.close` pending until the client disconnects.
    server.closeAllConnections?.()
    await clients.close()

    ctx.info('mcp shutdown complete')
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
  process.on('uncaughtException', (error: Error) => {
    ctx.error('mcp uncaught exception', { error: error?.message, stack: error?.stack })
  })
  process.on('unhandledRejection', (reason: unknown) => {
    ctx.error('mcp unhandled rejection', { error: String(reason) })
  })
}

void main().catch((err) => {
  // The logger may not exist yet if the failure happened during bootstrap.
  console.error('Failed to start the Huly MCP server', err)
  process.exit(1)
})
