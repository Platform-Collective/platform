// SPDX-License-Identifier: EPL-2.0

import type { Ref, Space, TxOperations } from '@hcengineering/core'
import type { ToDo } from '@hcengineering/time'

export async function updateAttachedSpace (
  client: TxOperations,
  todo: ToDo,
  space: Ref<Space> | undefined
): Promise<void> {
  const oldSpace = todo.attachedSpace ?? undefined
  const newSpace = space ?? undefined
  if (newSpace !== oldSpace) {
    await client.update(todo, { attachedSpace: newSpace })
    todo.attachedSpace = newSpace
  }
}
