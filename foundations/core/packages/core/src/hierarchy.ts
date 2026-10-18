//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
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

import { type FindOptions, type Lookup, type ToClassRefT, type WithLookup } from '.'
import type { AnyAttribute, Class, Classifier, Doc, Domain, Interface, Mixin, Obj, Ref } from './classes'
import { ClassifierKind } from './classes'
import { clone as deepClone } from './clone'
import core from './component'
import { _createMixinProxy, _mixinClass, _toDoc, PROXY_MIXIN_CLASS_KEY } from './proxy'
import type { Tx, TxCreateDoc, TxCUD, TxMixin, TxRemoveDoc, TxUpdateDoc } from './tx'
import { TxProcessor } from './tx'

/**
 * @public
 */
export class Hierarchy {
  private readonly classifiers = new Map<Ref<Classifier>, Classifier>()
  private readonly attributes = new Map<Ref<Classifier>, Map<string, AnyAttribute>>()
  private readonly attributesById = new Map<Ref<AnyAttribute>, AnyAttribute>()
  // Derived on demand: a class may be created before its parent, and an eagerly derived
  // chain would stay truncated forever.
  private readonly descendants = new Map<Ref<Classifier>, Ref<Classifier>[]>()
  private readonly ancestors = new Map<Ref<Classifier>, Ref<Classifier>[]>()

  // Instances owned by ModelDb: it applies their updates, doing it here too would double $push/$inc.
  private readonly externallyOwned = new Set<Ref<Doc>>()

  // Classifiers and attributes of the shared parent hidden here: the parent itself stays untouched.
  private readonly removed = new Set<Ref<Doc>>()

  private readonly inheritedDomains = new Map<Ref<Class<Doc>>, Domain>()

  // A parent classifier re-created/updated/removed here may have changed the parent's descendant lists.
  private parentOverridden = false

  /** Shared system hierarchy this one extends: own entries win, the rest is read from it. */
  constructor (private readonly parent?: Hierarchy) {}

  private findClassifier (_id: Ref<Classifier>): Classifier | undefined {
    const own = this.classifiers.get(_id)
    if (own !== undefined) return own
    return this.removed.has(_id) ? undefined : this.parent?.findClassifier(_id)
  }

  private hasClassifier (_id: Ref<Classifier>): boolean {
    if (this.classifiers.has(_id)) return true
    return this.removed.has(_id) ? false : (this.parent?.hasClassifier(_id) ?? false)
  }

  private classifierIds (): IterableIterator<Ref<Classifier>> {
    if (this.parent === undefined) {
      return this.classifiers.keys()
    }
    const ids = new Set<Ref<Classifier>>()
    for (const _id of this.parent.classifierIds()) {
      if (!this.removed.has(_id)) ids.add(_id)
    }
    for (const _id of this.classifiers.keys()) {
      ids.add(_id)
    }
    return ids.values()
  }

  /** Own map of a class is complete (parent's entries copied in on first write), so no merge per call. */
  private ownAttributesOf (_class: Ref<Classifier>): Map<string, AnyAttribute> | undefined {
    return this.attributes.get(_class) ?? this.parent?.ownAttributesOf(_class)
  }

  private ownAttributeMap (_class: Ref<Classifier>): Map<string, AnyAttribute> {
    let attributes = this.attributes.get(_class)
    if (attributes === undefined) {
      attributes = new Map(this.parent?.ownAttributesOf(_class))
      this.attributes.set(_class, attributes)
    }
    return attributes
  }

  private findAttributeById (_id: Ref<AnyAttribute>): AnyAttribute | undefined {
    const own = this.attributesById.get(_id)
    if (own !== undefined) return own
    return this.removed.has(_id) ? undefined : this.parent?.findAttributeById(_id)
  }

  /** Copy-on-write: an attribute owned by the shared parent must not be mutated in place. */
  private ownAttribute (_id: Ref<AnyAttribute>): AnyAttribute | undefined {
    const own = this.attributesById.get(_id)
    if (own !== undefined) return own
    const inherited = this.findAttributeById(_id)
    if (inherited === undefined) return undefined
    const copy = deepClone(inherited)
    this.addAttribute(copy)
    return copy
  }

