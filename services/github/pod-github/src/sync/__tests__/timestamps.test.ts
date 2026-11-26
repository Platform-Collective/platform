// SPDX-License-Identifier: EPL-2.0

/* eslint @typescript-eslint/dot-notation: ["error", { "allowPrivateClassPropertyAccess": true }] */

jest.mock('@octokit/webhooks-types', () => ({}), { virtual: true })
jest.mock('octokit', () => ({}), { virtual: true })
jest.mock('../../config', () => ({ default: { BotName: 'test-bot' } }))

import core from '@hcengineering/core'
import type { Doc, PersonId, Ref, TxCreateDoc, TxMixin, TxUpdateDoc } from '@hcengineering/core'
import contact from '@hcengineering/contact'
import type { CollaboratorClient } from '@hcengineering/collaborator-client'
import github, { GithubPullRequestState } from '@hcengineering/github'
import type { DocSyncInfo, GithubIntegrationRepository, GithubProject, GithubPullRequest } from '@hcengineering/github'
import type { LiveQuery } from '@hcengineering/query'
import type { TaskType } from '@hcengineering/task'
import time from '@hcengineering/time'
import tracker from '@hcengineering/tracker'
import type { Issue } from '@hcengineering/tracker'
import type { ContainerFocus, IntegrationContainer, IntegrationManager } from '../../types'
import { githubExternalSyncVersion } from '../../types'
import type { PullRequestExternalData } from '../githubTypes'
import type { GithubIssueData, WithMarkup } from '../issueBase'
import { IssueSyncManager } from '../issues'
import { PullRequestSyncManager } from '../pullrequests'
import { ReviewSyncManager } from '../reviews'
import { ReviewCommentSyncManager } from '../reviewComments'
import { ReviewThreadSyncManager } from '../reviewThreads'
import { getGithubModifiedOn, getSince, getSinceRaw, githubTime, isGithubTimestampPreservationEnabled } from '../utils'
import { TimestampStore } from './timestamp-store'

const CREATED = Date.parse('2020-01-01T00:00:00Z')
const SOURCE = Date.parse('2021-01-01T00:00:00Z')
const LOCAL = Date.parse('2022-01-01T00:00:00Z')
const NOW = Date.parse('2025-01-01T00:00:00Z')
const account = 'author-account' as PersonId
const taskType = 'task-type' as Ref<TaskType>
const project = { _id: 'project', identifier: 'TEST', type: 'project-type' } as unknown as GithubProject
const repository = {
  _id: 'repo',
  name: 'repo',
  url: 'https://github.com/org/repo',
  githubProject: project._id
} as unknown as GithubIntegrationRepository
const info = {
  _id: 'issue',
  _class: github.class.DocSyncInfo,
  space: project._id,
  repository: repository._id,
  objectClass: tracker.class.Issue,
  current: { title: 'Title', description: '' }
} as unknown as DocSyncInfo
const external = {
  id: 'external',
  number: 1,
  title: 'Title',
  body: '',
  url: 'https://github.com/org/repo/issues/1',
  createdAt: new Date(CREATED).toISOString(),
  updatedAt: new Date(SOURCE).toISOString(),
  author: { id: 'author', login: 'author' },
  assignees: { nodes: [] },
  state: 'OPEN',
  reviews: { nodes: [] },
  latestReviews: { nodes: [] },
  reviewThreads: { nodes: [] }
} as unknown as PullRequestExternalData
const issueData = {
  title: 'Title',
  description: '',
  status: 'status',
  assignee: null
} as unknown as GithubIssueData & { status: Issue['status'] }

function seed (store: TimestampStore, cls: Doc['_class'], id: string, data: Record<string, unknown> = {}): Doc {
  const doc = {
    _id: id as Ref<Doc>,
    _class: cls,
    space: project._id,
    createdOn: CREATED,
    modifiedOn: CREATED,
    createdBy: core.account.System,
    modifiedBy: core.account.System,
    ...data
  }
  const target = cls === github.class.DocSyncInfo ? store.metadata : store.docs
  target.set(id, doc)
  return structuredClone(doc)
}

