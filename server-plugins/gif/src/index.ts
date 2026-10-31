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
 * @public
 */
export class GifMiddleware extends BaseMiddleware {
  static async create (ctx: MeasureContext, context: PipelineContext, next?: Middleware): Promise<Middleware> {
    return new GifMiddleware(context, next)
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    for (const tx of txes) {
      if (!GUARDED.has(tx._class)) continue
      const cud = tx as TxCUD<Doc>
      // Routing is by objectClass, and DOMAIN_GIF holds only WorkspaceGif, so a tx that names
      // another class cannot reach a library row.
      if (!this.context.hierarchy.isDerived(cud.objectClass, gif.class.WorkspaceGif)) continue
      await this.checkChange(ctx, cud)
    }
    return await this.provideTx(ctx, txes)
  }

  private async checkChange (ctx: MeasureContext<SessionData>, cud: TxCUD<Doc>): Promise<void> {
    const account = ctx.contextData.account
    // Maintainers and owners may change any entry. The system account is an owner, so server
    // side cleanup and migrations pass without a lookup.
    if (hasAccountRole(account, AccountRole.Maintainer)) return

    const current = (
      await this.provideFindAll(ctx, gif.class.WorkspaceGif, { _id: cud.objectId as Ref<WorkspaceGif> }, { limit: 1 })
    ).shift()
    // Nothing stored under this id, so there is no entry to protect; the pipeline handles it as usual.
    if (current === undefined) return

    if (!canRemoveGif(current, account.socialIds, false)) {
      ctx.warn('Changing a GIF library entry uploaded by another member is not allowed', {
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