  /** Copy-on-write: a classifier owned by the shared parent must not be mutated in place. */
  private ownClassifier (_id: Ref<Classifier>): Classifier | undefined {
    const own = this.classifiers.get(_id)
    if (own !== undefined) return own
    const inherited = this.findClassifier(_id)
    if (inherited === undefined) return undefined
    const copy = deepClone(inherited)
    this.classifiers.set(_id, copy)
    this.invalidateChains()
    return copy
  }

  private readonly proxies = new Map<Ref<Mixin<Doc>>, ProxyHandler<Doc>>()

  private readonly classifierProperties = new Map<Ref<Classifier>, Map<string, any>>()

  private createMixinProxyHandler (mixin: Ref<Mixin<Doc>>): ProxyHandler<Doc> {
    const value = this.getClass(mixin)
    const ancestor = this.getClass(value.extends as Ref<Class<Obj>>)
    const ancestorProxy = ancestor.kind === ClassifierKind.MIXIN ? this.getMixinProxyHandler(ancestor._id) : null
    return _createMixinProxy(value, ancestorProxy)
  }

  private getMixinProxyHandler (mixin: Ref<Mixin<Doc>>): ProxyHandler<Doc> {
    const handler = this.proxies.get(mixin)
    if (handler === undefined) {
      const handler = this.createMixinProxyHandler(mixin)
      this.proxies.set(mixin, handler)
      return handler
    }
    return handler
  }

  /**
   * Proxy get-invariant: a frozen own property must be returned as is, so a mixin value may not
   * shadow a root key of the same name. Only such a collision forces an unfrozen copy.
   */
  private shadowsFrozenKey (target: Doc, mixin: Ref<Mixin<Doc>>): boolean {
    // The proxy falls back to ancestor mixins, so their values collide the same way.
    for (const _class of this.getAncestors(mixin)) {
      const value = (target as any)[_class]
      if (typeof value !== 'object' || value === null) continue
      // for-in, not Object.keys: this runs on every mixin read and must not allocate.
      for (const key in value) {
        if (key in target) return true
      }
    }
    return false
  }

  as<D extends Doc, M extends D> (doc: D, mixin: Ref<Mixin<M>>): M {
    if ((doc as any)[PROXY_MIXIN_CLASS_KEY] === mixin) return doc as M

    const handler = this.getMixinProxyHandler(mixin)
    const target = Hierarchy.toDoc(doc)
    const copy = Object.isFrozen(target) && this.shadowsFrozenKey(target, mixin)
    return new Proxy(copy ? { ...target } : target, handler) as M
  }

  asIf<D extends Doc, M extends D> (doc: D | undefined, mixin: Ref<Mixin<M>>): M | undefined {
    if (doc === undefined) {
      return undefined
    }
    return this.hasMixin(doc, mixin) ? this.as(doc, mixin) : undefined
  }

  asIfArray<D extends Doc, M extends D> (docs: D[], mixin: Ref<Mixin<M>>): M[] {
    return docs.map((it) => this.asIf(it, mixin)).filter((it) => it !== undefined)
  }

  static toDoc<D extends Doc> (doc: D): D {
    return _toDoc(doc)
  }

  static mixinClass<D extends Doc, M extends D> (doc: D): Ref<Mixin<M>> | undefined {
    return _mixinClass(doc)
  }

  static mixinOrClass<D extends Doc, M extends D> (doc: D): Ref<Mixin<M> | Class<Doc>> {
    const m = _mixinClass(doc)
    return m ?? doc._class
  }

  static hasMixin<D extends Doc, M extends D> (doc: D, mixin: Ref<Mixin<M>>): boolean {
    const d = Hierarchy.toDoc(doc)
    return typeof (d as any)[mixin] === 'object'
  }

