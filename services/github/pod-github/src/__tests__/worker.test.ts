// SPDX-License-Identifier: EPL-2.0

import contact, { type Person } from '@hcengineering/contact'
import { SocialIdType, type Client, type Ref, type TxOperations } from '@hcengineering/core'
import github, { type DocSyncInfo, type GithubUserInfo } from '@hcengineering/github'
import tracker, { type Issue } from '@hcengineering/tracker'
import type { ContainerFocus, IntegrationContainer, IntegrationManager, UserInfo } from '../types'
import type { IssueExternalData } from '../sync/githubTypes'
import type { WithMarkup } from '../sync/issueBase'

jest.mock('@octokit/webhooks-types', () => ({}), { virtual: true })
jest.mock('octokit', () => ({}))
jest.mock('../config', () => ({ default: {} }))
jest.mock('../platform', () => ({}))
jest.mock('../client', () => ({}))
jest.mock('../collaborator', () => ({}))
jest.mock('../markdown', () => ({}))
jest.mock('../notifications', () => ({}))
jest.mock('../sync/users', () => ({}))
jest.mock('@hcengineering/server-client', () => ({}))
jest.mock('@hcengineering/server-guest-resources', () => ({}))

import { GithubWorker } from '../worker'
import { IssueSyncManager } from '../sync/issues'

const PERSON = 'person' as Ref<Person>
const SOCIAL_ID = 'github-account'
const USER: UserInfo = { id: 'github-user-node-id', login: 'LinkedUser', name: 'Linked User' }
const NORMALIZED_USER: UserInfo = { ...USER, login: 'linkeduser' }

function setup (cached?: Partial<GithubUserInfo>): {
  worker: GithubWorker
  container: IntegrationContainer
  findOne: jest.Mock
  findAll: jest.Mock
  createDoc: jest.Mock
  diffUpdate: jest.Mock
  graphql: jest.Mock
} {
  const findOne = jest.fn(async (_class: string) => {
    if (_class === contact.class.Person) return { _id: PERSON }
    if (_class === contact.class.SocialIdentity) return { _id: SOCIAL_ID, attachedTo: PERSON }
    if (_class === github.class.GithubUserInfo) return cached
    return undefined
  })
  const findAll = jest
    .fn()
    .mockResolvedValue([
      { _id: SOCIAL_ID, type: SocialIdType.GITHUB, value: NORMALIZED_USER.login, attachedTo: PERSON }
    ])
  const createDoc = jest.fn().mockResolvedValue('github-user-info')
  const diffUpdate = jest.fn().mockResolvedValue(undefined)
  const graphql = jest.fn().mockResolvedValue({ user: USER })
  const client = { findOne, findAll }
  const worker: GithubWorker = Object.assign(Object.create(GithubWorker.prototype), {
    client: client as unknown as Client,
    _client: { ...client, createDoc, diffUpdate } as unknown as TxOperations,
    liveQuery: { findOne: jest.fn().mockResolvedValue(cached) },
    accountMap: new Map()
  })
  const container = { octokit: { graphql } } as unknown as IntegrationContainer
  return { worker, container, findOne, findAll, createDoc, diffUpdate, graphql }
}

