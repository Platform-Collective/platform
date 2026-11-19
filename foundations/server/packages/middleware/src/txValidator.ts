// SPDX-License-Identifier: EPL-2.0

import core, {
  clone,
  matchQuery,
  systemAccountUuid,
  TxProcessor,
  type Class,
  type Classifier,
  type Doc,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  type TxMixin,
  type TxUpdateDoc
} from '@hcengineering/core'
import platform, { getResource, PlatformError, Severity, Status, type Resource } from '@hcengineering/platform'
import serverCore, {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult,
  type TxValidator,
  type TxValidatorControl,
  type TxValidatorFunc
} from '@hcengineering/server-core'

function deepFreeze (value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const nested of Object.values(value)) {
    deepFreeze(nested)
  }
}

interface ValidatorRecord {
  validator: Resource<TxValidatorFunc>
  objectClass: Ref<Class<Doc>>
  txMatch?: TxValidator['txMatch']
  includeSystem: boolean
}

interface ResolvedRecords {
  ancestors: Ref<Classifier>[]
  records: ValidatorRecord[]
}

/** Runs model-provided validators before transactions reach storage. */
export class TxValidatorMiddleware extends BaseMiddleware implements Middleware {
  private readonly records: ValidatorRecord[] = []
  // Validators per object class, resolved lazily so that classes created after start-up are covered.
  // An entry is valid while the ancestor chain it was computed from is still the hierarchy's current one.
  private readonly resolved = new Map<Ref<Class<Doc>>, ResolvedRecords>()

  private constructor (context: PipelineContext, next: Middleware | undefined, derived: boolean) {
    super(context, next)
    for (const validator of context.modelDb.findAllSync(serverCore.class.TxValidator, {})) {
      if (validator.space !== core.space.Model || validator.modifiedBy !== core.account.System) continue
      if ((validator.includeDerived === true) !== derived) continue
      this.addValidator(validator)
    }
  }

  static async create (ctx: MeasureContext, context: PipelineContext, next?: Middleware): Promise<Middleware> {
    return new TxValidatorMiddleware(context, next, false)
  }

  static async createDerived (ctx: MeasureContext, context: PipelineContext, next?: Middleware): Promise<Middleware> {
    return new TxValidatorMiddleware(context, next, true)
  }

  private addValidator (validator: TxValidator): void {
    const record: ValidatorRecord = {
      validator: validator.validator,
      objectClass: validator.objectClass,
      txMatch: validator.txMatch !== undefined ? clone(validator.txMatch) : undefined,
      includeSystem: validator.includeSystem === true
    }
    this.records.push(record)
  }