  hasMixin<D extends Doc, M extends D> (doc: D, mixin: Ref<Mixin<M>>): boolean {
    return Hierarchy.hasMixin(doc, mixin)
  }

  // M is a mixin on the class, not on the document, so it is not bound to D: mixins such as
  // ObjectPresenter extend Class<Doc>, which never extends the document type D.
  classHierarchyMixin<D extends Doc, M extends Doc> (
    _class: Ref<Class<D>>,
    mixin: Ref<Mixin<M>>,
    filter?: (value: M) => boolean
  ): M | undefined {
    let clazz = this.getClass(_class)
    while (true) {
      if (this.hasMixin(clazz, mixin)) {
        const m = this.as(clazz, mixin) as any as M
        if (m !== undefined && (filter?.(m) ?? true)) {
          return m
        }
      }
      if (clazz.extends === undefined) return
      clazz = this.getClass(clazz.extends)
    }
  }

  findClassOrMixinMixin<D extends Doc, M extends D> (doc: Doc, mixin: Ref<Mixin<M>>): M | undefined {
    const cc = this.classHierarchyMixin(doc._class, mixin)
    if (cc !== undefined) {
      return cc
    }

    const _doc = _toDoc(doc)
    // Find all potential mixins of doc
    for (const [k, v] of Object.entries(_doc)) {
      if (typeof v === 'object' && this.hasClassifier(k as Ref<Classifier>)) {
        const cc = this.classHierarchyMixin(k as Ref<Mixin<Doc>>, mixin)
        if (cc !== undefined) {
          return cc
        }
      }
    }
  }

  findMixinMixins<D extends Doc, M extends D> (doc: Doc, mixin: Ref<Mixin<M>>): M[] {
    const _doc = _toDoc(doc)
    const result: M[] = []
    const resultSet = new Set<string>()
    // Find all potential mixins of doc
    for (const [k, v] of Object.entries(_doc)) {
      if (typeof v === 'object' && this.hasClassifier(k as Ref<Classifier>)) {
        const clazz = this.getClass(k as Ref<Classifier>)
        if (this.hasMixin(clazz, mixin)) {
          const cc = this.as(clazz, mixin) as any as M
          if (cc !== undefined && !resultSet.has(cc._id)) {
            result.push(cc)
            resultSet.add(cc._id)
          }
        }
      }
    }
    return result
  }

  findAllMixins<D extends Doc, M extends D> (doc: Doc): Ref<Class<M>>[] {
    const _doc = _toDoc(doc)
    const resultSet = new Set<Ref<Class<M>>>()
    for (const [k, v] of Object.entries(_doc)) {
      if (typeof v === 'object' && this.hasClassifier(k as Ref<Classifier>)) {
        if (this.isMixin(k as Ref<Classifier>)) {
          if (!resultSet.has(k as Ref<Classifier>)) {
            resultSet.add(k as Ref<Classifier>)
          }
        }
      }
    }
    return Array.from(resultSet)
  }

  getAllPossibleMixins (_class: Ref<Class<Doc>>, to: Ref<Class<Doc>> = core.class.Doc): Ref<Mixin<Doc>>[] {
    const result = new Set<Ref<Mixin<Doc>>>()
    let c = this.getClass(_class)

    while (c._id !== to && c.extends !== undefined) {
      const _descendants = this.getDescendants(c._id)
      for (const d of _descendants) {
        if (this.isMixin(d) && this.getBaseClass(d) === c._id) {
          result.add(d)
        }
      }
      c = this.getClass(c.extends)
    }

    return [...result]
  }

  isMixin (_class: Ref<Class<Doc>>): boolean {
    const data = this.findClassifier(_class)
    return data !== undefined && this._isMixin(data)
  }

