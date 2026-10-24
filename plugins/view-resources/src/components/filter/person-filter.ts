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

/** Resolve the stored IDs from scalar or grouped filter values to local persons. */
export async function getFilterPersonRefs (
  client: Client,
  values: readonly unknown[],
  type: AnyAttribute['type']
): Promise<Array<Ref<Person>>> {
  // ArrayFilter and ValueFilter store [display value, stored values] tuples.
  const ids = values
    .flatMap((value) => (Array.isArray(value) ? value[1] : value))
    .filter((id): id is string => typeof id === 'string')
  if (ids.length === 0) return []

  const valueType = type._class === core.class.ArrOf ? (type as ArrOf<Doc>).of : type
  if (valueType._class === core.class.TypeAccountUuid) {
    const persons = await client.findAll(
      contact.class.Person,
      { personUuid: { $in: ids as AccountUuid[] } },
      { projection: { _id: 1 } }
    )
    return persons.map((person) => person._id)
  }

  const personsMap = await getPersonRefsBySocialIds(client, ids as PersonId[])
  return Object.values(personsMap)
}