function issue (store: TimestampStore, modifiedOn = CREATED, mixin = true): WithMarkup<Issue> {
  return seed(store, tracker.class.Issue, 'issue', {
    ...issueData,
    modifiedOn,
    identifier: 'TEST-1',
    attachedTo: tracker.ids.NoParent,
    attachedToClass: tracker.class.Issue,
    collection: 'subIssues',
    activity: 0,
    ...(mixin ? { [github.mixin.GithubIssue]: { githubNumber: 1, url: external.url, repository: repository._id } } : {})
  }) as unknown as WithMarkup<Issue>
}

function setup (store: TimestampStore): { manager: PullRequestSyncManager, issues: IssueSyncManager } {
  seed(store, tracker.class.Project, project._id, { sequence: 0, identifier: project.identifier })
  const collaborator = { updateMarkup: jest.fn().mockResolvedValue(undefined) } as unknown as CollaboratorClient
  const manager = new PullRequestSyncManager(store.client, null as unknown as LiveQuery, collaborator)
  const issues = new IssueSyncManager(store.client, null as unknown as LiveQuery, collaborator)
  const provider = {
    getRepositoryById: async () => repository,
    getOctokit: async () => undefined,
    getWorkspaceId: () => 'workspace',
    getAccount: async () => account,
    sync: jest.fn()
  } as unknown as IntegrationManager
  manager.provider = provider
  issues.provider = provider
  jest.spyOn(manager, 'fillBackChanges').mockResolvedValue(undefined)
  jest.spyOn(manager, 'performIssueFieldsUpdate').mockResolvedValue(false)
  return { manager, issues }
}

const container = { container: { octokit: {} }, project } as unknown as ContainerFocus

function reviewFixture (store: TimestampStore, purpose: 'review' | 'fix'): PullRequestExternalData {
  seed(store, contact.class.Person, 'reviewer', { [contact.mixin.Employee]: {} })
  seed(store, contact.class.Person, 'author', { [contact.mixin.Employee]: {} })
  seed(store, contact.class.SocialIdentity, account, { attachedTo: 'author' })
  return {
    ...external,
    reviews: {
      nodes:
        purpose === 'fix'
          ? [
              {
                id: 'review',
                author: external.author,
                state: 'CHANGES_REQUESTED',
                updatedAt: external.updatedAt
              }
            ]
          : [],
      totalCount: purpose === 'fix' ? 1 : 0
    },
    latestReviews: { nodes: [], totalCount: 0 },
    reviewThreads: { nodes: [], totalCount: 0 }
  } as unknown as PullRequestExternalData
}

