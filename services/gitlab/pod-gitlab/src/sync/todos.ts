// SPDX-License-Identifier: EPL-2.0

import contact, { type Employee, type Person } from '@hcengineering/contact'
import core, { type DocumentUpdate, type Ref, SortingOrder, type TxUpdateDoc } from '@hcengineering/core'
import gitlab, {
  type DocSyncInfo,
  type GitlabMergeRequest,
  type GitlabTodo,
  type GitlabTodoPurpose
} from '@hcengineering/gitlab'
import { makeRank } from '@hcengineering/task'
import time, { type ToDo, ToDoPriority } from '@hcengineering/time'
import type { GitlabMergeRequestInfo, GitlabReviewState } from '../gitlab/types'
import { effectiveReviewStates, type ReviewStatus, sameMembers, type UserReviewState } from './reviews'
import { mergeRequestSyncState } from './status'
import type { RepositoryContext, SyncProvider } from './types'

export interface TodoRef {
  purpose: GitlabTodoPurpose
  person: Ref<Person>
}

export interface TodoInput {
  // Opened or locked
  open: boolean
  reviewers: Array<{ person: Ref<Person>, state: GitlabReviewState }>
  // Author and assignee
  fixers: Array<Ref<Person>>
  // A reviewer requested changes, or GitLab reports unresolved blocking discussions
  needsFix: boolean
  // DocSyncInfo.todos: the ToDos created so far
  keys: string[]
}

export interface TodoPlan {
  create: TodoRef[]
  // Open ToDos of these to mark done
  complete: TodoRef[]
  // The new DocSyncInfo.todos
  keys: string[]
}

// A reviewer in one of these states has done their part
const REVIEWED: GitlabReviewState[] = ['reviewed', 'approved', 'requested_changes']

function todoKey (todo: TodoRef): string {
  return `${todo.purpose}:${todo.person}`
}

function parseKey (key: string): TodoRef | undefined {
  const at = key.indexOf(':')
  const purpose = key.slice(0, at)
  if (at <= 0 || (purpose !== 'review' && purpose !== 'fix')) return undefined
  return { purpose, person: key.slice(at + 1) as Ref<Person> }
}

/**
 * The ToDos a merge request needs. A ToDo is created once per condition: its key stays in
 * DocSyncInfo.todos while the condition holds, so a ToDo the user deleted is not created again until the
 * condition ends and starts again.
 */
export function planTodos (input: TodoInput): TodoPlan {
  const wanted = new Map<string, TodoRef>()
  if (input.open) {
    for (const reviewer of input.reviewers) {
      if (REVIEWED.includes(reviewer.state)) continue
      const todo: TodoRef = { purpose: 'review', person: reviewer.person }
      wanted.set(todoKey(todo), todo)
    }
    if (input.needsFix) {
      for (const person of input.fixers) {
        const todo: TodoRef = { purpose: 'fix', person }
        wanted.set(todoKey(todo), todo)
      }
    }
  }
  const known = new Set(input.keys)
  const create = [...wanted.entries()].filter(([key]) => !known.has(key)).map(([, todo]) => todo)
  const complete = input.keys
    .filter((key) => !wanted.has(key))
    .map(parseKey)
    .filter((it): it is TodoRef => it !== undefined)
  const keys = [...input.keys.filter((key) => wanted.has(key)), ...create.map(todoKey)]
  return { create, complete, keys }
}

/** The ToDos created earlier that the merge request still needs. */
export function keptTodos (plan: TodoPlan, keys: string[]): TodoRef[] {
  const known = new Set(keys)
  return plan.keys
    .filter((key) => known.has(key))
    .map(parseKey)
    .filter((it): it is TodoRef => it !== undefined)
}

/** Creates and completes review and fix ToDos from the merge request's review states. */
export async function syncMergeRequestTodos (
  provider: SyncProvider,
  repo: RepositoryContext,
  mergeRequest: GitlabMergeRequest,
  info: DocSyncInfo,
  external: GitlabMergeRequestInfo,
  status: ReviewStatus | undefined
): Promise<DocumentUpdate<DocSyncInfo>> {
  const keys = info.todos ?? []
  const open = mergeRequestSyncState(external.state) === 'opened'
  if (!open && keys.length === 0) return {}
  // Review states unavailable: ToDos stay as they are
  if (open && status === undefined) return {}
  const { persons } = provider
  const host = repo.integration.host
  const states = status === undefined ? new Map<number, UserReviewState>() : effectiveReviewStates(status)
  const reviewers: Array<{ person: Ref<Person>, state: UserReviewState['state'] }> = []
  for (const user of external.reviewers) {
    const person = await persons.personRefFor(host, user)
    if (person !== null) {
      reviewers.push({ person, state: states.get(user.id)?.state ?? 'unreviewed' })
    }
  }
  const fixers: Array<Ref<Person>> = []
  const author = await persons.personRefFor(host, external.author)
  if (author !== null) fixers.push(author)
  if (mergeRequest.assignee !== null) fixers.push(mergeRequest.assignee)
  const needsFix =
    [...states.values()].some((it) => it.state === 'requested_changes') || !external.blocking_discussions_resolved
  const plan = planTodos({ open, reviewers, fixers, needsFix, keys })
  for (const todo of plan.complete) {
    await completeTodos(provider, mergeRequest, todo)
  }
  for (const todo of plan.create) {
    await createTodo(provider, mergeRequest, todo, external)
  }
  for (const todo of keptTodos(plan, keys)) {
    await restoreTodo(provider, mergeRequest, todo)
  }
  return sameMembers(plan.keys, keys) && plan.keys.length === keys.length ? {} : { todos: plan.keys }
}

