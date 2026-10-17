//
// Copyright © 2020 Anticrm Platform Contributors.
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

import { PlatformError, Severity, Status } from '@hcengineering/platform'
import { type Lookup, type MeasureContext, type ReverseLookups, getObjectValue } from '.'
import type { Class, Doc, Ref } from './classes'

import { clone } from './clone'
import core from './component'
import { type Hierarchy } from './hierarchy'
import { checkMixinKey, matchQuery, resultSort } from './query'
import type {
  AssociationQuery,
  DocumentQuery,
  FindOptions,
  FindResult,
  LookupData,
  Storage,
  TxResult,
  WithLookup
} from './storage'
import type { Tx, TxCreateDoc, TxMixin, TxRemoveDoc, TxUpdateDoc } from './tx'
import { TxProcessor } from './tx'
import { toFindResult } from './utils'

function deepFreeze (value: any): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const key of Object.keys(value)) {
    deepFreeze(value[key])
  }
}

/**
 * @public
 */
export abstract class MemDb extends TxProcessor implements Storage {
  private readonly objectsByClass = new Map<Ref<Class<Doc>>, Map<Ref<Doc>, Doc>>()
  protected readonly objectById = new Map<Ref<Doc>, Doc>()
  // Documents of the shared parent this db hides (removed or replaced here).
  private readonly shadowed = new Set<Ref<Doc>>()

  /** `parent` is a shared system model; own documents win, the rest is read from it. */
  constructor (
    protected readonly hierarchy: Hierarchy,
    protected readonly parent?: MemDb
  ) {
    super()
  }

  private getObjectsByClass (_class: Ref<Class<Doc>>): Map<Ref<Doc>, Doc> {
    const result = this.objectsByClass.get(_class)
    if (result === undefined) {
      const result = new Map<Ref<Doc>, Doc>()
      this.objectsByClass.set(_class, result)
      return result
    }
    return result
  }

  /** Own documents of a class plus the parent's, minus anything this db shadows. */
  private allOfClass (_class: Ref<Class<Doc>>): Doc[] {
    const own = this.objectsByClass.get(_class)
    if (this.parent === undefined) {
      return own === undefined ? [] : Array.from(own.values())
    }
    if (own === undefined && this.shadowed.size === 0) {
      return this.parent.allOfClass(_class)
    }
    const result: Doc[] = []
    for (const doc of this.parent.allOfClass(_class)) {
      if (!this.shadowed.has(doc._id) && own?.has(doc._id) !== true) {
        result.push(doc)
      }
    }
    if (own !== undefined) {
      result.push(...own.values())
    }
    return result
  }

  protected findDoc<T extends Doc> (_id: Ref<T>): T | undefined {
    const own = this.objectById.get(_id)
    if (own !== undefined) return own as T
    if (this.shadowed.has(_id)) return undefined
    return this.parent?.findDoc(_id)
  }

  private cleanObjectByClass (_class: Ref<Class<Doc>>, _id: Ref<Doc>): void {
    const result = this.objectsByClass.get(_class)
    if (result !== undefined) {
      result.delete(_id)
    }
  }

  private getByIdQuery<T extends Doc> (query: DocumentQuery<T>, _class: Ref<Class<T>>): T[] {
    const result: T[] = []
    if (typeof query._id === 'string') {
      const obj = this.findDoc(query._id) as T
      if (obj !== undefined && this.hierarchy.isDerived(obj._class, _class)) result.push(obj)
    } else if (query._id?.$in !== undefined) {
      const ids = new Set(query._id.$in)
      for (const id of ids) {
        const obj = this.findDoc(id) as T
        if (obj !== undefined && this.hierarchy.isDerived(obj._class, _class)) result.push(obj)
      }
    }
    return result
  }

  getObject<T extends Doc> (_id: Ref<T>): T {
    const doc = this.findDoc(_id)
    if (doc === undefined) {
      throw new PlatformError(new Status(Severity.ERROR, core.status.ObjectNotFound, { _id }))
    }
    return doc
  }

  findObject<T extends Doc> (_id: Ref<T>): T | undefined {
    const doc = this.findDoc(_id)
    return doc
  }

