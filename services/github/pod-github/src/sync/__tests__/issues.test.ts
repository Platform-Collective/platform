// SPDX-License-Identifier: EPL-2.0

import type { CollaboratorClient } from '@hcengineering/collaborator-client'
import { MeasureMetricsContext } from '@hcengineering/core'
import type { DocumentUpdate, Ref, TxOperations } from '@hcengineering/core'
import type { DocSyncInfo, GithubIntegrationRepository, GithubProject } from '@hcengineering/github'
import type { LiveQuery } from '@hcengineering/query'
import task from '@hcengineering/task'
import tracker from '@hcengineering/tracker'
import type { Issue, IssueStatus } from '@hcengineering/tracker'
import type { IssuesEvent } from '@octokit/webhooks-types'
import type { IntegrationContainer, IntegrationManager } from '../../types'
import type { IssueExternalData } from '../githubTypes'

jest.mock('@octokit/webhooks-types', () => ({}), { virtual: true })
jest.mock('octokit', () => ({}), { virtual: true })
jest.mock('../../config', () => ({ default: { BotName: 'test-bot' } }))

import { IssueSyncManager } from '../issues'

describe('IssueSyncManager state webhooks', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const active = { _id: 'active', category: task.statusCategory.Active } as unknown as IssueStatus
  const canceled = { _id: 'canceled', category: task.statusCategory.Lost } as unknown as IssueStatus
  const done = { _id: 'done', category: task.statusCategory.Won } as unknown as IssueStatus

  it.each([
    ['maps a not_planned closure to Canceled', 'closed', 'closed', 'not_planned', active, canceled, true],
    ['preserves an already canceled issue', 'closed', 'closed', 'not_planned', canceled, canceled, false],
    ['maps a completed closure to Done', 'closed', 'closed', 'completed', active, done, true],
    ['maps a closure without a reason to Done', 'closed', 'closed', null, active, done, true],
    ['maps a reopened issue to Active', 'reopened', 'open', 'reopened', canceled, active, true]
  ] as const)('%s', async (_name, action, state, stateReason, initialStatus, expectedStatus, shouldUpdate) => {
    const issue = { _id: 'issue', status: initialStatus._id } as unknown as Issue
    const syncData = { _id: issue._id, objectClass: tracker.class.Issue } as unknown as DocSyncInfo
    const client = {
      findOne: jest.fn().mockResolvedValueOnce(syncData).mockResolvedValueOnce(issue),
      diffUpdate: jest.fn(async (_doc: Issue, update: DocumentUpdate<Issue>) => {
        Object.assign(issue, update)
      })
    }
    const derivedClient = { diffUpdate: jest.fn() }
    const project = { _id: 'project' as Ref<GithubProject> } as unknown as GithubProject
    const provider = {
      getWorkspaceId: jest.fn().mockReturnValue('workspace'),
      getProjectAndRepository: jest.fn().mockResolvedValue({
        project,
        repository: { name: 'repository', owner: { login: 'owner' } } as unknown as GithubIntegrationRepository
      }),
      getAccountU: jest.fn().mockResolvedValue(undefined),
      getTaskTypeOf: jest.fn().mockResolvedValue(undefined),
      getStatuses: jest.fn().mockResolvedValue([active, canceled, done]),
      sync: jest.fn()
    }
    const external = { url: 'https://github.com/owner/repository/issues/1' } as unknown as IssueExternalData
    const integration = {
      octokit: { graphql: jest.fn().mockResolvedValue({ repository: { issue: external } }) }
    } as unknown as IntegrationContainer
    const event = {
      action,
      sender: { type: 'User', login: 'user' },
      repository: { node_id: 'repository' },
      issue: { number: 1, url: external.url, html_url: external.url, state, state_reason: stateReason }
    } as unknown as IssuesEvent
    const manager = new IssueSyncManager(
      client as unknown as TxOperations,
      {} as unknown as LiveQuery,
      {} as unknown as CollaboratorClient
    )
    await manager.init(provider as unknown as IntegrationManager)
    const ctx = new MeasureMetricsContext('test', {})
    const error = jest.spyOn(ctx.logger, 'error')

    await manager.handleEvent(ctx, integration, derivedClient as unknown as TxOperations, event)

    expect(error).not.toHaveBeenCalled()
    expect(client.findOne).toHaveBeenCalledTimes(2)
    expect(issue.status).toBe(expectedStatus._id)
    expect(client.diffUpdate).toHaveBeenCalledTimes(shouldUpdate ? 1 : 0)
    expect(derivedClient.diffUpdate).toHaveBeenCalledTimes(shouldUpdate ? 1 : 0)
  })
})