let store: TimestampStore
let originalTimestampFlag: string | undefined
beforeEach(() => {
  originalTimestampFlag = process.env.GITHUB_PRESERVE_SOURCE_TIMESTAMPS
  process.env.GITHUB_PRESERVE_SOURCE_TIMESTAMPS = 'true'
  jest.useFakeTimers().setSystemTime(NOW)
})
afterEach(() => {
  if (originalTimestampFlag === undefined) {
    delete process.env.GITHUB_PRESERVE_SOURCE_TIMESTAMPS
  } else {
    process.env.GITHUB_PRESERVE_SOURCE_TIMESTAMPS = originalTimestampFlag
  }
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe.each(['mongo', 'postgres'] as const)('%s transaction ordering and derived collections', (backend) => {
  beforeEach(() => {
    store = new TimestampStore(backend)
  })

  it('imports an edited, comment-free issue at createdAt and preserves System authorship', async () => {
    const { issues, manager } = setup(store)
    await issues['createNewIssue'](
      store.ctx,
      info,
      account,
      issueData,
      external,
      repository._id,
      project,
      taskType,
      repository,
      false
    )
    expect(store.docs.get('issue')).toMatchObject({ createdOn: CREATED, modifiedOn: CREATED, activity: 1 })
    const mixin = store.txes.find((tx) => tx._class === core.class.TxMixin) as TxMixin<Doc, Doc>
    const message = store.txes.find((tx) => tx.attachedTo === 'issue') as TxCreateDoc<Doc>
    expect(mixin.modifiedBy).toBe(core.account.System)
    expect(message.modifiedBy).toBe(core.account.System)
    const txCount = store.txes.length
    jest.spyOn(manager, 'afterSync').mockResolvedValue(undefined)
    const fresh = store.findAll(tracker.class.Issue, { _id: 'issue' as Ref<Issue> })[0] as unknown as WithMarkup<Issue>
    await manager.handleDiffUpdate(store.ctx, container, fresh, info, issueData, external, account, account)
    expect(store.txes).toHaveLength(txCount)
  })

  it.each(['review', 'fix'] as const)('imports a PR with a %s todo across separate commits', async (purpose) => {
    const { manager } = setup(store)
    const batch = store.client.apply()
    const pr = await manager['createPullRequest'](
      batch,
      info,
      account,
      issueData as Parameters<(typeof manager)['createPullRequest']>[3],
      external,
      repository._id,
      project,
      taskType,
      repository,
      false
    )
    expect(store.docs.has('issue')).toBe(false)
    expect(store.missingParents).toContain('issue')
    const messages = store.txes.filter((tx) => tx.attachedTo === 'issue')
    expect(messages).toHaveLength(1)
    expect(messages[0].modifiedOn).toBe(CREATED)
    await batch.commit()
    expect(store.docs.get('issue')).toMatchObject({ createdOn: CREATED, modifiedOn: CREATED })
    const data = reviewFixture(store, purpose)
    pr.reviewers = purpose === 'review' ? ['reviewer' as Ref<never>] : []
    pr.state = GithubPullRequestState.open
    const todoBatch = store.client.apply()
    await manager.todoSync(store.ctx, todoBatch, pr, data, info, account)
    await todoBatch.commit()
    expect(store.docs.get('issue')).toMatchObject({ createdOn: CREATED, modifiedOn: NOW, todos: 1 })
    const todo = Array.from(store.docs.values()).find((doc) => doc._class === time.class.ProjectToDo)
    expect(todo).toMatchObject({ createdOn: NOW, modifiedOn: NOW })
    const count = store.txes.length
    await manager.todoSync(store.ctx, store.client, pr, data, info, account)
    expect(store.txes).toHaveLength(count)
  })

  it.each<[boolean, number]>([
    [false, CREATED],
    [false, LOCAL],
    [true, CREATED],
    [true, LOCAL]
  ])('connects/reconnects using max(existing, source), mixin=%s existing=%s', async (mixin, modifiedOn) => {
    const { manager } = setup(store)
    jest.spyOn(manager, 'afterSync').mockResolvedValue(undefined)
    const snapshot = issue(store, CREATED, mixin)
    if (mixin) {
      const raw = store.docs.get('issue') as Doc & Record<string, unknown>
      raw[github.mixin.GithubIssue] = { githubNumber: 1, url: 'old-url', repository: repository._id }
      Object.assign(snapshot, structuredClone(raw))
    }
    store.docs.get('issue')!.modifiedOn = Number(modifiedOn)
    await manager.handleDiffUpdate(store.ctx, container, snapshot, info, issueData, external, account, account)
    expect(store.docs.get('issue')).toMatchObject({
      createdOn: CREATED,
      modifiedOn: Math.max(Number(modifiedOn), SOURCE),
      activity: 1
    })
    const fresh = store.findAll(tracker.class.Issue, { _id: snapshot._id })[0] as unknown as WithMarkup<Issue>
    const count = store.txes.length
    await manager.handleDiffUpdate(store.ctx, container, fresh, info, issueData, external, account, account)
    expect(store.txes).toHaveLength(count)
  })

  it.each([CREATED, LOCAL])('updates fields using max(existing, source), existing=%s', async (modifiedOn) => {
    const { manager } = setup(store)
    jest.spyOn(manager, 'afterSync').mockResolvedValue(undefined)
    const snapshot = issue(store, modifiedOn)
    await manager.handleDiffUpdate(
      store.ctx,
      container,
      snapshot,
      info,
      { ...issueData, title: 'GitHub edit' },
      external,
      account,
      account
    )
    expect(store.docs.get('issue')).toMatchObject({
      createdOn: CREATED,
      modifiedOn: Math.max(modifiedOn, SOURCE),
      title: 'GitHub edit'
    })
  })

  it('re-reads the stored date after a local edit during the awaited field sync', async () => {
    const { manager } = setup(store)
    jest.spyOn(manager, 'afterSync').mockResolvedValue(undefined)
    const snapshot = issue(store)
    jest.spyOn(manager, 'performIssueFieldsUpdate').mockImplementation(async () => {
      store.docs.get('issue')!.modifiedOn = LOCAL
      return false
    })
    await manager.handleDiffUpdate(
      store.ctx,
      container,
      snapshot,
      info,
      { ...issueData, title: 'GitHub edit' },
      external,
      account,
      account
    )
    expect(store.docs.get('issue')).toMatchObject({ createdOn: CREATED, modifiedOn: LOCAL })
  })

  it.each([
    ['review', false, CREATED],
    ['review', false, LOCAL],
    ['review', true, CREATED],
    ['review', true, LOCAL],
    ['fix', false, CREATED],
    ['fix', false, LOCAL],
    ['fix', true, CREATED],
    ['fix', true, LOCAL]
  ] as const)('keeps %s todo notifications current, fields=%s stored=%s', async (purpose, fields, stored) => {
    const { manager } = setup(store)
    const data = reviewFixture(store, purpose)
    const pr = seed(store, github.class.GithubPullRequest, 'issue', {
      ...issueData,
      identifier: 'TEST-1',
      state: GithubPullRequestState.open,
      attachedTo: tracker.ids.NoParent,
      attachedToClass: tracker.class.Issue,
      collection: 'subIssues',
      reviewers: purpose === 'review' ? ['reviewer'] : [],
      todos: 0,
      [github.mixin.GithubIssue]: { githubNumber: 1, url: external.url, repository: repository._id }
    }) as unknown as GithubPullRequest & WithMarkup<Issue>
    // A local edit during the awaited sync must survive the field write before the current todo is added.
    jest.spyOn(manager, 'performIssueFieldsUpdate').mockImplementation(async () => {
      store.docs.get('issue')!.modifiedOn = stored
      return false
    })
    const current = fields ? { ...issueData, title: 'Field update' } : issueData
    await manager.handleDiffUpdate(store.ctx, container, pr, info, current, data, account, account)
    const modifiedOn = NOW
    expect(store.docs.get('issue')).toMatchObject({
      createdOn: CREATED,
      modifiedOn,
      title: current.title,
      todos: 1
    })
    const createTx = store.txes.find((tx) => tx.objectClass === time.class.ProjectToDo) as TxCreateDoc<Doc>
    expect(createTx.modifiedOn).toBe(modifiedOn) // The notification trigger uses this time as well.
    expect(createTx.modifiedBy).toBe(account)
    expect(store.docs.get(createTx.objectId)).toMatchObject({ createdOn: modifiedOn, modifiedOn })
    const todoMixin = store.txes.find(
      (tx) => tx.objectId === createTx.objectId && tx._class === core.class.TxMixin
    ) as TxMixin<Doc, Doc>
    expect(todoMixin).toMatchObject({ modifiedOn: NOW, modifiedBy: account, attributes: { purpose } })
    if (fields) {
      const fieldTx = store.txes.find(
        (tx) => tx.objectId === pr._id && (tx as TxUpdateDoc<Issue>).operations?.title === current.title
      )
      expect(fieldTx).toMatchObject({ modifiedOn: Math.max(stored, SOURCE) })
    }
    const count = store.txes.length
    await manager.afterSync(store.ctx, pr, account, data, info)
    expect(store.txes).toHaveLength(count)
    expect(store.docs.get('issue')).toMatchObject({ createdOn: CREATED, modifiedOn, todos: 1 })
  })

  it('stores source time in webhook scheduling metadata and preserves the newer document date', async () => {
    const { manager } = setup(store)
    issue(store, LOCAL)
    seed(store, github.class.DocSyncInfo, 'issue', { ...info })
    const state = { ...info, _id: 'issue' } as unknown as DocSyncInfo
    await manager.handleUpdate(
      store.ctx,
      external,
      store.client,
      { title: 'Webhook edit' },
      account,
      project,
      false,
      state
    )
    expect(store.docs.get('issue')).toMatchObject({ title: 'Webhook edit', createdOn: CREATED, modifiedOn: LOCAL })
    expect(store.metadata.get('issue')).toMatchObject({ lastModified: SOURCE })
    const syncTx = store.txes.find((tx) => tx.objectClass === github.class.DocSyncInfo) as unknown as {
      operations: { lastModified: number }
    }
    expect(syncTx.operations.lastModified).toBe(SOURCE)
  })

  it('records webhook source metadata when the platform document has not been created yet', async () => {
    const { manager } = setup(store)
    const state = seed(store, github.class.DocSyncInfo, 'issue', { ...info }) as DocSyncInfo
    await manager.handleUpdate(
      store.ctx,
      external,
      store.client,
      { title: 'Webhook edit' },
      account,
      project,
      false,
      state
    )
    expect(store.docs.has('issue')).toBe(false)
    expect(store.metadata.get('issue')).toMatchObject({ lastModified: SOURCE, needSync: '' })
  })

  it.each([undefined, 'invalid'])('uses one finite timestamp for an import with createdAt=%s', async (createdAt) => {
    const { issues } = setup(store)
    const data = { ...external, createdAt } as unknown as PullRequestExternalData
    await issues['createNewIssue'](
      store.ctx,
      info,
      account,
      issueData,
      data,
      repository._id,
      project,
      taskType,
      repository,
      false
    )
    expect(store.docs.get('issue')).toMatchObject({ createdOn: NOW, modifiedOn: NOW, activity: 1 })
  })
})

describe.each([undefined, 'false', 'TRUE'])('legacy timestamp policy with flag=%s', (flag) => {
  beforeEach(() => {
    if (flag === undefined) {
      delete process.env.GITHUB_PRESERVE_SOURCE_TIMESTAMPS
    } else {
      process.env.GITHUB_PRESERVE_SOURCE_TIMESTAMPS = flag
    }
    store = new TimestampStore('mongo')
  })

  it('keeps timestamp preservation disabled and avoids the stored-date read', async () => {
    const snapshot = issue(store, LOCAL)
    const read = jest.spyOn(store.client, 'findOne')
    expect(isGithubTimestampPreservationEnabled()).toBe(false)
    expect(await getGithubModifiedOn(store.client, snapshot, external.updatedAt)).toBe(NOW)
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['issue', 'PR'])('keeps processing-time mixins and connection activity for a new %s', async (kind) => {
    const { issues, manager } = setup(store)
    if (kind === 'issue') {
      await issues['createNewIssue'](
        store.ctx,
        info,
        account,
        issueData,
        external,
        repository._id,
        project,
        taskType,
        repository,
        false
      )
    } else {
      const batch = store.client.apply()
      await manager['createPullRequest'](
        batch,
        info,
        account,
        issueData as Parameters<(typeof manager)['createPullRequest']>[3],
        external,
        repository._id,
        project,
        taskType,
        repository,
        false
      )
      await batch.commit()
    }
    expect(store.docs.get('issue')).toMatchObject({ createdOn: CREATED, modifiedOn: NOW })
    const message = store.txes.find((tx) => tx.attachedTo === 'issue')
    const mixin = store.txes.find((tx) => tx._class === core.class.TxMixin)
    expect(message).toMatchObject({ modifiedOn: NOW, modifiedBy: core.account.System })
    expect(mixin).toMatchObject({ modifiedOn: NOW, modifiedBy: core.account.System })
  })

  it('keeps processing-time field updates and webhook scheduling metadata', async () => {
    const { manager } = setup(store)
    jest.spyOn(manager, 'afterSync').mockResolvedValue(undefined)
    const snapshot = issue(store, LOCAL)
    await manager.handleDiffUpdate(
      store.ctx,
      container,
      snapshot,
      info,
      { ...issueData, title: 'Polling edit' },
      external,
      account,
      account
    )
    expect(store.docs.get('issue')).toMatchObject({ title: 'Polling edit', modifiedOn: NOW })
    seed(store, github.class.DocSyncInfo, 'issue', { ...info })
    await manager.handleUpdate(store.ctx, external, store.client, { title: 'Webhook edit' }, account, project, false, {
      ...info
    })
    expect(store.docs.get('issue')).toMatchObject({ title: 'Webhook edit', createdOn: CREATED, modifiedOn: NOW })
    expect(store.metadata.get('issue')).toMatchObject({ lastModified: NOW })
  })

  it.each([false, true])('keeps processing-time connection activity, reconnect=%s', async (reconnect) => {
    const { manager } = setup(store)
    jest.spyOn(manager, 'afterSync').mockResolvedValue(undefined)
    const snapshot = issue(store, LOCAL, reconnect)
    if (reconnect) {
      const data = { [github.mixin.GithubIssue]: { githubNumber: 1, url: 'old-url', repository: repository._id } }
      Object.assign(snapshot, structuredClone(data))
      Object.assign(store.docs.get('issue')!, data)
    }
    await manager.handleDiffUpdate(store.ctx, container, snapshot, info, issueData, external, account, account)
    expect(store.docs.get('issue')).toMatchObject({ createdOn: CREATED, modifiedOn: NOW, activity: 1 })
  })

  it.each(['review', 'fix'] as const)('keeps %s todo creation and notification dates current', async (purpose) => {
    const { manager } = setup(store)
    const data = reviewFixture(store, purpose)
    const pr = seed(store, github.class.GithubPullRequest, 'issue', {
      identifier: 'TEST-1',
      title: 'Title',
      state: GithubPullRequestState.open,
      reviewers: purpose === 'review' ? ['reviewer'] : [],
      modifiedOn: LOCAL,
      todos: 0
    }) as GithubPullRequest
    await manager.todoSync(store.ctx, store.client, pr, data, info, account)
    const createTx = store.txes.find((tx) => tx.objectClass === time.class.ProjectToDo) as TxCreateDoc<Doc>
    expect(createTx).toMatchObject({ modifiedOn: NOW, modifiedBy: account })
    expect(store.docs.get(createTx.objectId)).toMatchObject({ createdOn: NOW, modifiedOn: NOW })
    expect(store.docs.get('issue')).toMatchObject({ createdOn: CREATED, modifiedOn: NOW, todos: 1 })
    const count = store.txes.length
    await manager.todoSync(store.ctx, store.client, pr, data, info, account)
    expect(store.txes).toHaveLength(count)
  })
})

describe('date parsing and polling cursors', () => {
  beforeEach(() => {
    store = new TimestampStore('mongo')
  })

  it.each([null, undefined, '', 'invalid'])('uses a finite fallback for %s', (iso) => {
    expect(githubTime(iso, LOCAL)).toBe(LOCAL)
    expect(githubTime(iso)).toBe(NOW)
  })

  it('reads the stored date before choosing the modification time when enabled', async () => {
    const snapshot = issue(store)
    store.docs.get('issue')!.modifiedOn = LOCAL
    const read = jest.spyOn(store.client, 'findOne')
    expect(await getGithubModifiedOn(store.client, snapshot, external.updatedAt)).toBe(LOCAL)
    expect(read).toHaveBeenCalledWith(snapshot._class, { _id: snapshot._id })
  })

  it('parses valid dates and accepts epoch zero', () => {
    expect(githubTime(external.updatedAt)).toBe(SOURCE)
    expect(githubTime('1970-01-01T00:00:00Z')).toBe(0)
  })

  it('falls back to now on existing docs without a usable source timestamp', async () => {
    const snapshot = issue(store, LOCAL)
    expect(await getGithubModifiedOn(store.client, snapshot, 'invalid')).toBe(NOW)
  })

  it('replays replaced legacy cursor dates while untouched rows can stay ahead', async () => {
    const metadata = {
      repository: repository._id,
      objectClass: tracker.class.Issue,
      externalVersion: githubExternalSyncVersion,
      lastModified: NOW
    }
    seed(store, github.class.DocSyncInfo, 'legacy-1', metadata)
    seed(store, github.class.DocSyncInfo, 'legacy-2', metadata)
    expect(await getSinceRaw(store.client, tracker.class.Issue, repository)).toBe(NOW)
    Object.assign(store.metadata.get('legacy-1')!, { lastModified: SOURCE })
    expect(await getSinceRaw(store.client, tracker.class.Issue, repository)).toBe(NOW)
    Object.assign(store.metadata.get('legacy-2')!, { lastModified: SOURCE })
    expect(await getSinceRaw(store.client, tracker.class.Issue, repository)).toBe(SOURCE)
    expect(await getSince(store.client, tracker.class.Issue, repository)).toBe(new Date(SOURCE + 1).toISOString())
  })
})

describe.each([false, true])('child timestamps, enabled=%s', (enabled) => {
  beforeEach(() => {
    process.env.GITHUB_PRESERVE_SOURCE_TIMESTAMPS = String(enabled)
    store = new TimestampStore('mongo')
  })

  it.each(['dismissed', 'edited', 'resolved', 'unresolved'] as const)(
    'uses the mutation date for %s, without changing parent counters or dates',
    async (action) => {
      const cls =
        action === 'dismissed'
          ? github.class.GithubReview
          : action === 'edited'
            ? github.class.GithubReviewComment
            : github.class.GithubReviewThread
      issue(store, LOCAL)
      seed(store, cls, 'child', {
        attachedTo: 'issue',
        attachedToClass: tracker.class.Issue,
        collection: 'activity',
        modifiedOn: LOCAL,
        isResolved: action === 'unresolved',
        body: 'old body'
      })
      seed(store, github.class.DocSyncInfo, 'child', { objectClass: cls, url: 'child-url', current: {} })
      const provider = {
        getAccountU: async () => account,
        getMarkupSafe: async () => 'new body',
        sync: jest.fn()
      } as unknown as IntegrationManager
      const integration = {
        octokit: {
          graphql: async () => ({
            node: {
              updatedAt: external.updatedAt,
              submittedAt: external.createdAt
            }
          })
        }
      } as unknown as IntegrationContainer
      const event = {
        action,
        sender: {},
        review: { html_url: 'child-url', node_id: 'child-node', submitted_at: external.createdAt },
        comment: { html_url: 'child-url', node_id: 'child-node', updated_at: external.updatedAt, body: 'new body' },
        thread: { node_id: 'child-url' }
      }
      if (action === 'dismissed') {
        const manager = new ReviewSyncManager(store.client, null as unknown as LiveQuery)
        manager.provider = provider
        await manager['processEvent'](
          store.ctx,
          event as unknown as Parameters<(typeof manager)['processEvent']>[1],
          store.client,
          repository,
          integration
        )
      } else if (action === 'edited') {
        const manager = new ReviewCommentSyncManager(store.client, null as unknown as LiveQuery)
        manager.provider = provider
        await manager['processEvent'](
          store.ctx,
          event as unknown as Parameters<(typeof manager)['processEvent']>[1],
          store.client,
          repository,
          integration
        )
      } else {
        const manager = new ReviewThreadSyncManager(store.client, null as unknown as LiveQuery)
        manager.provider = provider
        await manager['processEvent'](
          store.ctx,
          event as unknown as Parameters<(typeof manager)['processEvent']>[1],
          store.client,
          repository,
          integration
        )
      }
      expect(store.docs.get('child')).toMatchObject({
        createdOn: CREATED,
        modifiedOn: enabled && (action === 'dismissed' || action === 'edited') ? LOCAL : NOW
      })
      expect(store.metadata.get('child')).toMatchObject({
        lastModified: enabled && (action === 'dismissed' || action === 'edited') ? SOURCE : NOW
      })
      expect(store.docs.get('issue')).toMatchObject({ createdOn: CREATED, modifiedOn: LOCAL, activity: 0 })
    }
  )

  it('retains the review submittedAt-to-createdAt fallback on import', async () => {
    const manager = new ReviewSyncManager(store.client, null as unknown as LiveQuery)
    const parent = { ...info, objectClass: tracker.class.Issue }
    const childInfo = { ...info, _id: 'child' } as unknown as DocSyncInfo
    await manager['createReview'](
      store.ctx,
      childInfo,
      { body: '', comments: [] } as unknown as Parameters<(typeof manager)['createReview']>[2],
      parent,
      { createdAt: external.createdAt, submittedAt: null } as unknown as Parameters<
        (typeof manager)['createReview']
      >[4],
      account
    )
    expect(store.docs.get('child')).toMatchObject({ createdOn: CREATED, modifiedOn: CREATED })
  })
})
