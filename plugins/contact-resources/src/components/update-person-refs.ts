// SPDX-License-Identifier: EPL-2.0

import contact, { type Person } from '@hcengineering/contact'
import core, { type ArrOf, type Doc, type RefTo, type TxOperations } from '@hcengineering/core'
import { updateAttribute } from '@hcengineering/presentation'

export async function updateAllRefs (client: TxOperations, sourceAccount: Person, targetAccount: Person): Promise<void> {
    const h = client.getHierarchy()
    // Move all possible references to Employee and replace to target one.
    const ancestors = h.getAncestors(contact.class.Person)
    const reftos = (await client.findAll(core.class.Attribute, { 'type._class': core.class.RefTo })).filter((it) => {
      const to = it.type as RefTo<Doc>
      return h.getBaseClass(to.to) === contact.class.Person || ancestors.includes(to.to)
    })

    for (const attr of reftos) {
      if (attr.name === '_id') {
        continue
      }
      // A failure stops the merge before the source is removed; merge() reports it.
      const descendants = h.getDescendants(attr.attributeOf)
      for (const d of descendants) {
        if (h.isDerived(d, core.class.Tx) || h.isDerived(d, core.class.BenchmarkDoc)) {
          continue
        }
        if (h.findDomain(d) !== undefined) {
          while (true) {
            const values = await client.findAll(d, { [attr.name]: sourceAccount._id }, { limit: 100 })
            if (values.length === 0) {
              break
            }

            const builder = client.apply(sourceAccount._id)
            for (const v of values) {
              await updateAttribute(builder, v, d, { key: attr.name, attr }, targetAccount._id)
            }
            if (builder.txes.length > 0) {
              await builder.commit()
            }
          }
        }
      }
    }
    const arrs = (await client.findAll(core.class.Attribute, { 'type._class': core.class.ArrOf })).filter((it) => {
      const to = it.type as ArrOf<Doc>
      if (to.of._class !== core.class.RefTo) return false
      const refTo = to.of as RefTo<Doc>
      return h.getBaseClass(refTo.to) === contact.class.Person || ancestors.includes(refTo.to)
    })

    for (const attr of arrs) {
      if (attr.name === '_id') {
        continue
      }
      const descendants = h.getDescendants(attr.attributeOf)
      for (const d of descendants) {
        if (h.isDerived(d, core.class.Tx) || h.isDerived(d, core.class.BenchmarkDoc)) {
          continue
        }
        if (h.findDomain(d) !== undefined) {
          while (true) {
            const values = await client.findAll(attr.attributeOf, { [attr.name]: sourceAccount._id }, { limit: 100 })
            if (values.length === 0) {
              break
            }
            const builder = client.apply(sourceAccount._id)
            for (const v of values) {
              await updateAttribute(builder, v, d, { key: attr.name, attr }, targetAccount._id)
            }
            await builder.commit()
          }
        }
      }
    }

  }

