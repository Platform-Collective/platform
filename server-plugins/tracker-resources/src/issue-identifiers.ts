// SPDX-License-Identifier: EPL-2.0

import core, {
  SortingOrder,
  TxProcessor,
  type Ref,
  type Tx,
  type TxCUD,
  type TxCreateDoc,
  type TxUpdateDoc
} from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'
import tracker, { type Issue } from '@hcengineering/tracker'

/** Maintain identifier history for every issue writer, including older clients and integrations. */
export async function updateIssueIdentifierAliases (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const updates = txes.filter(
    (tx): tx is TxUpdateDoc<Issue> =>
      tx._class === core.class.TxUpdateDoc &&
      control.hierarchy.isDerived((tx as TxCUD<Issue>).objectClass, tracker.class.Issue) &&
      (TxProcessor.txHasUpdate(tx as TxUpdateDoc<Issue>, 'identifier') ||
        TxProcessor.txHasUpdate(tx as TxUpdateDoc<Issue>, 'space'))
  )
  if (updates.length === 0) return []

  const ids = [...new Set(updates.map((tx) => tx.objectId))]
  const [issues, aliases, history] = await Promise.all([
    control.findAll(control.ctx, tracker.class.Issue, { _id: { $in: ids } }, { showArchived: true }),
    control.findAll(control.ctx, tracker.class.IssueIdentifierAlias, { issue: { $in: ids } }, { showArchived: true }),
    control.findAll(
      control.ctx,
      core.class.TxCUD,
      { objectId: { $in: ids } },
      { sort: { modifiedOn: SortingOrder.Ascending, _id: SortingOrder.Ascending } }
    )
  ])
  const result: Tx[] = []
  const pending = new Set(control.txes.map((tx) => tx._id))
  const matched = new Set<Ref<Tx>>(updates.map((tx) => tx._id))
  for (const issue of issues) {
    // Triggers run after persistence. Rebuild the state before this batch, then
    // replay it in order so multiple moves in one batch retain each identifier.
    const previous = TxProcessor.buildDoc2Doc<Issue>(
      history.filter((tx) => tx.objectId === issue._id && !pending.has(tx._id))
    )
    let identifier = previous?.identifier
    for (const tx of control.txes) {
      const cud = tx as TxCUD<Issue>
      if (cud.objectId !== issue._id) continue
      if (tx._class === core.class.TxCreateDoc) {
        identifier = TxProcessor.createDoc2Doc(cud as TxCreateDoc<Issue>).identifier
      } else if (tx._class === core.class.TxUpdateDoc) {
        const next = (tx as TxUpdateDoc<Issue>).operations.identifier
        if (next === undefined) continue
        if (matched.has(tx._id) && identifier !== undefined && identifier !== next) {
          result.push(
            control.txFactory.createTxCreateDoc(tracker.class.IssueIdentifierAlias, issue.space, {
              identifier,
              issue: issue._id
            })
          )
        }
        identifier = next
      }
    }
    for (const alias of aliases) {
      if (alias.issue === issue._id && alias.space !== issue.space) {
        result.push(control.txFactory.createTxUpdateDoc(alias._class, alias.space, alias._id, { space: issue.space }))
      }
    }
  }
  return result
}
