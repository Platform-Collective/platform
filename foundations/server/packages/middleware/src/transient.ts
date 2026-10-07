//
// Copyright © 2026 Intabia Fusion
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
//
// A middleware to support TTL for transient objects.
import core, {
  DOMAIN_TRANSIENT,
  reduceCalls,
  TxFactory,
  TxProcessor,
  type Class,
  type Doc,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Tx,
  type TxCUD
} from '@hcengineering/core'
import {
  BaseMiddleware,
  type DbAdapter,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'

/**
 * @public
 */
export class TransientMiddleware extends BaseMiddleware implements Middleware {
  private readonly ttlValues = new Map<Ref<Class<Doc>>, number>()
  private readonly ttlObjectMap = new Map<Ref<Doc>, number>()
  ttlChecker: any
  now = Date.now() / 1000
  dbProvider?: DbAdapter

  private constructor (
    readonly ctx: MeasureContext,
    context: PipelineContext,
    next?: Middleware
  ) {
    super(context, next)

    // Need to find all classes with TTL enabled
    const classes = context.modelDb.findAllSync(core.mixin.TransientTTL, {})
    for (const cl of classes) {
      this.ttlValues.set(cl._id as Ref<Class<Doc>>, cl.ttl)
    }

    this.dbProvider = context.adapterManager?.getAdapter?.(DOMAIN_TRANSIENT, true)
    if (this.dbProvider !== undefined) {
      this.ttlChecker = setInterval(() => {
        void this.checkTTL()
      }, 1000)
    }
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<TransientMiddleware> {
    return new TransientMiddleware(ctx, context, next)
  }

  checkTTL = reduceCalls(async () => {
    if (this.dbProvider === undefined) {
      return
    }
    this.now = Date.now() / 1000 // Now in seconds

    const docsToRemove: Ref<Doc>[] = []
    for (const v of this.ttlObjectMap.entries()) {
      if (v[1] < this.now) {
        docsToRemove.push(v[0])
      }
    }

    if (docsToRemove.length > 0) {
      // Drop the expired entries from the map so they are not reprocessed and
      // re-broadcast on every tick (and the map cannot grow unbounded).
      for (const id of docsToRemove) {
        this.ttlObjectMap.delete(id)
      }
      const f = new TxFactory(core.account.System)
      const docs = await this.dbProvider.load(this.ctx, DOMAIN_TRANSIENT, docsToRemove)
      // We need to remove all of this docs
      await this.dbProvider.clean(this.ctx, DOMAIN_TRANSIENT, docsToRemove)

      await this.context.broadcastEvent?.(
        this.ctx,
        docs.map((it) => f.createTxRemoveDoc(it._class, it.space, it._id))
      )
    }
  })

  override async close (): Promise<void> {
    if (this.ttlChecker !== undefined) {
      clearInterval(this.ttlChecker)
      this.ttlChecker = undefined
    }
    await super.close()
  }

  tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    for (const tx of txes.filter((it) => TxProcessor.isExtendsCUD(it._class)) as TxCUD<Doc>[]) {
      const ttl = this.ttlValues.get(tx.objectClass)
      if (ttl !== undefined && this.context.hierarchy.findDomain(tx.objectClass) === DOMAIN_TRANSIENT) {
        if (tx._class === core.class.TxRemoveDoc) {
          // ok we have operation against our TTL object.
          this.ttlObjectMap.delete(tx.objectId)
        } else {
          // ok we have operation against our TTL object.
          this.ttlObjectMap.set(tx.objectId, this.now + ttl + 1)
        }
      }
    }

    return this.provideTx(ctx, txes)
  }
}
