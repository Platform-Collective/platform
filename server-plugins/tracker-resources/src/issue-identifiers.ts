// SPDX-License-Identifier: EPL-2.0

import core, {
  SortingOrder,
  TxProcessor,
  type Doc,
  type Ref,
  type Tx,
  type TxCUD,
  type TxCreateDoc,
  type TxUpdateDoc
} from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'
import tracker, { type Issue } from '@hcengineering/tracker'

async function findPreviousIdentifier (
  issueId: Ref<Issue>,
  pending: Ref<Tx>[],
  control: TriggerControl
): Promise<string | undefined> {
  const updateProjection: Record<string, 0 | 1> = { 'operations.identifier': 1 }
  const updates = await control.findAll(
    control.ctx,
    core.class.TxUpdateDoc,
    {
      _id: { $nin: pending as Ref<TxUpdateDoc<Doc>>[] },
      objectId: issueId,
      'operations.identifier': { $exists: true }
    },
    {
      sort: { modifiedOn: SortingOrder.Descending, _id: SortingOrder.Descending },
      limit: 1,
      projection: updateProjection
    }
  )
  const previousUpdate = updates[0] as TxUpdateDoc<Issue> | undefined
  if (previousUpdate !== undefined) return previousUpdate.operations.identifier

  const createProjection: Record<string, 0 | 1> = { 'attributes.identifier': 1 }
  const creates = await control.findAll(
    control.ctx,
    core.class.TxCreateDoc,
    { _id: { $nin: pending as Ref<TxCreateDoc<Doc>>[] }, objectId: issueId },
    { limit: 1, projection: createProjection }
  )
  return (creates[0] as TxCreateDoc<Issue> | undefined)?.attributes.identifier
}

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
  const pending = control.txes.map((tx) => tx._id)
  const [issues, aliases, previousIdentifiers] = await Promise.all([
    control.findAll(control.ctx, tracker.class.Issue, { _id: { $in: ids } }, { showArchived: true }),
    control.findAll(control.ctx, tracker.class.IssueIdentifierAlias, { issue: { $in: ids } }, { showArchived: true }),
    Promise.all(ids.map(async (id) => [id, await findPreviousIdentifier(id, pending, control)] as const))
  ])
  const previous = new Map(previousIdentifiers)
  const result: Tx[] = []
  const matched = new Set<Ref<Tx>>(updates.map((tx) => tx._id))
  for (const issue of issues) {
    // Replay this batch in order so multiple moves retain every identifier.
    let identifier = previous.get(issue._id)
    for (const tx of control.txes) {
      const cud = tx as TxCUD<Issue>
      if (cud.objectId !== issue._id) continue
      if (tx._class === core.class.TxCreateDoc) {
        identifier = TxProcessor.createDoc2Doc(cud as TxCreateDoc<Issue>).identifier
      } else if (tx._class === core.class.TxUpdateDoc) {
        const next = (tx as TxUpdateDoc<Issue>).operations.identifier
        if (next === undefined) continue
        if (matched.has(tx._id) && identifier !== next) {
          if (identifier === undefined) {
            control.ctx.warn('Cannot create issue identifier alias without previous identifier', {
              issueId: issue._id,
              txId: tx._id
            })
          } else {
            result.push(
              control.txFactory.createTxCreateDoc(tracker.class.IssueIdentifierAlias, issue.space, {
                identifier,
                issue: issue._id
              })
            )
          }
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