  getAncestors (_class: Ref<Classifier>): Ref<Classifier>[] {
    const cached = this.ancestors.get(_class)
    if (cached !== undefined) {
      return cached
    }
    if (!this.hasClassifier(_class)) {
      throw new Error('ancestors not found: ' + _class)
    }
    // Parent's chain is shared as is unless something on it is overridden or removed here.
    let result = this.classifiers.has(_class) ? undefined : this.parent?.getAncestors(_class)
    if (result?.some((id) => this.classifiers.has(id) || this.removed.has(id)) === true) {
      result = undefined
    }
    result ??= this.buildAncestors(_class)
    this.ancestors.set(_class, result)
    return result
  }

  private buildAncestors (_class: Ref<Classifier>): Ref<Classifier>[] {
    const cl: Ref<Classifier>[] = [_class]
    const visited = new Set<Ref<Classifier>>()
    const ancestorList: Ref<Classifier>[] = []

    while (cl.length > 0) {
      const classifier = cl.shift() as Ref<Classifier>
      if (addNew(visited, classifier)) {
        ancestorList.push(classifier)
        cl.push(...this.ancestorsOf(classifier))
      }
    }
    return ancestorList
  }

  private invalidateChains (): void {
    this.ancestors.clear()
    this.descendants.clear()
    this.inheritedDomains.clear()
  }

  getClass<T extends Obj = Obj> (_class: Ref<Class<T>>): Class<T> {
    const data = this.findClassifier(_class)
    if (data === undefined || this.isInterface(data)) {
      throw new Error('class not found: ' + _class)
    }
    return data
  }

  findClass<T extends Obj = Obj> (_class: Ref<Class<T>>): Class<T> | undefined {
    const data = this.findClassifier(_class)
    if (data === undefined || this.isInterface(data)) {
      return undefined
    }
    return data
  }

  hasClass<T extends Obj = Obj> (_class: Ref<Class<T>>): boolean {
    const data = this.findClassifier(_class)

    return !(data === undefined || this.isInterface(data))
  }

  getClassOrInterface (_class: Ref<Class<Obj>>): Class<Obj> {
    const data = this.findClassifier(_class)
    if (data === undefined) {
      throw new Error('class not found: ' + _class)
    }
    return data
  }

  getInterface (_interface: Ref<Interface<Doc>>): Interface<Doc> {
    const data = this.findClassifier(_interface)
    if (data === undefined || !this.isInterface(data)) {
      throw new Error('interface not found: ' + _interface)
    }
    return data
  }

  getDomain (_class: Ref<Class<Obj>>): Domain {
    const domain = this.findDomain(_class)
    if (domain === undefined) {
      throw new Error(`domain not found: ${_class} `)
    }
    return domain
  }

  public findDomain (_class: Ref<Class<Doc>>): Domain | undefined {
    const klazz = this.findClass(_class)
    if (klazz === undefined) return
    if (klazz.domain !== undefined) {
      return klazz.domain
    }
    const cached = this.inheritedDomains.get(_class)
    if (cached !== undefined) {
      return cached
    }
    // Same chain object as the parent's: its domain cache is valid here too.
    if (
      this.parent !== undefined &&
      !this.classifiers.has(_class) &&
      this.getAncestors(_class) === this.parent.getAncestors(_class)
    ) {
      return this.parent.findDomain(_class)
    }

    let _klazz: Class<Doc> | undefined = klazz
    while (_klazz.extends !== undefined) {
      _klazz = this.findClass(_klazz.extends)
      if (_klazz === undefined) return
      if (_klazz.domain !== undefined) {
        // Cached aside: writing it into the class would mutate a document shared across workspaces.
        this.inheritedDomains.set(_class, _klazz.domain)
        return _klazz.domain
      }
    }
  }

  public getMixinClasses (mixin: Ref<Mixin<Doc>>): Ref<Class<Doc>>[] {
    const result: Ref<Class<Doc>>[] = []
    for (const _id of this.classifierIds()) {
      try {
        if (this.classHierarchyMixin(_id, mixin) !== undefined) {
          result.push(_id)
        }
      } catch (e) {
        // ignore
      }
    }

    return result
  }

