// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import { getClient as getCollaboratorClient } from '@hcengineering/collaborator-client'
import core, { type MeasureContext, TxOperations, type WorkspaceUuid } from '@hcengineering/core'
import { gitlabId } from '@hcengineering/gitlab'
import { getAccountClient } from '@hcengineering/server-client'
import type { StorageAdapter } from '@hcengineering/server-core'
import { ACCOUNT_CLIENT_TIMEOUT_MS, createPlatformClient, systemToken } from '../client'
import type { Config } from '../config'
import type { FetchFn } from '../gitlab/api'
import { createMarkdownConverter, markdownUrls } from '../markdown'
import type { ImageStore, PatchStore } from '../sync/types'
import type { GitlabUserManager } from '../users'
import { createImageStore } from './images'
import { createPatchStore } from './patches'
import { GitlabWorker } from './worker'

export interface FactoryDeps {
  users: Pick<GitlabUserManager, 'getValidRecord'>
  accounts: Pick<AccountClient, 'ensurePerson'>
  // Blob storage for merge request diffs and copied images; undefined when STORAGE_CONFIG is not set
  storage?: StorageAdapter
  // Every GitLab call (safeFetch)
  fetchFn: FetchFn
}

/** Connects to the workspace and builds its worker; undefined when GitLab is disabled there. */
export async function createWorkspaceWorker (
  ctx: MeasureContext,
  workspace: WorkspaceUuid,
  config: Config,
  deps: FactoryDeps
): Promise<GitlabWorker | undefined> {
  let worker: GitlabWorker | undefined
  const connection = await createPlatformClient(ctx, workspace, config, async () => {
    worker?.triggerSync()
  })
  try {
    const token = systemToken(workspace)
    const configuration = await connection.findOne(core.class.PluginConfiguration, { pluginId: gitlabId })
    if (configuration?.enabled === false) {
      await connection.close()
      return undefined
    }
    let patches: PatchStore | undefined
    let images: ImageStore | undefined
    if (deps.storage !== undefined) {
      const info = await getAccountClient(token, ACCOUNT_CLIENT_TIMEOUT_MS).getWorkspaceInfo()
      const ids = { uuid: info.uuid, url: info.url, dataId: info.dataId }
      patches = createPatchStore(deps.storage, ids)
      images = createImageStore(deps.storage, ids)
    }
    const collaborator = getCollaboratorClient(workspace, token, config.CollaboratorURL)
    worker = new GitlabWorker({
      ctx: ctx.newChild('gitlab-worker', { workspace }),
      workspace,
      client: new TxOperations(connection, core.account.System),
      derived: new TxOperations(connection, core.account.System, true),
      session: (accountId) => new TxOperations(connection, accountId),
      closeConnection: async () => {
        await connection.close()
      },
      users: deps.users,
      accounts: deps.accounts,
      collaborator,
      markdown: createMarkdownConverter(markdownUrls(config.FrontURL, workspace)),
      patches,
      images,
      hooks: { baseUrl: config.WebhookBaseURL, master: config.WebhookSecret },
      fetchFn: deps.fetchFn
    })
    connection.notify = (...txes) => {
      worker?.onTx(txes)
    }
    return worker
  } catch (err: unknown) {
    await connection.close()
    throw err
  }
}
