// SPDX-License-Identifier: EPL-2.0

import type { Ref, Space, TxOperations } from '@hcengineering/core'
import type { ToDo } from '@hcengineering/time'

import { updateAttachedSpace } from '../components/edit-todo'

const PROJECT_ID = 'project-1' as Ref<Space>

describe('EditToDo attached space selector', () => {
  it('persists the selected project reference', async () => {
    const update = jest.fn(async (): Promise<void> => {})
    const client = { update } as unknown as TxOperations
    const todo = { attachedSpace: undefined } as unknown as ToDo

    await updateAttachedSpace(client, todo, PROJECT_ID)

    expect(update).toHaveBeenCalledWith(todo, { attachedSpace: PROJECT_ID })
    expect(todo.attachedSpace).toBe(PROJECT_ID)
  })
})