  /**
   * `doc` hands over an instance owned by the caller (ModelDb): it is referenced, not copied,
   * and its updates are left to the owner. Without `doc` the hierarchy owns its documents.
   */
  tx (tx: Tx, doc?: Doc): void {
    switch (tx._class) {
      case core.class.TxCreateDoc:
        this.txCreateDoc(tx as TxCreateDoc<Doc>, doc)
        return
      case core.class.TxUpdateDoc:
        this.txUpdateDoc(tx as TxUpdateDoc<Doc>)
        return
      case core.class.TxRemoveDoc:
        this.txRemoveDoc(tx as TxRemoveDoc<Doc>)
        return
      case core.class.TxMixin:
        this.txMixin(tx as TxMixin<Doc, Doc>)
    }
  }

  /** Point classifier/attribute indexes at a new instance of a document its owner replaced. */
  replaceDoc (doc: Doc): void {
    if (this.hasClassifier(doc._id as Ref<Classifier>)) {
      this.classifiers.set(doc._id as Ref<Classifier>, doc as Classifier)
      this.classifierProperties.delete(doc._id as Ref<Classifier>)
      this.externallyOwned.add(doc._id)
    } else if (this.findAttributeById(doc._id as Ref<AnyAttribute>) !== undefined) {
      this.addAttribute(doc as AnyAttribute)
      this.externallyOwned.add(doc._id)
    }
  }

  private isClassifierTx (tx: TxCUD<Doc>): boolean {
    return CLASSIFIER_CLASSES.includes(tx.objectClass) || this.isDerived(tx.objectClass, core.class.Class)
  }

  private txCreateDoc (tx: TxCreateDoc<Doc>, doc?: Doc): void {
    const isClassifier = this.isClassifierTx(tx)
    if (!isClassifier && tx.objectClass !== core.class.Attribute) return
    // Without an instance the hierarchy owns its copy again (callers may replay a tx after addTxes).
    if (doc !== undefined) this.externallyOwned.add(tx.objectId)
    else this.externallyOwned.delete(tx.objectId)
    this.removed.delete(tx.objectId)
    if (isClassifier) {
      const _id = tx.objectId as Ref<Classifier>
      if (this.parent?.hasClassifier(_id) === true) this.parentOverridden = true
      this.classifiers.set(_id, (doc as Classifier) ?? TxProcessor.createDoc2Doc(tx as TxCreateDoc<Classifier>))
      this.invalidateChains()
    } else {
      const createTx = tx as TxCreateDoc<AnyAttribute>
      this.addAttribute((doc as AnyAttribute) ?? TxProcessor.createDoc2Doc(createTx))
    }
  }

  private txUpdateDoc (tx: TxUpdateDoc<Doc>): void {
    if (tx.objectClass === core.class.Attribute) {
      const updateTx = tx as TxUpdateDoc<AnyAttribute>
      const doc = this.ownAttribute(updateTx.objectId)
      if (doc === undefined) return
      if (!this.externallyOwned.has(doc._id)) {
        TxProcessor.updateDoc2Doc(doc, updateTx)
      }
      this.addAttribute(doc)
      // A rename leaves the attribute under its old name otherwise.
      const map = this.ownAttributeMap(doc.attributeOf)
      for (const [name, attr] of map) {
        if (name !== doc.name && attr._id === doc._id) {
          const inherited = this.parent?.ownAttributesOf(doc.attributeOf)?.get(name)
          if (inherited !== undefined && inherited._id !== doc._id && !this.removed.has(inherited._id)) {
            map.set(name, inherited)
          } else {
            map.delete(name)
          }
        }
      }

      this.classifierProperties.delete(doc.attributeOf)
    } else if (this.isClassifierTx(tx)) {
      const updateTx = tx as TxUpdateDoc<Mixin<Class<Doc>>>
      const doc = this.ownClassifier(updateTx.objectId)
      if (doc === undefined) return
      if (!this.externallyOwned.has(doc._id)) {
        TxProcessor.updateDoc2Doc(doc, updateTx)
      }
      this.classifierProperties.delete(doc._id)
      // extends/implements may have changed
      if (this.parent?.hasClassifier(doc._id) === true) this.parentOverridden = true
      this.invalidateChains()
    }
  }

