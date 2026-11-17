// SPDX-License-Identifier: EPL-2.0

import type { Enum, TxOperations } from '@hcengineering/core'

/** Create an editor-local add operation that ignores repeated submissions while saving. */
export function createEnumValueAdder (
  client: Pick<TxOperations, 'update'>
): (value: Enum, newValue: string) => Promise<boolean> {
  let adding = false

  return async (value, newValue) => {
    if (adding || newValue.trim().length === 0 || value.enumValues.includes(newValue.trim())) return false

    // Enter and blur can arrive before the update or its query echo completes.
    adding = true
    try {
      await client.update(value, {
        $push: { enumValues: newValue }
      })
      return true
    } finally {
      adding = false
    }
  }
}
