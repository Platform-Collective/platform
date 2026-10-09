// SPDX-License-Identifier: EPL-2.0
import type { Ref } from '@hcengineering/core'
import type { ToDo } from '@hcengineering/time'
import { selectAutoCompletable } from '../automation'

function todo (id: string, extra: Record<string, unknown> = {}): ToDo {
  return { _id: id as Ref<ToDo>, doneOn: null, ...extra } as unknown as ToDo
}

const ids = (todos: ToDo[]): string[] => todos.map((it) => it._id)

describe('selectAutoCompletable', () => {
  it('returns every open ToDo when no tester is registered', async () => {
    expect(ids(await selectAutoCompletable({}, [todo('a'), todo('b', { doneOn: 5 })], []))).toEqual(['a'])
  })

  it('keeps open a ToDo that any tester rejects (GitLab review and fix ToDos)', async () => {
    const keepManaged = async (_client: unknown, it: ToDo): Promise<boolean> =>
      (it as unknown as Record<string, unknown>).managed !== true
    const allowAll = async (): Promise<boolean> => true
    const todos = [todo('a'), todo('b', { managed: true })]
    expect(ids(await selectAutoCompletable({}, todos, [allowAll, keepManaged]))).toEqual(['a'])
  })
})
