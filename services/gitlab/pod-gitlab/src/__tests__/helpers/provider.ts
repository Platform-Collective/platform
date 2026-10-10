// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import type { Person } from '@hcengineering/contact'
import { MeasureMetricsContext, type PersonId, type Ref, type WorkspaceUuid } from '@hcengineering/core'
import type { GitlabApi } from '../../gitlab/api'
import type { GitlabUserRef } from '../../gitlab/types'
import { createMarkdownConverter } from '../../markdown'
import { ContentConverter } from '../../sync/content'
import type { PersonMapping } from '../../sync/persons'
import { SyncRunner } from '../../sync/runner'
import type { ImageStore, PatchStore, RepositoryContext, SyncProvider } from '../../sync/types'
import { gitlabUser, MR_STATUSES, MR_TASK_TYPE, STATUSES, TASK_TYPE } from './fixtures'
import { asTxOperations, type MemoryClient } from './memory'

export const ctx = new MeasureMetricsContext('test', {})

const API_METHODS = [
  'getCurrentUser',
  'listMaintainedProjects',
  'getProject',
  'ensureProjectHook',
  'deleteProjectHook',
  'getIssue',
  'listIssuePages',
  'createIssue',
  'updateIssue',
  'moveIssue',
  'listNotes',
  'getNote',
  'createNote',
  'updateNote',
  'deleteNote',
  'getMergeRequest',
  'listMergeRequestPages',
  'updateMergeRequest',
  'listMergeRequestReviewers',
  'listMergeRequestCommits',
  'readMergeRequestRawDiffs',
  'listMergeRequestDiffPages',
  'getMergeRequestApprovals',
  'approveMergeRequest',
  'unapproveMergeRequest',
  'listMergeRequestDiscussions',
  'getMergeRequestDiscussion',
  'createMergeRequestDiscussionNote',
  'updateMergeRequestDiscussionNote',
  'deleteMergeRequestDiscussionNote',
  'resolveMergeRequestDiscussion',
  'uploadFile',
  'downloadUpload'
] as const

export type ApiMethod = (typeof API_METHODS)[number]
export type FakeApi = Record<ApiMethod, jest.Mock>

/** Every method fails loudly unless given an implementation. */
export function fakeApi (impl: Partial<Record<ApiMethod, (...args: any[]) => unknown>> = {}): FakeApi {
  const api: Partial<FakeApi> = {}
  for (const name of API_METHODS) {
    api[name] = jest.fn(
      impl[name] ??
        (async () => {
          throw new Error(`unexpected GitLab call: ${name}`)
        })
    )
  }
  return api as FakeApi
}

/** A paged listing fake: every item on one page. */
export function pagesOf<T> (items: T[]): () => AsyncGenerator<T[]> {
  return async function* () {
    yield items
  }
}

/** A readMergeRequestRawDiffs fake that sends `text` as one chunk. */
export function rawDiffs (
  text: string
): (projectId: number, iid: number, onText: (text: string) => boolean) => Promise<void> {
  return async (_projectId, _iid, onText) => {
    onText(text)
  }
}

export function asApi (api: FakeApi): GitlabApi {
  return api as unknown as GitlabApi
}

/** GitLab user n is Huly person 'person-n' with social id 'sid-n'. */
export const fakePersons: PersonMapping = {
  personIdFor: async (_host, user) => `sid-${user.id}` as PersonId,
  personRefFor: async (_host, user) => (user === undefined ? null : (`person-${user.id}` as Ref<Person>)),
  gitlabUserIdFor: async (person) => {
    const match = /^person-(\d+)$/.exec(person ?? '')
    return match === null ? undefined : Number(match[1])
  }
}

export interface FakeCollaborator {
  store: Map<string, string>
  getMarkup: (doc: { objectId: string, objectAttr: string }) => Promise<string>
  updateMarkup: (doc: { objectId: string, objectAttr: string }, markup: string) => Promise<void>
}

export function fakeCollaborator (): FakeCollaborator {
  const store = new Map<string, string>()
  const key = (doc: { objectId: string, objectAttr: string }): string => `${doc.objectId}:${doc.objectAttr}`
  return {
    store,
    getMarkup: async (doc) => store.get(key(doc)) ?? '',
    updateMarkup: async (doc, markup) => {
      store.set(key(doc), markup)
    }
  }
}

export interface TestProvider extends SyncProvider {
  api: FakeApi
  collab: FakeCollaborator
  triggerSync: jest.Mock
}

export function createTestProvider (
  memory: MemoryClient,
  repositories: RepositoryContext[],
  api: FakeApi,
  options: { apiAvailable?: boolean, patches?: PatchStore, ownUser?: GitlabUserRef | null, images?: ImageStore } = {}
): TestProvider {
  const client = asTxOperations(memory)
  const collab = fakeCollaborator()
  const available = options.apiAvailable !== false
  const markdown = createMarkdownConverter({ refUrl: 'ref://', imageUrl: 'http://front/files?file=' })
  return {
    workspace: 'ws1' as WorkspaceUuid,
    client,
    derived: client,
    collaborator: collab,
    collab,
    markdown,
    content: new ContentConverter({
      ctx,
      markdown,
      images: options.images,
      derived: client,
      integrationApi: async () => (available ? asApi(api) : undefined)
    }),
    persons: fakePersons,
    runner: new SyncRunner(),
    patches: options.patches,
    api,
    repositoryContext: (id) => repositories.find((it) => it.repository._id === id),
    projectRepositories: (project) => repositories.filter((it) => it.project._id === project),
    integrationApi: async () => (available ? asApi(api) : undefined),
    apiFor: async () => (available ? asApi(api) : undefined),
    userApi: async () =>
      options.ownUser === null ? undefined : { api: asApi(api), user: options.ownUser ?? gitlabUser(5) },
    issueTaskType: async () => ({ taskType: TASK_TYPE, statuses: STATUSES }),
    mergeRequestTaskType: async () => ({ taskType: MR_TASK_TYPE, statuses: MR_STATUSES }),
    triggerSync: jest.fn(),
    now: () => Date.parse('2026-01-15T00:00:00.000Z')
  }
}

export interface FakeImages extends ImageStore {
  blobs: Map<string, { data: Buffer, contentType: string }>
}

/** Blob storage in memory; new files are 'blob-1', 'blob-2', … */
export function fakeImages (): FakeImages {
  const blobs = new Map<string, { data: Buffer, contentType: string }>()
  let n = 0
  return {
    blobs,
    stat: async (_ctx, file) => {
      const blob = blobs.get(file)
      return blob === undefined ? undefined : { size: blob.data.length, contentType: blob.contentType }
    },
    read: async (_ctx, file) => blobs.get(file),
    put: async (_ctx, data, contentType) => {
      const name = `blob-${++n}`
      blobs.set(name, { data, contentType })
      return name
    }
  }
}
