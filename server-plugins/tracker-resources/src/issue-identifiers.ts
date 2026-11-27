// SPDX-License-Identifier: EPL-2.0

import core, {
  groupByArray,
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

const HISTORY_LOOKUP_CONCURRENCY = 4

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

  const issueIds = new Set(updates.map((tx) => tx.objectId))
  const ids = [...issueIds]
  const pending = groupByArray(
    (control.txes as TxCUD<Issue>[]).filter((tx) => issueIds.has(tx.objectId)),
    (tx) => tx.objectId
  )
  const [issues, aliases] = await Promise.all([
    control.findAll(control.ctx, tracker.class.Issue, { _id: { $in: ids } }, { showArchived: true }),
    control.findAll(control.ctx, tracker.class.IssueIdentifierAlias, { issue: { $in: ids } }, { showArchived: true })
  ])
  const aliasesByIssue = groupByArray(aliases, (alias) => alias.issue)
  const matched = new Set<Ref<Tx>>(updates.map((tx) => tx._id))
  const result: Tx[] = []
  for (let offset = 0; offset < issues.length; offset += HISTORY_LOOKUP_CONCURRENCY) {
    const batch = issues.slice(offset, offset + HISTORY_LOOKUP_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (issue) => {
        const changes = await replayIdentifierUpdates(issue, pending.get(issue._id) ?? [], matched, control)
        for (const alias of aliasesByIssue.get(issue._id) ?? []) {
          if (alias.space !== issue.space) {
            changes.push(
              control.txFactory.createTxUpdateDoc(alias._class, alias.space, alias._id, { space: issue.space })
            )
          }
        }
        return changes
      })
    )
    for (const changes of results) {
      for (const change of changes) result.push(change)
    }
  }
  return result
}

async function replayIdentifierUpdates (
  issue: Issue,
  pending: TxCUD<Issue>[],
  matched: Set<Ref<Tx>>,
  control: TriggerControl
): Promise<Tx[]> {
  const result: Tx[] = []
  let identifier: string | undefined
  let needsHistory = true
  // Replay the issue's transactions in order so multiple moves retain every identifier.
  for (const tx of pending) {
    if (tx._class === core.class.TxCreateDoc) {
      identifier = (tx as TxCreateDoc<Issue>).attributes.identifier
      needsHistory = false
    } else if (tx._class === core.class.TxUpdateDoc) {
      const next = (tx as TxUpdateDoc<Issue>).operations.identifier
      if (next === undefined) continue
      if (matched.has(tx._id)) {
        if (needsHistory) {
          identifier = await findPreviousIdentifier(
            issue._id,
            pending.map((tx) => tx._id),
            control
          )
        }
        if (identifier === undefined) {
          control.ctx.warn('Cannot create issue identifier alias without previous identifier', {
            issueId: issue._id,
            txId: tx._id
          })
        } else if (identifier !== next) {
          result.push(
            control.txFactory.createTxCreateDoc(tracker.class.IssueIdentifierAlias, issue.space, {
              identifier,
              issue: issue._id
            })
          )
        }
      }
      identifier = next
      needsHistory = false
    }
  }
  return result
}
