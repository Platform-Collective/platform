// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import type { Person } from '@hcengineering/contact'
import type { TxOperations } from '@hcengineering/core'

/**
 * Finish a merge after transferring the source's data and references to the target.
 * Only local (non-employee) sources are removed; an employee source stays in place
 * so the global person merge keeps its existing behaviour.
 */
export async function finishPersonMerge (
  client: Pick<TxOperations, 'remove'>,
  accountClient: Pick<AccountClient, 'mergeSpecifiedPersons'>,
  source: Person,
  target: Person,
  options: { removeSource: boolean }
): Promise<void> {
  if (source._id === target._id) {
    throw new Error('Cannot merge a person with itself')
  }

  if (target.personUuid !== undefined && source.personUuid !== undefined) {
    await accountClient.mergeSpecifiedPersons(target.personUuid, source.personUuid)
  }

  if (options.removeSource) {
    await client.remove(source)
  }
}

/** Run the merge steps and return the error of a failed step instead of rejecting. */
export async function runPersonMerge (steps: () => Promise<void>): Promise<unknown> {
  try {
    await steps()
    return undefined
  } catch (err: unknown) {
    return err
  }
}