async function createTodo (
  provider: SyncProvider,
  mergeRequest: GitlabMergeRequest,
  todo: TodoRef,
  external: GitlabMergeRequestInfo
): Promise<void> {
  const { client } = provider
  const employee = await client.findOne(contact.mixin.Employee, { _id: todo.person as Ref<Employee>, active: true })
  // Placeholder persons of GitLab users who never joined Huly get no ToDos
  if (employee === undefined) return
  const latest = await client.findOne(
    time.class.ToDo,
    { user: employee._id, doneOn: null },
    { sort: { rank: SortingOrder.Ascending } }
  )
  const id = await client.addCollection(
    time.class.ProjectToDo,
    time.space.ToDos,
    mergeRequest._id,
    mergeRequest._class,
    'todos',
    {
      title: `${todo.purpose === 'review' ? 'Review' : 'Resolve'} ${mergeRequest.title}`,
      description: provider.markdown.toMarkup(external.web_url),
      attachedSpace: mergeRequest.space,
      user: employee._id,
      workslots: 0,
      doneOn: null,
      priority: ToDoPriority.High,
      visibility: 'public',
      rank: makeRank(undefined, latest?.rank)
    }
  )
  await client.createMixin<ToDo, GitlabTodo>(id, time.class.ProjectToDo, time.space.ToDos, gitlab.mixin.GitlabTodo, {
    purpose: todo.purpose
  })
}

async function completeTodos (provider: SyncProvider, mergeRequest: GitlabMergeRequest, todo: TodoRef): Promise<void> {
  const { client } = provider
  const h = client.getHierarchy()
  const open = await client.findAll(time.class.ProjectToDo, {
    attachedTo: mergeRequest._id,
    user: todo.person as Ref<Employee>,
    doneOn: null
  })
  for (const it of open) {
    if (
      h.hasMixin(it, gitlab.mixin.GitlabTodo) &&
      h.as<ToDo, GitlabTodo>(it, gitlab.mixin.GitlabTodo).purpose === todo.purpose
    ) {
      await client.update(it, { doneOn: provider.now() })
    }
  }
}

/**
 * GitLab decides when a review or fix is done. A still-needed ToDo that a server trigger completed (Huly's issue
 * automation completes every ToDo of a merge request when its assignee changes) is opened again; one its person
 * completed, or deleted, stays as it is. Relies on DOMAIN_TX history being kept (see closedByAutomation).
 */
async function restoreTodo (provider: SyncProvider, mergeRequest: GitlabMergeRequest, todo: TodoRef): Promise<void> {
  const { client } = provider
  const h = client.getHierarchy()
  const own = (
    await client.findAll(time.class.ProjectToDo, { attachedTo: mergeRequest._id, user: todo.person as Ref<Employee> })
  ).filter(
    (it) =>
      h.hasMixin(it, gitlab.mixin.GitlabTodo) &&
      h.as<ToDo, GitlabTodo>(it, gitlab.mixin.GitlabTodo).purpose === todo.purpose
  )
  if (own.length === 0 || own.some((it) => it.doneOn == null)) return
  const last = own.reduce((a, b) => ((b.doneOn ?? 0) > (a.doneOn ?? 0) ? b : a))
  if (await closedByAutomation(provider, last)) {
    await client.update(last, { doneOn: null })
  }
}

/**
 * Server triggers write derived transactions, which the server does not store. A person's completion and this
 * service's are stored, so a done ToDo without a stored update that set its doneOn was completed by a trigger.
 * Assumes every non-trigger completion is a stored TxUpdateDoc; relies on DOMAIN_TX history being kept (pruned or
 * not-restored txes would make person-completed ToDos reopen).
 */
async function closedByAutomation (provider: SyncProvider, todo: ToDo): Promise<boolean> {
  const [latest] = await provider.client.findAll<TxUpdateDoc<ToDo>>(
    core.class.TxUpdateDoc,
    { objectId: todo._id, 'operations.doneOn': { $exists: true } },
    { sort: { modifiedOn: SortingOrder.Descending }, limit: 1 }
  )
  return latest?.operations.doneOn !== todo.doneOn
}