describe('GithubWorker.getGithubLogin', () => {
  it('returns the fetched profile when the cache is missing', async () => {
    const { worker, container, createDoc, diffUpdate, graphql } = setup()

    const result = await worker.getGithubLogin(container, PERSON)

    expect(result).toEqual(NORMALIZED_USER)
    expect(graphql).toHaveBeenCalledWith(expect.any(String), { login: NORMALIZED_USER.login })
    expect(createDoc).toHaveBeenCalledWith(github.class.GithubUserInfo, contact.space.Contacts, NORMALIZED_USER)
    expect(diffUpdate).not.toHaveBeenCalled()
  })

  it('returns the refreshed profile when the cached profile has no GitHub node ID', async () => {
    const cached = { _id: 'github-user-info' as Ref<GithubUserInfo>, login: NORMALIZED_USER.login, name: 'Old Name' }
    const { worker, container, createDoc, diffUpdate } = setup(cached)

    const result = await worker.getGithubLogin(container, PERSON)

    expect(result).toEqual(NORMALIZED_USER)
    expect(diffUpdate).toHaveBeenCalledWith(cached, NORMALIZED_USER)
    expect(createDoc).not.toHaveBeenCalled()
    expect(cached).toEqual({ _id: 'github-user-info', login: NORMALIZED_USER.login, name: 'Old Name' })
  })

  it('uses a complete cached profile without fetching or writing', async () => {
    const cached = { ...NORMALIZED_USER, _id: 'github-user-info' as Ref<GithubUserInfo> }
    const { worker, container, createDoc, diffUpdate, graphql } = setup(cached)

    expect(await worker.getGithubLogin(container, PERSON)).toBe(cached)
    expect(graphql).not.toHaveBeenCalled()
    expect(createDoc).not.toHaveBeenCalled()
    expect(diffUpdate).not.toHaveBeenCalled()
  })

  it('returns undefined when the person does not exist', async () => {
    const { worker, container, findOne, findAll, graphql } = setup()
    findOne.mockResolvedValueOnce(undefined)

    expect(await worker.getGithubLogin(container, PERSON)).toBeUndefined()
    expect(findAll).not.toHaveBeenCalled()
    expect(graphql).not.toHaveBeenCalled()
  })

  it('returns undefined when the person has no linked GitHub identity', async () => {
    const { worker, container, findAll, graphql } = setup()
    findAll.mockResolvedValueOnce([])

    expect(await worker.getGithubLogin(container, PERSON)).toBeUndefined()
    expect(graphql).not.toHaveBeenCalled()
  })
})

describe('issue assignment with a linked GitHub identity', () => {
  it.each([undefined, { login: NORMALIZED_USER.login }])(
    'sends the fetched node ID to GitHub with cache %j',
    async (cached) => {
      const { worker, container } = setup(cached)
      const manager = new IssueSyncManager(worker._client, worker.liveQuery, worker.collaborator)
      await manager.init({
        getGithubLogin: worker.getGithubLogin.bind(worker),
        getTaskTypeOf: jest.fn(),
        getStatuses: jest.fn().mockResolvedValue([])
      } as unknown as IntegrationManager)
      const issueData = { assignee: PERSON } as unknown as WithMarkup<Issue>
      const focus = { container, project: {} } as unknown as ContainerFocus

      const update = await manager.collectIssueUpdate(
        {} as unknown as DocSyncInfo,
        issueData,
        { assignee: PERSON },
        issueData,
        focus,
        { assignees: { nodes: [] } } as unknown as IssueExternalData,
        tracker.class.Issue
      )

      expect(update.assigneeIds).toEqual([USER.id])
    }
  )

  it('keeps a GitHub assignee after resolving it to the linked Huly person', async () => {
    const { worker, container } = setup()
    const manager = new IssueSyncManager(worker._client, worker.liveQuery, worker.collaborator)
    await manager.init({
      getAccount: worker.getAccount.bind(worker),
      getGithubLogin: worker.getGithubLogin.bind(worker),
      getTaskTypeOf: jest.fn(),
      getStatuses: jest.fn().mockResolvedValue([])
    } as unknown as IntegrationManager)
    const external = { assignees: { nodes: [USER] } } as unknown as IssueExternalData

    const assignees = await manager.getAssignees(external)
    expect(assignees).toEqual([PERSON])

    const issueData = { assignee: assignees[0] } as unknown as WithMarkup<Issue>
    const update = await manager.collectIssueUpdate(
      {} as unknown as DocSyncInfo,
      issueData,
      { assignee: assignees[0] },
      issueData,
      { container, project: {} } as unknown as ContainerFocus,
      external,
      tracker.class.Issue
    )

    expect(update).not.toHaveProperty('assigneeIds')
    expect(issueData.assignee).toBe(PERSON)
  })
})
