// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import type { Person } from '@hcengineering/contact'
import type { TxOperations } from '@hcengineering/core'

/** Finish a merge after transferring the source's data and references to the target. */
export async function finishPersonMerge (
  client: Pick<TxOperations, 'remove'>,
  accountClient: Pick<AccountClient, 'mergeSpecifiedPersons'>,
  source: Person,
  target: Person
): Promise<void> {
  if (source._id === target._id) {
    throw new Error('Cannot merge a person with itself')
  }

  if (target.personUuid !== undefined && source.personUuid !== undefined) {
    await accountClient.mergeSpecifiedPersons(target.personUuid, source.personUuid)
  }

  await client.remove(source)
}