  private txRemoveDoc (tx: TxRemoveDoc<Doc>): void {
    if (tx.objectClass === core.class.Attribute) {
      const removeTx = tx as TxRemoveDoc<AnyAttribute>
      const doc = this.findAttributeById(removeTx.objectId)
      if (doc === undefined) return
      this.attributesById.delete(removeTx.objectId)
      this.externallyOwned.delete(removeTx.objectId)
      this.removed.add(removeTx.objectId)
      const map = this.ownAttributeMap(doc.attributeOf)
      if (map.get(doc.name)?._id === removeTx.objectId) {
        // A same-named shared attribute becomes visible again once its override is gone.
        const inherited = this.parent?.ownAttributesOf(doc.attributeOf)?.get(doc.name)
        if (inherited !== undefined && inherited._id !== doc._id && !this.removed.has(inherited._id)) {
          map.set(doc.name, inherited)
        } else {
          map.delete(doc.name)
        }
      }
    } else if (this.isClassifierTx(tx)) {
      const removeTx = tx as TxRemoveDoc<Mixin<Class<Doc>>>
      if (this.parent?.hasClassifier(removeTx.objectId) === true) this.parentOverridden = true
      this.classifiers.delete(removeTx.objectId)
      this.externallyOwned.delete(removeTx.objectId)
      this.removed.add(removeTx.objectId)
      this.invalidateChains()
    }
  }

  private txMixin (tx: TxMixin<Doc, Doc>): void {
    if (this.isClassifierTx(tx)) {
      if (this.externallyOwned.has(tx.objectId)) return
      const obj = this.ownClassifier(tx.objectId as Ref<Classifier>)
      if (obj === undefined) return
      TxProcessor.updateMixin4Doc(obj, tx)
    }
  }

  /** Check if passed _class is derived from `from` class. */
  isDerived<T extends Obj> (_class: Ref<Class<T>>, from: Ref<Class<T>>): boolean {
    const cached = this.ancestors.get(_class)
    if (cached !== undefined) {
      return cached.includes(from)
    }
    // Unknown classifiers answer false here rather than throwing, as they always did.
    return this.hasClassifier(_class) ? this.getAncestors(_class).includes(from) : false
  }

  /**
   * Return first non interface/mixin parent
   */
  getBaseClass<T extends Doc> (_class: Ref<Mixin<T>>): Ref<Class<T>> {
    let cl: Ref<Class<T>> | undefined = _class
    while (cl !== undefined) {
      const clz: Class<T> = this.getClass(cl)
      if (this.isClass(clz)) return cl
      cl = clz.extends
    }
    return core.class.Doc
  }

  /**
   * Check if passed _class implements passed interfaces `from`.
   * It will check for class parents and their interfaces.
   */
  isImplements<T extends Doc> (_class: Ref<Class<T>>, from: Ref<Interface<T>>): boolean {
    let cl: Ref<Class<T>> | undefined = _class
    while (cl !== undefined) {
      const klazz: Class<T> = this.getClass(cl)
      if (this.isExtends(klazz.implements ?? [], from)) {
        return true
      }
      cl = klazz.extends
    }
    return false
  }

  /**
   * Check if interface extends passed interface.
   */
  private isExtends<T extends Doc> (extendsOrImplements: Ref<Interface<Doc>>[], from: Ref<Interface<T>>): boolean {
    const result: Ref<Interface<Doc>>[] = []
    const toVisit = [...extendsOrImplements]
    while (toVisit.length > 0) {
      const ref = toVisit.shift() as Ref<Interface<Doc>>
      if (ref === from) {
        return true
      }
      addIf(result, ref)
      toVisit.push(...this.ancestorsOf(ref))
    }
    return false
  }

