//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import core, { TxProcessor, type Doc, type Ref, type Tx, type TxCUD } from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'

// Triggers see the transaction, not the state before it. The previous values of a document (the status an issue had,
// the value a field had) are rebuilt from the transactions that came before.

function before (a: Pick<Tx, '_id' | 'modifiedOn'>, b: Pick<Tx, '_id' | 'modifiedOn'>): boolean {
  return a.modifiedOn < b.modifiedOn || (a.modifiedOn === b.modifiedOn && a._id < b._id)
}

/**
 * The document as it was just before `tx` and just after it, from the history of the object. `before` is undefined
 * for a document `tx` creates (or whose creation is not in the history). A removal in the history is ignored, so the
 * state of a document that was removed can still be read.
 */
export async function replayAround<T extends Doc> (
  control: TriggerControl,
  tx: TxCUD<T>
): Promise<{ before: T | undefined, after: T | undefined }> {
  const history = (await control.findAll(control.ctx, core.class.TxCUD, { objectId: tx.objectId as Ref<Doc> })) as Tx[]
  const earlier = history
    .filter((h) => h._id !== tx._id && h._class !== core.class.TxRemoveDoc && before(h, tx))
    .sort((a, b) => a.modifiedOn - b.modifiedOn || (a._id < b._id ? -1 : 1))
  const prev = TxProcessor.buildDoc2Doc<T>(earlier) ?? undefined
  const next =
    tx._class === core.class.TxRemoveDoc ? prev : (TxProcessor.buildDoc2Doc<T>([...earlier, tx]) ?? undefined)
  return { before: prev, after: next }
}