  /** Validators registered for the class or one of its ancestors. */
  private recordsFor (_class: Ref<Class<Doc>>): ValidatorRecord[] {
    const hierarchy = this.context.hierarchy
    if (!hierarchy.hasClass(_class)) {
      // Not known (yet): never cache, the class may be created later.
      return this.records.filter((it) => it.objectClass === _class)
    }
    // The chain is rebuilt (new array) whenever the hierarchy changes, which invalidates the entry.
    const ancestors = hierarchy.getAncestors(_class)
    const cached = this.resolved.get(_class)
    if (cached !== undefined && cached.ancestors === ancestors) return cached.records
    const records = this.records.filter((it) => it.objectClass === _class || ancestors.includes(it.objectClass))
    this.resolved.set(_class, { ancestors, records })
    return records
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const cudTxes: TxCUD<Doc>[] = []
    for (const tx of txes) {
      if (TxProcessor.isExtendsCUD(tx._class)) {
        cudTxes.push(tx as TxCUD<Doc>)
      } else if (tx._class === core.class.TxApplyIf) {
        cudTxes.push(...(tx as TxApplyIf).txes.filter((it): it is TxCUD<Doc> => TxProcessor.isExtendsCUD(it._class)))
      }
    }

    const isSystem = ctx.contextData.account.uuid === systemAccountUuid
    if (!isSystem && cudTxes.some((tx) => this.isValidatorWrite(tx))) {
      throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
    }
    if (this.records.length === 0) {
      return await this.provideTx(ctx, txes)
    }

    const records = new Set<ValidatorRecord>()
    for (const tx of cudTxes) {
      for (const record of this.recordsFor(tx.objectClass)) {
        if (!isSystem || record.includeSystem) {
          records.add(record)
        }
      }
    }
    if (records.size === 0) {
      return await this.provideTx(ctx, txes)
    }

    const originals = new WeakMap<object, TxCUD<Doc>>()
    const control: TxValidatorControl = {
      ctx,
      account: ctx.contextData.account,
      hierarchy: this.context.hierarchy,
      modelDb: this.context.modelDb,
      findAllUnfiltered: (findCtx, _class, query, options) => this.provideFindAll(findCtx, _class, query, options),
      current: async (tx) => await this.current(ctx, cudTxes, originals.get(tx) ?? tx)
    }
    for (const record of records) {
      let matches = cudTxes.filter((tx) => this.recordsFor(tx.objectClass).includes(record))
      if (record.txMatch !== undefined) {
        matches = matchQuery(matches, record.txMatch, core.class.Tx, this.context.hierarchy) as TxCUD<Doc>[]
      }
      if (matches.length > 0) {
        try {
          let validator: TxValidatorFunc
          try {
            validator = await getResource(record.validator)
          } catch (err: any) {
            ctx.error('Failed to load transaction validator', {
              resource: record.validator,
              objectClass: record.objectClass,
              err
            })
            throw err
          }
          const frozen = matches.map((tx) => {
            const copy = clone(tx) as TxCUD<Doc>
            deepFreeze(copy)
            originals.set(copy, tx)
            return copy
          })
          await validator(frozen, control)
        } catch (err: any) {
          if (err instanceof PlatformError) throw err
          ctx.error('Transaction validator failed', {
            resource: record.validator,
            objectClass: record.objectClass,
            err
          })
          throw new PlatformError(new Status(Severity.ERROR, platform.status.InternalServerError, {}))
        }
      }
    }
    return await this.provideTx(ctx, txes)
  }

  private isValidatorWrite (tx: TxCUD<Doc>): boolean {
    if (
      tx.objectClass === serverCore.class.TxValidator ||
      this.context.hierarchy.isDerived(tx.objectClass, serverCore.class.TxValidator)
    ) {
      return true
    }
    if (tx._class !== core.class.TxCreateDoc || tx.objectClass !== core.class.Class) return false
    const parent = (tx as TxCreateDoc<Class<Doc>>).attributes.extends
    return (
      parent === serverCore.class.TxValidator ||
      (parent !== undefined && this.context.hierarchy.isDerived(parent, serverCore.class.TxValidator))
    )
  }

  private async current (
    ctx: MeasureContext<SessionData>,
    txes: TxCUD<Doc>[],
    tx: TxCUD<Doc>
  ): Promise<Doc | undefined> {
    let current: Doc | undefined
    let loaded = false
    const index = txes.indexOf(tx)
    for (const previous of index < 0 ? txes : txes.slice(0, index)) {
      if (previous.objectId !== tx.objectId) continue
      if (previous._class === core.class.TxCreateDoc) {
        current = TxProcessor.createDoc2Doc(previous as TxCreateDoc<Doc>)
        loaded = true
        continue
      }
      if (!loaded) {
        current = clone((await this.provideFindAll(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 }))[0])
        loaded = true
      }
      if (current === undefined) continue
      if (previous._class === core.class.TxUpdateDoc) {
        TxProcessor.updateDoc2Doc(current, previous as TxUpdateDoc<Doc>)
      } else if (previous._class === core.class.TxMixin) {
        TxProcessor.updateMixin4Doc(current, previous as TxMixin<Doc, Doc>)
      } else if (previous._class === core.class.TxRemoveDoc) {
        current = undefined
      }
    }
    if (!loaded && tx._class !== core.class.TxCreateDoc) {
      current = clone((await this.provideFindAll(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 }))[0])
    }
    return current
  }
}
