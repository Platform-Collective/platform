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

import { type Person } from '@hcengineering/contact'
import { type PersonId, type Ref } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'
import { IssueSyncManager } from '../issues'
import { type IssueExternalData } from '../githubTypes'
import { type IntegrationManager } from '../../types'

jest.mock('@octokit/webhooks-types', () => ({}), { virtual: true })
jest.mock('octokit', () => ({}), { virtual: true })
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

describe('IssueSyncManager', () => {
  const hulyAssignee = 'huly-assignee' as Ref<Person>

  const createExternalIssue = (): IssueExternalData =>
    ({
      assignees: { nodes: [{ id: 'github-assignee', login: 'github-assignee', name: 'GitHub Assignee' }] }
    }) as unknown as IssueExternalData

  it('keeps GitHub assignees when the Huly assignee has no GitHub login', async () => {
    const provider = {
      getGithubLogin: jest.fn().mockResolvedValue(undefined),
      getTaskTypeOf: jest.fn().mockResolvedValue(undefined),
      getStatuses: jest.fn().mockResolvedValue([])
    }
    const manager = new IssueSyncManager(null as never, null as never, null as never)
    await manager.init(provider as unknown as IntegrationManager)

    const issueData = {
      title: 'Issue',
      description: '',
      assignee: 'github-assignee' as Ref<Person>,
      status: 'status' as Issue['status']
    }

    const update = await manager.collectIssueUpdate(
      {} as unknown as never,
      {} as unknown as never,
      { assignee: hulyAssignee },
      issueData,
      { container: {} as unknown as never, project: { type: 'project' } as unknown as never },
      createExternalIssue(),
      tracker.class.Issue
    )

    expect(update).not.toHaveProperty('assigneeIds')
    expect(issueData.assignee).toBe(hulyAssignee)
  })

  it('does not trigger a GitHub unassigned echo for an unlinked Huly assignee', async () => {
    const provider = {
      getGithubLogin: jest.fn().mockResolvedValue(undefined),
      getTaskTypeOf: jest.fn().mockResolvedValue(undefined),
      getStatuses: jest.fn().mockResolvedValue([]),
      getWorkspaceId: jest.fn().mockReturnValue('workspace')
    }
    const manager = new IssueSyncManager(null as never, null as never, null as never)
    await manager.init(provider as unknown as IntegrationManager)

    const issueData = {
      title: 'Issue',
      description: '',
      assignee: 'github-assignee' as Ref<Person>,
      status: 'status' as Issue['status']
    }
    const octokit = { graphql: jest.fn() }

    await expect(
      manager.performIssueFieldsUpdate(
        null as never,
        {} as unknown as never,
        {} as unknown as never,
        { assignee: hulyAssignee },
        issueData as never,
        { container: {} as unknown as never, project: { type: 'project' } as unknown as never },
        createExternalIssue(),
        octokit as never,
        'account' as PersonId
      )
    ).resolves.toBe(false)

    expect(octokit.graphql).not.toHaveBeenCalled()
    expect(issueData.assignee).toBe(hulyAssignee)
  })

  it('removes GitHub assignees when the Huly assignee is explicitly cleared', async () => {
    const provider = {
      getTaskTypeOf: jest.fn().mockResolvedValue(undefined),
      getStatuses: jest.fn().mockResolvedValue([])
    }
    const manager = new IssueSyncManager(null as never, null as never, null as never)
    await manager.init(provider as unknown as IntegrationManager)

    const issueData = {
      title: 'Issue',
      description: '',
      assignee: 'github-assignee' as Ref<Person>,
      status: 'status' as Issue['status']
    }

    const update = await manager.collectIssueUpdate(
      {} as unknown as never,
      {} as unknown as never,
      { assignee: null },
      issueData,
      { container: {} as unknown as never, project: { type: 'project' } as unknown as never },
      createExternalIssue(),
      tracker.class.Issue
    )

    expect(update).toMatchObject({ assigneeIds: [] })
    expect(issueData.assignee).toBeNull()
  })
})
