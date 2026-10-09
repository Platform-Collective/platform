// SPDX-License-Identifier: EPL-2.0

import type { Person } from '@hcengineering/contact'
import type { Ref } from '@hcengineering/core'
import type { GitlabReviewState } from '../gitlab/types'

export type TodoPurpose = 'review' | 'fix'

export interface TodoRef {
  purpose: TodoPurpose
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

export function todoKey (todo: TodoRef): string {
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
