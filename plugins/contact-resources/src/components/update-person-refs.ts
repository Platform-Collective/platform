// SPDX-License-Identifier: EPL-2.0

import contact, { type Person } from '@hcengineering/contact'
import core, { type ArrOf, type Doc, type RefTo, type TxOperations } from '@hcengineering/core'
import { updateAttribute } from '@hcengineering/presentation'

/** Move all reachable references, but prevent finalizing the merge if any class failed. */
export async function updateAllRefs (client: TxOperations, source: Person, target: Person): Promise<void> {
  const h = client.getHierarchy()
  const ancestors = h.getAncestors(contact.class.Person)
  const reftos = (await client.findAll(core.class.Attribute, { 'type._class': core.class.RefTo })).filter((it) => {
    const to = it.type as RefTo<Doc>
    return h.getBaseClass(to.to) === contact.class.Person || ancestors.includes(to.to)
  })
  const arrays = (await client.findAll(core.class.Attribute, { 'type._class': core.class.ArrOf })).filter((it) => {
    const to = it.type as ArrOf<Doc>
    if (to.of._class !== core.class.RefTo) return false
    const refTo = to.of as RefTo<Doc>
    return h.getBaseClass(refTo.to) === contact.class.Person || ancestors.includes(refTo.to)
  })
  const failedClasses = new Set<string>()
  for (const attr of [...reftos, ...arrays]) {
    if (attr.name === '_id') continue
    for (const cls of h.getDescendants(attr.attributeOf)) {
      if (h.isDerived(cls, core.class.Tx) || h.isDerived(cls, core.class.BenchmarkDoc) || h.findDomain(cls) === undefined) continue
      try {
        while (true) {
          const values = await client.findAll(cls, { [attr.name]: source._id }, { limit: 100 })
          if (values.length === 0) break
          const builder = client.apply(source._id)
          for (const value of values) {
            await updateAttribute(builder, value, cls, { key: attr.name, attr }, target._id)
          }
          if (builder.txes.length === 0) throw new Error('No reference updates generated')
          await builder.commit()
        }
      } catch {
        failedClasses.add(cls)
      }
    }
  }
  if (failedClasses.size > 0) {
    throw new Error(`Failed to update references for: ${Array.from(failedClasses).join(', ')}`)
  }
}
