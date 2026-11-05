//
// Copyright © 2026 Hardcore Engineering Inc.
// Copyright © 2026 Exaviz
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import core, {
  AccountRole,
  hasAccountRole,
  type Class,
  type Doc,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Tx,
  type TxCUD
} from '@hcengineering/core'
import gif, { canRemoveGif, type WorkspaceGif } from '@hcengineering/gif'
import platform, { PlatformError, plugin, Severity, Status, type Plugin } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'

/**
 * @public
 */
export const serverGifId = 'server-gif' as Plugin

const GUARDED = new Set<Ref<Class<Tx>>>([core.class.TxRemoveDoc, core.class.TxUpdateDoc, core.class.TxMixin])

/**
 * Enforces the GIF library removal rule on the server: only the member who uploaded an entry,
 * or a workspace maintainer/owner, may remove it. The picker settings table applies the same
 * rule (canRemoveGif) to disable the button, but without this check any member could call
 * removeDoc on a WorkspaceGif directly.
 *
 * Updates and mixins follow the same rule. Otherwise a member could first rewrite createdBy (or
 * swap the blob) on someone else's entry and then remove it. The picker never updates an entry.
 *
 * It sits after ApplyTxMiddleware, like RatingMiddleware, so transactions inside an apply arrive
 * here unwrapped, and before TxMiddleware, so a rejected batch is never stored. A batch with one
 * disallowed change is rejected as a whole.
 *
 * A change to an id with no stored row is rejected for non-admins too: the id may belong to an
 * upload that is still in flight.
 *
 * The check reads the stored row before TxMiddleware and TxOrderingMiddleware, so batches that
 * touch the library are run one at a time here: each is checked only after the previous one has
 * been stored. Otherwise two removals of the same entry could both pass, and the second could land
 * after another member has re-uploaded the file under the same id.
 *
 * @public
 */
export class GifMiddleware extends BaseMiddleware {
  static async create (ctx: MeasureContext, context: PipelineContext, next?: Middleware): Promise<Middleware> {
    return new GifMiddleware(context, next)
  }

  // Tail of the queue of batches that touch the library. It always resolves, also when a batch
  // is rejected or fails to store, so one failure never blocks the next write.
  private gifWrites: Promise<void> = Promise.resolve()
  // Requests whose batch currently holds the queue. Sync triggers send derived transactions back
  // through MarkDerivedEntryMiddleware, above this one, with the same request context, before the
  // holding batch has finished. Such a batch must not wait for the queue it is already inside.
  private readonly holders = new WeakSet<SessionData>()

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    // Routing is by objectClass, and DOMAIN_GIF holds only WorkspaceGif, so a tx that names
    // another class cannot reach a library row. Creates are queued too: a re-upload must not be
    // stored while an earlier removal of the same id is still on its way down.
    const touchesGif = txes.some((tx) => this.isGifTx(tx))
    if (!touchesGif) return await this.provideTx(ctx, txes)

    if (this.holders.has(ctx.contextData)) return await this.checkAndForward(ctx, txes)

    const previous = this.gifWrites
    let release = (): void => {}
    this.gifWrites = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    this.holders.add(ctx.contextData)
    try {
      // Waits for the rest of the pipeline, including storage, before the next library write is
      // checked.
      return await this.checkAndForward(ctx, txes)
    } finally {
      this.holders.delete(ctx.contextData)
      release()
    }
  }

  private async checkAndForward (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    for (const tx of txes) {
      if (!GUARDED.has(tx._class) || !this.isGifTx(tx)) continue
      await this.checkChange(ctx, tx as TxCUD<Doc>)
    }
    return await this.provideTx(ctx, txes)
  }

  private isGifTx (tx: Tx): boolean {
    const objectClass = (tx as Partial<TxCUD<Doc>>).objectClass
    return objectClass !== undefined && this.context.hierarchy.isDerived(objectClass, gif.class.WorkspaceGif)
  }

  private async checkChange (ctx: MeasureContext<SessionData>, cud: TxCUD<Doc>): Promise<void> {
    const account = ctx.contextData.account
    // Maintainers and owners may change any entry. The system account is an owner, so server
    // side cleanup and migrations pass without a lookup.
    if (hasAccountRole(account, AccountRole.Maintainer)) return

    const current = (
      await this.provideFindAll(ctx, gif.class.WorkspaceGif, { _id: cud.objectId as Ref<WorkspaceGif> }, { limit: 1 })
    ).shift()
    // No row is not the same as nothing to protect. Library ids are derived from the file
    // (gif-<sha256>), so the id of an upload that is still being stored is known in advance. A
    // removal let through now would be applied once that create lands and delete another
    // member's entry. Only an admin, who may remove any entry anyway, gets past a missing row.
    if (current === undefined || !canRemoveGif(current, account.socialIds, false)) {
      const reason =
        current === undefined
          ? 'Changing a GIF library entry that is not stored (yet) is not allowed'
          : 'Changing a GIF library entry uploaded by another member is not allowed'
      ctx.warn(reason, {
        objectId: cud.objectId,
        txClass: cud._class
      })
      throw this.forbidden()
    }
  }

  private forbidden (): PlatformError<any> {
    return new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
  }
}

/**
 * @public
 */
export default plugin(serverGifId, {})