  private async getLookupValue<T extends Doc> (
    _class: Ref<Class<T>>,
    doc: T,
    lookup: Lookup<T>,
    result: LookupData<T>
  ): Promise<void> {
    for (const key in lookup) {
      if (key === '_id') {
        await this.getReverseLookupValue(doc, lookup, result)
        continue
      }
      const value = (lookup as any)[key]
      const tkey = checkMixinKey(key, _class, this.hierarchy)
      const refId = getObjectValue(tkey, doc)
      if (refId == null) continue

      if (Array.isArray(value)) {
        const [_class, nested] = value
        const objects = await this.findAll(_class, { _id: refId })
        ;(result as any)[key] = objects[0]
        const nestedResult = {}
        const parent = (result as any)[key]
        await this.getLookupValue(_class, parent, nested, nestedResult)
        Object.assign(parent, {
          $lookup: nestedResult
        })
      } else {
        const objects = await this.findAll(value, { _id: refId })
        ;(result as any)[key] = objects[0]
      }
    }
  }

  private async getReverseLookupValue<T extends Doc> (
    doc: T,
    lookup: ReverseLookups,
    result: LookupData<T>
  ): Promise<void> {
    for (const key in lookup._id) {
      const value = lookup._id[key]
      if (Array.isArray(value)) {
        const objects = await this.findAll(value[0], { [value[1]]: doc._id })
        ;(result as any)[key] = objects
      } else {
        const objects = await this.findAll(value, { attachedTo: doc._id })
        ;(result as any)[key] = objects
      }
    }
  }

  private async lookup<T extends Doc> (_class: Ref<Class<T>>, docs: T[], lookup: Lookup<T>): Promise<WithLookup<T>[]> {
    const withLookup: WithLookup<T>[] = []
    for (const doc of docs) {
      const result: LookupData<T> = {}
      await this.getLookupValue(_class, doc, lookup, result)
      withLookup.push(Object.assign({}, doc, { $lookup: result }))
    }
    return withLookup
  }

  private async fillAssociations<T extends Doc> (docs: T[], associations: AssociationQuery[]): Promise<WithLookup<T>[]> {
    const withLookup: WithLookup<T>[] = []
    for (const doc of docs) {
      const result = await this.getAssociationValue(doc, associations)
      withLookup.push(Object.assign({}, doc, { $associations: result }))
    }
    return withLookup
  }

  private async getAssociationValue<T extends Doc> (
    doc: T,
    associations: AssociationQuery[]
  ): Promise<Record<string, WithLookup<Doc>[]>> {
    const result: Record<string, Doc[]> = {}
    for (const association of associations) {
      const _id = association[0]
      const assoc = this.findObject(_id)
      if (assoc === undefined) continue
      const isReverse = association[1] === -1
      const key = !isReverse ? 'docA' : 'docB'
      const key2 = !isReverse ? 'docB' : 'docA'
      const _class = !isReverse ? assoc.classB : assoc.classA
      const relations = await this.findAll(core.class.Relation, { association: _id, [key]: doc._id })
      let objects = await this.findAll(_class, { _id: { $in: relations.map((r) => r[key2]) } })
      if (association[2] !== undefined) {
        objects = toFindResult(await this.fillAssociations(objects, association[2]), objects.length)
      }
      result[`${_id}_${!isReverse ? 'b' : 'a'}`] = objects
    }
    return result
  }

