// SPDX-License-Identifier: EPL-2.0

import { getResource } from '@hcengineering/platform'
import type { TriggerControl } from '@hcengineering/server-core'
import time, { type ToDo, type TodoAutomationHelper } from '@hcengineering/time'

/** The open ToDos the issue automation may complete: every tester has to agree. */
export async function selectAutoCompletable<C, T extends ToDo> (
  client: C,
  todos: T[],
  testers: Array<(client: C, todo: ToDo) => Promise<boolean>>
): Promise<T[]> {
  const result: T[] = []
  for (const todo of todos) {
    if (todo.doneOn != null) continue
    let allowed = true
    for (const tester of testers) {
      if (!(await tester(client, todo))) {
        allowed = false
        break
      }
    }
    if (allowed) result.push(todo)
  }
  return result
}

/** Testers registered through TodoAutomationHelper.onAutoCompleteTester; helpers without one are skipped. */
export async function getAutoCompleteTesters (
  control: TriggerControl
): Promise<Array<(control: TriggerControl, todo: ToDo) => Promise<boolean>>> {
  const helpers = await control.modelDb.findAll<TodoAutomationHelper>(time.class.TodoAutomationHelper, {})
  const result: Array<(control: TriggerControl, todo: ToDo) => Promise<boolean>> = []
  for (const helper of helpers) {
    if (helper.onAutoCompleteTester !== undefined) {
      result.push(await getResource(helper.onAutoCompleteTester))
    }
  }
  return result
}
