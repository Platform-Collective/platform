// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import type { Person } from '@hcengineering/contact'
import { MeasureMetricsContext, type PersonId, type Ref, type WorkspaceUuid } from '@hcengineering/core'
import type { GitlabApi } from '../../gitlab/api'
import { createMarkdownConverter } from '../../markdown'
import type { PersonMapping } from '../../sync/persons'
import { SyncRunner } from '../../sync/runner'
import type { RepositoryContext, SyncProvider } from '../../sync/types'
import { STATUSES, TASK_TYPE } from './fixtures'
import { asTxOperations, type MemoryClient } from './memory'

export const ctx = new MeasureMetricsContext('test', {})

const API_METHODS = [
  'getCurrentUser', 'listMaintainedProjects', 'ensureProjectHook', 'deleteProjectHook', 'getIssue', 'listIssues',
  'createIssue', 'updateIssue', 'listIssueNotes', 'getIssueNote', 'createIssueNote', 'updateIssueNote', 'deleteIssueNote'
] as const

export type ApiMethod = (typeof API_METHODS)[number]
export type FakeApi = Record<ApiMethod, jest.Mock>

/** Every method fails loudly unless given an implementation. */
export function fakeApi (impl: Partial<Record<ApiMethod, (...args: any[]) => Promise<unknown>>> = {}): FakeApi {
  const api: Partial<FakeApi> = {}
  for (const name of API_METHODS) {
    api[name] = jest.fn(impl[name] ?? (async () => { throw new Error(`unexpected GitLab call: ${name}`) }))
  }
  return api as FakeApi
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
  options: { apiAvailable?: boolean } = {}
): TestProvider {
  const client = asTxOperations(memory)
  const collab = fakeCollaborator()
  const available = options.apiAvailable !== false
  return {
    workspace: 'ws1' as WorkspaceUuid,
    client,
    derived: client,
    collaborator: collab as any,
    collab,
    markdown: createMarkdownConverter({ refUrl: 'ref://', imageUrl: 'http://front/files?file=' }),
    persons: fakePersons,
    runner: new SyncRunner(),
    api,
    repositoryContext: (id) => repositories.find((it) => it.repository._id === id),
    projectRepositories: (project) => repositories.filter((it) => it.project._id === project),
    integrationApi: async () => (available ? asApi(api) : undefined),
    apiFor: async () => (available ? asApi(api) : undefined),
    issueTaskType: async () => ({ taskType: TASK_TYPE, statuses: STATUSES }),
    triggerSync: jest.fn()
  }
}
