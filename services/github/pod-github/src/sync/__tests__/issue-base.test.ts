//
// Copyright © 2026 Hardcore Engineering Inc.
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

import type { MeasureContext, Status, TxOperations } from '@hcengineering/core'
import {
  type DocSyncInfo,
  type GithubIntegrationRepository,
  GithubIssueStateReason,
  type GithubProject
} from '@hcengineering/github'
import task from '@hcengineering/task'
import tracker, { type Issue } from '@hcengineering/tracker'
import type { IntegrationContainer, IntegrationManager } from '../../types'
import { githubExternalSyncVersion, githubSyncVersion } from '../../types'
import type { IssueExternalData } from '../githubTypes'

jest.mock('@octokit/webhooks-types', () => ({}), { virtual: true })
jest.mock('../../config', () => ({
  default: {
    AccountsURL: 'http://localhost:3000',
    ServerSecret: 'test-secret',
    AppId: 'test-app-id',
    ClientId: 'test-client-id',
    ClientSecret: 'test-client-secret',
    PrivateKey: 'test-private-key',
    CollaboratorURL: 'http://localhost:3078',
    BotName: 'test-bot'
  }
}))

import { IssueSyncManager } from '../issues'

function createContext (): MeasureContext {
  const context: {
    error: jest.Mock
    info: jest.Mock
    with: jest.Mock
  } = {
    error: jest.fn(),
    info: jest.fn(),
    with: jest.fn()
  }
  context.with.mockImplementation(
    async (_name: string, _attributes: Record<string, unknown>, callback: (ctx: MeasureContext) => Promise<unknown>) =>
      await callback(context as unknown as MeasureContext)
  )

  return context as unknown as MeasureContext
}

function createExternalIssue (overrides: Partial<IssueExternalData> = {}): IssueExternalData {
  return {
    author: { id: 'github-user', login: 'github-user', name: 'GitHub user' },
    assignees: { nodes: [] },
    body: '',
    closed: false,
    createdAt: '2026-10-19T10:00:00.000Z',
    id: 'github-issue',
    labels: { nodes: [] },
    locked: false,
    number: 1,
    participants: { nodes: [] },
    reactions: { nodes: [] },
    state: 'OPEN',
    stateReason: GithubIssueStateReason.Reopened,
    title: 'Current title',
    updatedAt: '2026-10-19T12:00:00.000Z',
    url: 'https://api.github.com/repos/owner/repo/issues/1',
    lastEditedAt: '2026-10-19T12:00:00.000Z',
    publishedAt: '2026-10-19T10:00:00.000Z',
    ...overrides
  }
}

function createProvider (statuses: Status[]): IntegrationManager {
  return {
    getAccount: jest.fn().mockResolvedValue('account'),
    getAccountU: jest.fn().mockResolvedValue('account'),
    getContainer: jest.fn().mockResolvedValue({
      container: {} as unknown as IntegrationContainer,
      project: { _id: 'project', type: 'project-type' } as unknown as GithubProject
    }),
    getStatuses: jest.fn().mockResolvedValue(statuses),
    getTaskTypeOf: jest.fn().mockResolvedValue({ _id: 'task-type' }),
    sync: jest.fn()
  } as unknown as IntegrationManager
}

describe('GitHub issue status synchronization', () => {
  const todoStatus = { _id: 'todo-status', category: task.statusCategory.ToDo } as unknown as Status
  const activeStatus = { _id: 'active-status', category: task.statusCategory.Active } as unknown as Status
  const statuses = [todoStatus, activeStatus]
  const syncData = {
    _id: 'issue-1',
    objectClass: tracker.class.Issue,
    space: 'project',
    url: 'https://api.github.com/repos/owner/repo/issues/1'
  } as unknown as DocSyncInfo
  const document = { _id: syncData._id, status: todoStatus._id, description: '' } as unknown as Issue

  it('stores a reopened webhook without changing Todo, preventing a later poll from replaying it', async () => {
    const client = {
      findOne: jest.fn(async (_class, query) => (query._id === undefined ? syncData : document)),
      diffUpdate: jest.fn()
    }
    const derivedClient = { diffUpdate: jest.fn() }
    const manager = new IssueSyncManager(client as never, null as never, null as never)
    const provider = createProvider(statuses)
    await manager.init(provider)
    const external = createExternalIssue()
    const integration = {
      octokit: {
        graphql: jest.fn().mockResolvedValue({ repository: { issue: external } })
      }
    } as unknown as IntegrationContainer
    const event = {
      action: 'reopened',
      sender: { id: 1, login: 'github-user' },
      issue: {
        number: 1,
        state: 'open',
        state_reason: 'reopened',
        html_url: syncData.url
      }
    }

    await (
      manager as unknown as {
        processEvent: (
          ctx: MeasureContext,
          event: object,
          derivedClient: TxOperations,
          repo: GithubIntegrationRepository,
          integration: IntegrationContainer,
          project: GithubProject
        ) => Promise<void>
      }
    ).processEvent(
      createContext(),
      event,
      derivedClient as never,
      { name: 'repo', owner: { login: 'owner' } } as unknown as GithubIntegrationRepository,
      integration,
      { _id: 'project', type: 'project-type' } as unknown as GithubProject
    )

    expect(client.diffUpdate).not.toHaveBeenCalled()
    expect(derivedClient.diffUpdate).toHaveBeenCalledWith(
      syncData,
      expect.objectContaining({ external, externalVersion: githubExternalSyncVersion }),
      expect.any(Number)
    )
  })

  it('does not apply the same reopen through performDocumentExternalSync', async () => {
    const client = {
      findOne: jest.fn().mockResolvedValue(document),
      diffUpdate: jest.fn()
    }
    const manager = new IssueSyncManager(client as never, null as never, null as never)
    await manager.init(createProvider(statuses))

    await manager.performDocumentExternalSync(
      createContext(),
      syncData,
      createExternalIssue({ state: 'CLOSED', stateReason: GithubIssueStateReason.Completed }),
      createExternalIssue(),
      { diffUpdate: jest.fn() } as unknown as never
    )

    expect(client.diffUpdate).not.toHaveBeenCalled()
  })

  it('does not let an older poll revert webhook title data', async () => {
    const stored = createExternalIssue({ title: 'Webhook title', updatedAt: '2026-10-19T12:00:00.000Z' })
    const stale = createExternalIssue({ title: 'Previous title', updatedAt: '2026-10-19T11:59:59.000Z' })
    const operations = { commit: jest.fn(), diffUpdate: jest.fn() }
    const derivedClient = { apply: jest.fn().mockReturnValue(operations) }
    const manager = new IssueSyncManager({} as unknown as TxOperations, null as never, null as never)
    await manager.init(createProvider(statuses))

    await manager.syncIssues(
      createContext(),
      tracker.class.Issue,
      { _id: 'repository', githubProject: 'project', name: 'repo' } as unknown as never,
      [stale],
      derivedClient as never,
      [
        {
          ...syncData,
          external: stored,
          needSync: githubSyncVersion,
          repository: 'repository'
        } as unknown as DocSyncInfo
      ]
    )

    expect(operations.diffUpdate).not.toHaveBeenCalled()
    expect(operations.commit).toHaveBeenCalledWith(true)
  })
})
