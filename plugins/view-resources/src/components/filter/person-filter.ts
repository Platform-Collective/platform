// SPDX-License-Identifier: EPL-2.0

import core, {
  type AccountUuid,
  type AnyAttribute,
  type ArrOf,
  type Client,
  type Doc,
  type PersonId,
  type Ref
} from '@hcengineering/core'
import contact, { getPersonRefsBySocialIds, type Person } from '@hcengineering/contact'

/** Person filters accept IDs or ArrayFilter/ValueFilter [display, stored IDs] groups. */
export type PersonFilterValue =
  | AccountUuid
  | PersonId
  | readonly [display: unknown, stored: readonly (AccountUuid | PersonId)[]]
  | null
  | undefined

/** Resolve the stored IDs from scalar or grouped filter values to local persons. */
export async function getFilterPersonRefs (
  client: Client,
  values: readonly unknown[],
  type: AnyAttribute['type']
): Promise<Array<Ref<Person>>> {
  // ArrayFilter and ValueFilter store [display value, stored values] tuples.
  const ids = values
    .flatMap((value) => (Array.isArray(value) ? value[1] : value))
    // Ignore null selections and malformed non-string values instead of querying with invalid IDs.
    .filter((id): id is string => typeof id === 'string')
  if (ids.length === 0) return []

  const valueType = type._class === core.class.ArrOf ? (type as ArrOf<Doc>).of : type
  if (valueType._class === core.class.TypeAccountUuid) {
    // Stored personUuid is text: query IDs unchanged; normalization below only matches returned rows.
    const persons = await client.findAll(
      contact.class.Person,
      { personUuid: { $in: ids as AccountUuid[] } },
      { projection: { _id: 1, personUuid: 1 } }
    )
    const personsByUuid = new Map<string, Array<Ref<Person>>>()
    for (const person of persons) {
      if (person.personUuid !== undefined) {
        const uuid = person.personUuid.toLowerCase()
        const refs = personsByUuid.get(uuid) ?? []
        refs.push(person._id)
        personsByUuid.set(uuid, refs)
      }
    }
    // Unresolved IDs stay in the filter but have no local person to display.
    return [...new Set(ids.flatMap((id) => personsByUuid.get(id.toLowerCase()) ?? []))]
  }

  const personsMap = await getPersonRefsBySocialIds(client, ids as PersonId[])
  const personsBySocialId = new Map(Object.entries<Ref<Person>>(personsMap))
  return [...new Set(ids.flatMap((id) => personsBySocialId.get(id) ?? []))]
}

/** Apply only the latest selection's lookup result, including when the selection is cleared. */
export function createFilterPersonUpdater (
  client: Client,
  onUpdate: (persons: Array<Ref<Person>>) => void
): (values: readonly unknown[], type: AnyAttribute['type']) => Promise<void> {
  let requestId = 0
  return async (values, type): Promise<void> => {
    const id = ++requestId
    const persons = await getFilterPersonRefs(client, values, type)
    if (id === requestId) {
      onUpdate(persons)
    }
  }
}
