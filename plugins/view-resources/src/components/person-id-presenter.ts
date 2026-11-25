// SPDX-License-Identifier: EPL-2.0

import type { Person } from '@hcengineering/contact'
import type { PersonId } from '@hcengineering/core'

/** Distinguishes an absent author from an author whose identity cannot be resolved. */
export function getPersonIdPresenterState (
  value: PersonId | undefined,
  person: Readonly<Person> | null | undefined,
  systemId: PersonId
): 'empty' | 'system' | 'loading' | 'resolved' | 'unresolved' {
  if (value == null || value === '') return 'empty'
  if (value === systemId) return 'system'
  if (person === undefined) return 'loading'
  return person === null ? 'unresolved' : 'resolved'
}
