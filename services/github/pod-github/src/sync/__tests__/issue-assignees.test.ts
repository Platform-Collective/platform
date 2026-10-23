// SPDX-License-Identifier: EPL-2.0
import type { Person } from '@hcengineering/contact'
import core, { type MeasureContext, type Ref, type TxOperations } from '@hcengineering/core'
import github, { type DocSyncInfo, type GithubProject } from '@hcengineering/github'
import tracker, { type Issue } from '@hcengineering/tracker'
import type { ContainerFocus, IntegrationContainer, IntegrationManager, UserInfo } from '../../types'
import type { IssueExternalData } from '../githubTypes'
import type { GithubIssueData, WithMarkup } from '../issueBase'

jest.mock('octokit', () => ({}), { virtual: true })
jest.mock('@octokit/webhooks-types', () => ({}), { virtual: true })
jest.mock('../../config', () => ({ default: { BotName: 'test-bot' } }))

import { IssueSyncManager } from '../issues'
import { PullRequestSyncManager } from '../pullrequests'

const LOCAL_PERSON = 'local-person' as Ref<Person>
const GITHUB_PERSON = 'github-person' as Ref<Person>
const GITHUB_USER: UserInfo = { id: 'github-id', login: 'github-user' }

describe.each([
  ['issue', IssueSyncManager],
  ['pull request', PullRequestSyncManager]
] as const)('%s assignee synchronization', (kind, Manager) => {
  let manager: IssueSyncManager | PullRequestSyncManager
  let existing: WithMarkup<Issue>
  let external: IssueExternalData
  let syncData: DocSyncInfo
  let container: ContainerFocus
  let ctx: MeasureContext
  let client: TxOperations
  let incomingData: GithubIssueData
  const diffUpdate = jest.fn()
  const update = jest.fn()
  const getGithubLogin = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const existingData: Partial<WithMarkup<Issue>> = {
      _id: 'issue-id' as Ref<Issue>,
      _class: kind === 'issue' ? tracker.class.Issue : github.class.GithubPullRequest,
      space: 'project-id' as Issue['space'],
      title: 'Title',
      description: '',
      assignee: LOCAL_PERSON
    }
    existing = existingData as WithMarkup<Issue>
    external = {
      id: 'github-issue-id',
      url: 'https://github.com/test/repo/issues/1',
      number: 1,
      title: 'Title',
      body: '',
      state: 'OPEN',
      author: { ...GITHUB_USER, name: 'GitHub User' },
      assignees: { nodes: [] },
      closed: false,
      locked: false,
      createdAt: '2026-10-23T00:00:00Z',
      updatedAt: '2026-10-23T00:00:00Z',
      lastEditedAt: '2026-10-23T00:00:00Z',
      publishedAt: '2026-10-23T00:00:00Z',
      labels: { nodes: [] },
      participants: { nodes: [] },
      reactions: { nodes: [] }
    }
    syncData = {
      _id: existing._id,
      objectClass: existing._class,
      space: existing.space,
      url: external.url,
      current: { title: existing.title, assignee: LOCAL_PERSON }
    } as unknown as DocSyncInfo
    const integration = {
      octokit: { graphql: jest.fn(async () => ({ repository: { issue: external, pullRequest: external } })) }
    } as unknown as IntegrationContainer
    const project: Pick<GithubProject, '_id'> = { _id: existing.space as Ref<GithubProject> }
    container = { container: integration, project: project as GithubProject }
    const hierarchy = {
      hasMixin: () => true,
      as: (doc: Issue) => doc,
      getAllAttributes: () =>
        new Map([
          ['assignee', {}],
          ['title', {}]
        ]),
      findAttribute: () => undefined
    }
    client = {
      findOne: jest.fn(async (cls: string) => (cls === github.class.DocSyncInfo ? syncData : existing)),
      findAll: jest.fn(async (_cls: string, query: { _id: { $in: string[] } }) =>
        query._id.$in.length > 0 ? [{ attachedTo: GITHUB_PERSON }] : []
      ),
      diffUpdate,
      update,
      getHierarchy: () => hierarchy
    } as unknown as TxOperations
    ctx = {
      with: async (_name: string, _params: unknown, fn: (ctx: MeasureContext) => Promise<unknown>) => await fn(ctx),
      info: jest.fn(),
      error: jest.fn()
    } as unknown as MeasureContext
    getGithubLogin.mockResolvedValue(undefined)
    manager = new Manager(client, null!, null!)
    await manager.init({
      getContainer: jest.fn(async () => container),
      getGithubLogin,
      getAccount: jest.fn(async () => core.account.System),
      getAccountU: jest.fn(async () => core.account.System),
      getProjectAndRepository: jest.fn(async () => ({ project: container.project, repository: { name: 'repo' } })),
      getWorkspaceId: () => 'workspace',
      getTaskTypeOf: jest.fn(),
      getStatuses: jest.fn(async () => []),
      getOctokit: jest.fn(),
      getRepositoryById: jest.fn(),
      sync: jest.fn()
    } as unknown as IntegrationManager)
    jest.spyOn(manager, 'fillBackChanges').mockResolvedValue(undefined)
    jest.spyOn(manager, 'performIssueFieldsUpdate').mockResolvedValue(false)
    jest.spyOn(manager, 'afterSync').mockResolvedValue(undefined)
  })

  async function webhook (): Promise<void> {
    const issue = { html_url: external.url, url: external.url, number: 1, assignees: [] }
    await manager.handleEvent(ctx, container.container, client, {
      action: external.assignees.nodes.length === 0 ? 'unassigned' : 'assigned',
      sender: { type: 'User', login: 'sender' },
      repository: { node_id: 'repo-id' },
      issue: { ...issue, assignees: external.assignees.nodes },
      pull_request: { ...issue, issue_url: external.url }
    })
    expect(ctx.error).not.toHaveBeenCalled()
  }

  async function externalSync (): Promise<void> {
    await manager.performDocumentExternalSync(
      ctx,
      syncData,
      { ...external, assignees: { nodes: external.assignees.nodes.length === 0 ? [external.author] : [] } },
      external,
      client
    )
  }

  async function diffSync (): Promise<void> {
    const data: Partial<GithubIssueData> = {
      title: existing.title,
      assignee: external.assignees.nodes.length > 0 ? GITHUB_PERSON : kind === 'issue' ? undefined : null
    }
    incomingData = data as GithubIssueData
    await manager.handleDiffUpdate(
      ctx,
      container,
      existing,
      syncData,
      incomingData,
      external,
      core.account.System,
      core.account.System
    )
  }

  describe.each(['webhook', 'external sync', 'diff sync'] as const)('%s', (path) => {
    async function sync (): Promise<void> {
      await { webhook, 'external sync': externalSync, 'diff sync': diffSync }[path]()
    }

    it('preserves a Huly assignee without a GitHub identity when GitHub is unassigned', async () => {
      await sync()

      if (path === 'diff sync') {
        expect(incomingData.assignee).toBe(LOCAL_PERSON)
        expect(update).not.toHaveBeenCalled()
      } else {
        expect(diffUpdate).toHaveBeenCalledWith(
          existing,
          expect.objectContaining({ assignee: LOCAL_PERSON }),
          expect.any(Number),
          core.account.System
        )
        expect(diffUpdate.mock.calls[0][1].current.assignee).toBe(LOCAL_PERSON)
      }
      expect(getGithubLogin).toHaveBeenCalledWith(container.container, LOCAL_PERSON)
    })

    it('clears a Huly assignee linked to GitHub when GitHub is unassigned', async () => {
      getGithubLogin.mockResolvedValue(GITHUB_USER)
      if (path === 'diff sync') {
        await sync()
        expect(incomingData.assignee).toBe(kind === 'issue' ? undefined : null)
        expect(update).toHaveBeenCalledWith(
          existing,
          expect.objectContaining({ assignee: null }),
          false,
          expect.any(Number),
          core.account.System
        )
      } else {
        await sync()
        expect(diffUpdate).toHaveBeenCalledWith(
          existing,
          expect.objectContaining({ assignee: null }),
          expect.any(Number),
          core.account.System
        )
      }
    })

    it('applies an incoming GitHub assignment over an unlinked Huly assignee', async () => {
      external.assignees.nodes = [external.author]
      await sync()

      if (path === 'diff sync') {
        expect(incomingData.assignee).toBe(GITHUB_PERSON)
        expect(update).toHaveBeenCalledWith(
          existing,
          expect.objectContaining({ assignee: GITHUB_PERSON }),
          false,
          expect.any(Number),
          core.account.System
        )
      } else {
        expect(diffUpdate).toHaveBeenCalledWith(
          existing,
          expect.objectContaining({ assignee: GITHUB_PERSON }),
          expect.any(Number),
          core.account.System
        )
      }
      expect(getGithubLogin).not.toHaveBeenCalled()
    })

    it('keeps an explicit Huly unassignment when GitHub is unassigned', async () => {
      existing.assignee = null
      await sync()

      if (path === 'diff sync') {
        expect(update).not.toHaveBeenCalled()
        expect(incomingData.assignee).toBe(kind === 'issue' ? undefined : null)
      } else {
        expect(diffUpdate).toHaveBeenCalledWith(
          existing,
          expect.objectContaining({ assignee: null }),
          expect.any(Number),
          core.account.System
        )
      }
      expect(getGithubLogin).not.toHaveBeenCalled()
    })
  })

  it('honors explicit Huly unassignment in outgoing synchronization', async () => {
    external.assignees.nodes = [external.author]
    const data: Pick<WithMarkup<Issue>, 'title' | 'description' | 'assignee' | 'status'> = {
      title: existing.title,
      description: '',
      assignee: LOCAL_PERSON,
      status: existing.status
    }
    const changes = await manager.collectIssueUpdate(
      syncData,
      existing,
      { assignee: null },
      data,
      container,
      external,
      existing._class
    )

    expect(changes.assigneeIds).toEqual([])
    expect(data.assignee).toBeNull()
    expect(getGithubLogin).not.toHaveBeenCalled()
  })
})
