//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { setMetadata } from '@hcengineering/platform'
import serverToken from '@hcengineering/server-token'

import { redactLogValue, type MeasureContext } from '@hcengineering/core'
import serverClient from '@hcengineering/server-client'
import type { StorageConfiguration } from '@hcengineering/server-core'
import { buildStorageFromConfig, storageConfigFromEnv } from '@hcengineering/server-storage'
import config from './config'
import { start } from './server'

export async function startCollaborator (ctx: MeasureContext, onClose?: () => void): Promise<void> {
  let storageAdapter: ReturnType<typeof buildStorageFromConfig> | undefined
  try {
    setMetadata(serverToken.metadata.Secret, config.Secret)
    setMetadata(serverToken.metadata.Service, 'collaborator')
    setMetadata(serverClient.metadata.UserAgent, config.ServiceID)
    setMetadata(serverClient.metadata.Endpoint, config.AccountsUrl)

    const storageConfig: StorageConfiguration = storageConfigFromEnv()
    storageAdapter = buildStorageFromConfig(storageConfig)
    const shutdown = await start(ctx, config, storageAdapter)
    const storage = storageAdapter

    const close = (): void => {
      void storage.close()
      void shutdown()
      onClose?.()
    }

    process.on('uncaughtException', (error) => {
      ctx.error('UncaughtException', { error: redactLogValue(error) })
    })
    process.on('unhandledRejection', (reason) => {
      ctx.error('Unhandled Rejection', { error: redactLogValue(reason) })
    })
    process.on('SIGINT', close)
    process.on('SIGTERM', close)
    process.on('exit', close)
  } catch (error) {
    ctx.error('Collaborator startup failed', { error: redactLogValue(error) })
    process.exitCode = 1
    try {
      await storageAdapter?.close()
    } catch (closeError) {
      ctx.error('Collaborator storage cleanup failed', { error: redactLogValue(closeError) })
    }
    // Metrics timers can keep a failed pod alive even with exitCode set.
    process.exit(1)
  }
}