  async findAll<T extends Doc> (
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<FindResult<T>> {
    let result: WithLookup<Doc>[]
    const baseClass = this.hierarchy.getBaseClass(_class)
    if (
      Object.prototype.hasOwnProperty.call(query, '_id') &&
      (typeof query._id === 'string' || query._id?.$in !== undefined || query._id === undefined || query._id === null)
    ) {
      result = this.getByIdQuery(query, baseClass)
    } else {
      result = this.allOfClass(baseClass)
    }

    result = matchQuery(result, query, _class, this.hierarchy, true)

    if (baseClass !== _class) {
      // We need to filter instances without mixin was set
      result = result.filter((r) => (r as any)[_class] !== undefined)
    }

    if (options?.lookup !== undefined) {
      result = await this.lookup(_class, result as T[], options.lookup)
      result = matchQuery(result, query, _class, this.hierarchy)
    }

    if (options?.associations !== undefined) {
      result = await this.fillAssociations(result, options.associations)
    }

    if (options?.sort !== undefined) resultSort(result as T[], options?.sort, _class, this.hierarchy, this)
    const total = result.length
    result = result.slice(0, options?.limit)
    const tresult = this.hierarchy.clone(result) as WithLookup<T>[]
    const res = tresult.map((it) => this.hierarchy.updateLookupMixin(_class, it, options))
    return toFindResult(res, total)
  }

  async findOne<T extends Doc> (
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<WithLookup<T> | undefined> {
    return (await this.findAll(_class, query, { ...options, limit: 1 }))[0]
  }

  /**
   * Only in model find without lookups and sorting.
   * Do not clone results, so be aware modifications are not allowed.
   */
  findAllSync<T extends Doc> (_class: Ref<Class<T>>, query: DocumentQuery<T>, options?: FindOptions<T>): FindResult<T> {
    let result: WithLookup<Doc>[]
    const baseClass = this.hierarchy.getBaseClass(_class)
    if (
      Object.prototype.hasOwnProperty.call(query, '_id') &&
      (typeof query._id === 'string' || query._id?.$in !== undefined || query._id === undefined || query._id === null)
    ) {
      result = this.getByIdQuery(query, baseClass)
    } else {
      result = this.allOfClass(baseClass)
    }

    result = matchQuery(result, query, _class, this.hierarchy, true)

    if (baseClass !== _class) {
      // We need to filter instances without mixin was set
      result = result.filter((r) => (r as any)[_class] !== undefined)
    }
    if (options?.sort !== undefined) resultSort(result as T[], options?.sort, _class, this.hierarchy, this)
    const total = result.length
    result = result.slice(0, options?.limit)

    return toFindResult(
      result.map((it) => {
        return baseClass !== _class ? this.hierarchy.as(it, _class) : it
      }) as WithLookup<T>[],
      total
    )
  }

  addDoc (doc: Doc): void {
    this.objectById.set(doc._id, doc)
    this.indexByClass(doc)
  }

  /** Deep freeze every document held now: a direct write into a shared one must not leak. */
  freeze (): void {
    for (const doc of this.objectById.values()) {
      deepFreeze(doc)
    }
  }

  /** Copy-on-write: a document of the shared parent must be deep copied, never mutated in place. */
  protected ownDoc<T extends Doc> (_id: Ref<T>): T | undefined {
    const own = this.objectById.get(_id)
    if (own !== undefined && !Object.isFrozen(own)) {
      return own as T
    }
    if (own !== undefined && this.parent === undefined) {
      throw new Error(`frozen shared model must not be modified: ${_id}`)
    }
    const doc = own ?? this.findDoc(_id)
    if (doc === undefined) {
      return undefined
    }
    const copy = clone(doc)
    this.objectById.set(copy._id, copy)
    this.shadowed.add(copy._id)
    for (const _class of this.hierarchy.getAncestors(copy._class)) {
      this.getObjectsByClass(_class).set(copy._id, copy)
    }
    this.hierarchy.replaceDoc(copy)
    return copy as T
  }

  protected indexByClass (doc: Doc): void {
    this.hierarchy.getAncestors(doc._class).forEach((_class) => {
      const arr = this.getObjectsByClass(_class)
      arr.set(doc._id, doc)
    })
  }

  delDoc (_id: Ref<Doc>): void {
    const doc = this.findDoc(_id)
    if (doc === undefined) {
      throw new PlatformError(new Status(Severity.ERROR, core.status.ObjectNotFound, { _id }))
    }
    this.objectById.delete(_id)
    // Hides the parent's copy too - the shared model itself must stay untouched.
    this.shadowed.add(_id)
    this.hierarchy.getAncestors(doc._class).forEach((_class) => {
      this.cleanObjectByClass(_class, _id)
    })
  }

  updateDoc (_id: Ref<Doc>, doc: Doc, update: TxUpdateDoc<Doc> | TxMixin<Doc, Doc>): void {
    // TODO: track updates on Contact to adjust memdb accounts?
  }
}

/**
 * Hold transactions
 *
 * @public
 */
export class TxDb extends MemDb {
  protected txCreateDoc (tx: TxCreateDoc<Doc>): Promise<TxResult> {
    throw new Error('Method not implemented.')
  }

  protected txUpdateDoc (tx: TxUpdateDoc<Doc>): Promise<TxResult> {
    throw new Error('Method not implemented.')
  }

  protected txRemoveDoc (tx: TxRemoveDoc<Doc>): Promise<TxResult> {
    throw new Error('Method not implemented.')
  }

  protected txMixin (tx: TxMixin<Doc, Doc>): Promise<TxResult> {
    throw new Error('Method not implemented.')
  }

  async tx (tx: Tx): Promise<TxResult[]> {
    this.addDoc(tx)
    return []
  }
}

/**
 * Hold model objects and classes
 *
 * @public
 */
export class ModelDb extends MemDb {
  protected override async txCreateDoc (tx: TxCreateDoc<Doc>): Promise<TxResult> {
    this.addDoc(TxProcessor.createDoc2Doc(tx))
    return {}
  }

  addTxes (ctx: MeasureContext, txes: Tx[], doClone: boolean): void {
    // Materialize first, index by class after: a doc may appear before its own class is created.
    const created: Doc[] = []
    // Orphan-targeted txes are reported as one summary line at the end, not one warning each.
    const orphans: Array<{ _id: Ref<Doc>, _class: string, objectId: Ref<Doc> }> = []
    for (const tx of txes) {
      // Hierarchy references the created instance instead of deserializing its own copy.
      let ownDoc: Doc | undefined
      switch (tx._class) {
        case core.class.TxCreateDoc: {
          const doc = TxProcessor.createDoc2Doc(tx as TxCreateDoc<Doc>, doClone)
          this.objectById.set(doc._id, doc)
          created.push(doc)
          ownDoc = doc
          break
        }
        case core.class.TxUpdateDoc: {
          const cud = tx as TxUpdateDoc<Doc>
          const doc = this.ownDoc(cud.objectId)
          if (doc !== undefined) {
            this.updateDoc(cud.objectId, doc, cud)
            TxProcessor.updateDoc2Doc(doc, cud)
          } else {
            orphans.push({ _id: tx._id, _class: tx._class, objectId: cud.objectId })
          }
          break
        }
        case core.class.TxRemoveDoc:
          try {
            this.delDoc((tx as TxRemoveDoc<Doc>).objectId)
          } catch (err: any) {
            orphans.push({
              _id: tx._id,
              _class: tx._class,
              objectId: (tx as TxRemoveDoc<Doc>).objectId
            })
          }
          break
        case core.class.TxMixin: {
          const mix = tx as TxMixin<Doc, Doc>
          const doc = this.ownDoc(mix.objectId)
          if (doc !== undefined) {
            this.updateDoc(mix.objectId, doc, mix)
            TxProcessor.updateMixin4Doc(doc, mix)
          } else {
            orphans.push({ _id: tx._id, _class: tx._class, objectId: mix.objectId })
          }
          break
        }
      }
      try {
        this.hierarchy.tx(tx, ownDoc)
      } catch (err: any) {
        ctx.warn('failed to apply model transaction to hierarchy, skipping', {
          _id: tx._id,
          _class: tx._class,
          err
        })
      }
    }
    for (const doc of created) {
      // Skip what a later tx of the same batch removed or replaced.
      if (this.objectById.get(doc._id) !== doc) continue
      try {
        this.indexByClass(doc)
      } catch (err: any) {
        // A doc of an unknown class must not stop indexing the rest of the batch.
        ctx.warn('failed to index model document, skipping', { _id: doc._id, _class: doc._class, err })
      }
    }
    if (orphans.length > 0) {
      const byClass: Record<string, number> = {}
      for (const o of orphans) byClass[o._class] = (byClass[o._class] ?? 0) + 1
      // Single coalesced info line per addTxes call. The previous per-TX
      // `ctx.warn` produced one console line per orphan on every page
      // load. MeasureContext has no `debug` channel, so a deeper dump for
      // diagnostics isn't available here — operators who need the per-TX
      // list can re-enable it via a local patch.
      ctx.info('skipped model transactions for orphan documents', {
        total: orphans.length,
        byClass
      })
    }
  }

  protected async txUpdateDoc (tx: TxUpdateDoc<Doc>): Promise<TxResult> {
    try {
      const doc = this.ownDoc(tx.objectId) as any
      this.updateDoc(tx.objectId, doc, tx)
      TxProcessor.updateDoc2Doc(doc, tx)
      return tx.retrieve === true ? { object: doc } : {}
    } catch (err: any) {}
    return {}
  }

  protected async txRemoveDoc (tx: TxRemoveDoc<Doc>): Promise<TxResult> {
    try {
      this.delDoc(tx.objectId)
    } catch (err: any) {}
    return {}
  }

  // TODO: process ancessor mixins
  protected async txMixin (tx: TxMixin<Doc, Doc>): Promise<TxResult> {
    const doc = this.ownDoc(tx.objectId) as any
    if (doc === undefined) {
      throw new PlatformError(new Status(Severity.ERROR, core.status.ObjectNotFound, { _id: tx.objectId }))
    }
    this.updateDoc(tx.objectId, doc, tx)
    TxProcessor.updateMixin4Doc(doc, tx)
    return {}
  }
}