  /** An unknown classifier simply has no descendants - queries may still reference removed classes. */
  getDescendants<T extends Obj> (_class: Ref<Class<T>>): Ref<Class<Obj>>[] {
    const cached = this.descendants.get(_class)
    if (cached !== undefined) {
      return cached
    }
    if (!this.hasClassifier(_class)) {
      return []
    }
    let result: Ref<Classifier>[]
    if (this.parent !== undefined && !this.parentOverridden) {
      // Parent chains are intact: its list plus own classes deriving from _class.
      const inherited = this.parent.getDescendants(_class)
      const own: Ref<Classifier>[] = []
      for (const id of this.classifiers.keys()) {
        if (!this.parent.hasClassifier(id) && this.getAncestors(id).includes(_class)) own.push(id)
      }
      result = own.length === 0 ? inherited : [...inherited, ...own]
    } else {
      result = []
      for (const classifier of this.classifierIds()) {
        if (this.getAncestors(classifier).includes(_class)) {
          result.push(classifier)
        }
      }
    }
    this.descendants.set(_class, result)
    return result
  }

  /**
   * Return extends and implemnets as combined list of references
   */
  private ancestorsOf (classifier: Ref<Classifier>): Ref<Classifier>[] {
    const attrs = this.findClassifier(classifier)
    const result: Ref<Classifier>[] = []
    if (this.isClass(attrs) || this._isMixin(attrs)) {
      const cls = attrs as Class<Doc>
      if (cls.extends !== undefined) {
        result.push(cls.extends)
      }
      result.push(...(cls.implements ?? []))
    }
    if (this.isInterface(attrs)) {
      result.push(...((attrs as Interface<Doc>).extends ?? []))
    }
    return result
  }

  private isClass (attrs?: Classifier): boolean {
    return attrs?.kind === ClassifierKind.CLASS
  }

  private _isMixin (attrs?: Classifier): boolean {
    return attrs?.kind === ClassifierKind.MIXIN
  }

  private isInterface (attrs?: Classifier): boolean {
    return attrs?.kind === ClassifierKind.INTERFACE
  }

  private addAttribute (attribute: AnyAttribute): void {
    this.ownAttributeMap(attribute.attributeOf).set(attribute.name, attribute)
    this.attributesById.set(attribute._id, attribute)
    this.classifierProperties.delete(attribute.attributeOf)
  }

  getAllAttributes (
    clazz: Ref<Classifier>,
    to?: Ref<Classifier>,
    traverse?: (name: string, attr: AnyAttribute) => void
  ): Map<string, AnyAttribute> {
    const result = new Map<string, AnyAttribute>()
    let ancestors = this.getAncestors(clazz)
    if (to !== undefined) {
      const toAncestors = this.getAncestors(to)
      for (const uto of toAncestors) {
        if (ancestors.includes(uto)) {
          to = uto
          break
        }
      }
      ancestors = ancestors.filter(
        (c) => c !== to && (this.isInterface(this.findClassifier(c)) || this.isDerived(c, to as Ref<Class<Doc>>))
      )
    }

    for (let index = ancestors.length - 1; index >= 0; index--) {
      const cls = ancestors[index]
      const attributes = this.ownAttributesOf(cls)
      if (attributes !== undefined) {
        for (const [name, attr] of attributes) {
          traverse?.(name, attr)
          result.set(name, attr)
        }
      }
    }

    return result
  }

  getOwnAttributes (clazz: Ref<Classifier>): Map<string, AnyAttribute> {
    const result = new Map<string, AnyAttribute>()

    const attributes = this.ownAttributesOf(clazz)
    if (attributes !== undefined) {
      for (const [name, attr] of attributes) {
        result.set(name, attr)
      }
    }

    return result
  }

  getParentClass (_class: Ref<Class<Obj>>): Ref<Class<Obj>> {
    const baseDomain = this.getDomain(_class)
    const ancestors = this.getAncestors(_class)
    let result: Ref<Class<Obj>> = _class
    for (const ancestor of ancestors) {
      try {
        const domain = this.getClass(ancestor).domain
        if (domain === baseDomain) {
          result = ancestor
        }
      } catch {}
    }
    return result
  }

