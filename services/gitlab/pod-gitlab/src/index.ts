// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { SplitLogger, configureAnalytics, createOpenTelemetryMetricsContext } from '@hcengineering/analytics-service'
import { newMetrics } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { initStatisticsContext } from '@hcengineering/server-core'
import serverToken from '@hcengineering/server-token'
import { join } from 'path'
import { loadConfig } from './config'
import { start } from './server'
import { errorMessage } from './sync/errors'
import { createShutdown } from './shutdown'

const config = loadConfig(process.env)

setMetadata(serverToken.metadata.Secret, config.ServerSecret)
setMetadata(serverToken.metadata.Service, 'gitlab')

configureAnalytics('gitlab', process.env.VERSION ?? '0.7.0')
const ctx = initStatisticsContext('gitlab', {
  factory: () =>
    createOpenTelemetryMetricsContext(
      'gitlab',
      {},
      {},
      newMetrics(),
      new SplitLogger('gitlab-service', {
        root: join(process.cwd(), 'logs'),
        enableConsole: (process.env.ENABLE_CONSOLE ?? 'true') === 'true'
      })
    )
})
Analytics.setTag('application', 'gitlab-service')

let doOnClose: () => Promise<void> = async () => {}

void start(ctx, config)
  .then((close) => {
    doOnClose = close
  })
  .catch((err) => {
    ctx.error('Failed to start GitLab service', { error: err })
    process.exit(1)
  })

const SHUTDOWN_TIMEOUT_MS = 30 * 1000

const onClose = createShutdown({
  // doOnClose is read when the signal comes: start() may still be running
  close: async () => {
    await doOnClose()
  },
  exit: (code) => process.exit(code),
  onError: (err) => {
    ctx.error('GitLab service shutdown failed', { error: errorMessage(err) })
  },
  timeoutMs: SHUTDOWN_TIMEOUT_MS
})
process.on('uncaughtException', (e) => {
  ctx.error('UncaughtException', { error: e })
})
process.on('unhandledRejection', (reason) => {
  ctx.error('Unhandled Rejection', { reason })
})
process.on('SIGINT', onClose)
process.on('SIGTERM', onClose)
