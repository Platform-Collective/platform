// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import { getClient as getCollaboratorClient } from '@hcengineering/collaborator-client'
import core, { type MeasureContext, systemAccountUuid, TxOperations, type WorkspaceUuid } from '@hcengineering/core'
import { gitlabId } from '@hcengineering/gitlab'
import { generateToken } from '@hcengineering/server-token'
import { createPlatformClient } from '../client'
import type { Config } from '../config'
import { createMarkdownConverter, markdownUrls } from '../markdown'
import type { GitlabUserManager } from '../users'
import { GitlabWorker } from './worker'

export interface FactoryDeps {
  users: Pick<GitlabUserManager, 'getValidRecord'>
  accounts: Pick<AccountClient, 'ensurePerson'>
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
    const configuration = await connection.findOne(core.class.PluginConfiguration, { pluginId: gitlabId })
    if (configuration?.enabled === false) {
      await connection.close()
      return undefined
    }
    const collaborator = getCollaboratorClient(
      workspace,
      generateToken(systemAccountUuid, workspace, { service: 'gitlab' }),
      config.CollaboratorURL
    )
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
      markdown: createMarkdownConverter(markdownUrls(config.FrontURL, workspace))
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