  getAttribute (classifier: Ref<Classifier>, name: string): AnyAttribute {
    const attr = this.findAttribute(classifier, name)
    if (attr === undefined) {
      throw new Error('attribute not found: ' + name)
    }
    return attr
  }

  public findAttribute (classifier: Ref<Classifier>, name: string): AnyAttribute | undefined {
    const list = [classifier]
    const visited = new Set<Ref<Classifier>>()
    while (list.length > 0) {
      const cl = list.shift() as Ref<Classifier>
      if (addNew(visited, cl)) {
        const attribute = this.ownAttributesOf(cl)?.get(name)
        if (attribute !== undefined) {
          return attribute
        }
        // Check ancestorsOf
        list.push(...this.ancestorsOf(cl))
      }
    }
  }

  updateLookupMixin<T extends Doc> (
    _class: Ref<Class<T>>,
    result: WithLookup<T>,
    options?: FindOptions<T>
  ): WithLookup<T> {
    const baseClass = this.getBaseClass(_class)
    const vResult = baseClass !== _class ? this.as(result, _class) : result
    const lookup = result.$lookup
    if (lookup !== undefined) {
      // We need to check if lookup type is mixin and cast to it if required.
      const lu = options?.lookup as Lookup<Doc>
      if (lu?._id !== undefined) {
        for (const [k, v] of Object.entries(lu._id)) {
          const _cl = getClass(v as ToClassRefT<T, keyof T>)
          if (this.isMixin(_cl)) {
            const mval = (lookup as any)[k]
            if (mval !== undefined) {
              if (Array.isArray(mval)) {
                ;(lookup as any)[k] = mval.map((it) => this.as(it, _cl))
              } else {
                ;(lookup as any)[k] = this.as(mval, _cl)
              }
            }
          }
        }
      }
      for (const [k, v] of Object.entries(lu ?? {})) {
        if (k === '_id') {
          continue
        }
        const _cl = getClass(v as ToClassRefT<T, keyof T>)
        if (this.isMixin(_cl)) {
          const mval = (lookup as any)[k]
          if (mval != null) {
            ;(lookup as any)[k] = this.as(mval, _cl)
          }
        }
      }
    }
    return vResult
  }

  clone (obj: any): any {
    return deepClone(
      obj,
      (doc, m) => this.as(doc, m),
      (value) => Hierarchy.mixinClass(value)
    )
  }

  domains (): Domain[] {
    const classes = Array.from(this.classifierIds(), (_id) => this.findClassifier(_id)).filter(
      (it) => it !== undefined && (this.isClass(it) || this._isMixin(it))
    ) as Class<Doc>[]
    return classes
      .map((it) => it.domain)
      .filter((it) => it !== undefined)
      .filter((it, idx, array) => array.findIndex((pt) => pt === it) === idx)
  }

  getClassifierProp (cl: Ref<Class<Doc>>, prop: string): any | undefined {
    return this.classifierProperties.get(cl)?.get(prop)
  }

  setClassifierProp (cl: Ref<Class<Doc>>, prop: string, value: any): void {
    let cur = this.classifierProperties.get(cl)
    if (cur === undefined) {
      cur = new Map<string, any>()
      this.classifierProperties.set(cl, cur)
    }
    cur.set(prop, value)
  }
}

const CLASSIFIER_CLASSES: Ref<Class<Doc>>[] = [core.class.Class, core.class.Mixin, core.class.Interface]

function addNew<T> (val: Set<T>, value: T): boolean {
  if (val.has(value)) {
    return false
  }
  val.add(value)
  return true
}

function addIf<T> (array: T[], value: T): void {
  if (!array.includes(value)) {
    array.push(value)
  }
}

function getClass<T extends Doc> (vvv: ToClassRefT<T, keyof T>): Ref<Class<T>> {
  if (Array.isArray(vvv)) {
    return vvv[0]
  }
  return vvv
}
