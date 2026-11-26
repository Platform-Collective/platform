import type { DocumentQuery, MemDb } from '.'
import type { ArrOf, AnyAttribute, Class, Doc, Enum, EnumOf, Ref, RefTo } from './classes'
import core from './component'
import type { Hierarchy } from './hierarchy'
import { getObjectValue } from './objvalue'
import { createPredicates, includesValue, isPredicate, isSameLink, isSameValue, type ValueMatcher } from './predicate'
import type { Lookup, SortQuerySelector, SortingOrder, SortingQuery, SortingRules } from './storage'

export { getLinkIdentity, isSameLink, isSameValue, type ValueMatcher } from './predicate'

/**
 * @public
 */
export function findProperty (objects: Doc[], propertyKey: string, value: any, same: ValueMatcher = isSameValue): Doc[] {
  if (isPredicate(value)) {
    const preds = createPredicates(value, propertyKey, same)
    for (const pred of preds) {
      objects = pred(objects)
    }
    return objects
  }
  const result: Doc[] = []
  for (const object of objects) {
    const val = getObjectValue(propertyKey, object)
    if (val === value || (val == null && value == null) || isArrayValueCheck(val, value, same)) {
      result.push(object)
    }
  }
  return result
}

function isArrayValueCheck<T, P> (val: T, value: P, same: ValueMatcher): boolean {
  if (!Array.isArray(val)) return false
  // A literal list matches an equal list, as in the databases; another value matches an item of the list.
  return Array.isArray(value) ? isSameValue(val, value) : includesValue(val, value, same)
}

/**
 * Checks if an attribute is declared as a list of links (`ArrOf(TypeRef(core.class.TypeRelatedDocument))`),
 * such as an issue's "blocked by". Items of such lists are matched by `_id` and `_class`.
 * The key may be prefixed with a mixin.
 * @public
 */
export function isLinkListAttribute (hierarchy: Hierarchy, _class: Ref<Class<Doc>>, key: string): boolean {
  let attr: AnyAttribute | undefined
  try {
    const [mixinOrKey, ...rest] = key.split('.')
    attr =
      rest.length > 0 && hierarchy.isMixin(mixinOrKey as Ref<Class<Doc>>)
        ? hierarchy.findAttribute(mixinOrKey as Ref<Class<Doc>>, rest.join('.'))
        : hierarchy.findAttribute(_class, key)
  } catch {
    return false
  }
  if (attr?.type._class !== core.class.ArrOf) return false
  const of: ArrOf<any>['of'] | undefined = (attr.type as ArrOf<any>).of
  return (
    of?._class === core.class.TypeRelatedDocument ||
    (of?._class === core.class.RefTo && (of as RefTo<Doc>).to === core.class.TypeRelatedDocument)
  )
}

/**
 * For a `$lookup.<field>[.$lookup.<field>...].<key>` query key, the class the lookup declares for the looked-up
 * document and the attribute key on it. Undefined for other keys and for keys the lookup does not declare.
 * @public
 */
export function getLookupClass (
  lookup: Lookup<Doc> | undefined,
  key: string
): { _class: Ref<Class<Doc>>, key: string } | undefined {
  const parts = key.split('.')
  let current: any = lookup
  let _class: Ref<Class<Doc>> | undefined
  let i = 0
  while (parts[i] === '$lookup' && i + 2 < parts.length) {
    const value = current?.[parts[i + 1]]
    _class = Array.isArray(value) ? value[0] : value
    current = Array.isArray(value) ? value[1] : undefined
    i += 2
  }
  if (i === 0 || typeof _class !== 'string') return undefined
  return { _class, key: parts.slice(i).join('.') }
}

/**
 * For a `$lookup` key, the class of the looked-up document the document carries, and the key on it.
 */
function getLookupDocClass (doc: Doc, key: string): { _class: Ref<Class<Doc>>, key: string } | undefined {
  const parts = key.split('.')
  let target: any = doc
  let i = 0
  while (parts[i] === '$lookup' && i + 2 < parts.length) {
    target = target?.$lookup?.[parts[i + 1]]
    i += 2
  }
  if (i === 0 || target == null || Array.isArray(target) || typeof target._class !== 'string') return undefined
  return { _class: target._class, key: parts.slice(i).join('.') }
}

/**
 * Checks if a key reached through a lookup is a link list: the looked-up class, or a class derived from it,
 * declares it as one. The adapters and the in-memory matcher use this same rule, so a lookup that names a base
 * class still finds a link list its subclass declares.
 * @public
 */
export function isLookupLinkListAttribute (hierarchy: Hierarchy, _class: Ref<Class<Doc>>, key: string): boolean {
  let classes: Array<Ref<Class<Doc>>>
  try {
    classes = [_class, ...hierarchy.getDescendants(_class)]
  } catch {
    return false
  }
  return classes.some((it) => isLinkListAttribute(hierarchy, it, key))
}

/**
 * The value matcher for an attribute: link identity for link lists, literal matching otherwise.
 * A `$lookup` key is resolved on the class the lookup declares (see isLookupLinkListAttribute). Without the
 * lookup, the class of the looked-up document `doc` carries stands in for it.
 * @public
 */
export function getValueMatcher (
  hierarchy: Hierarchy,
  _class: Ref<Class<Doc>>,
  key: string,
  doc?: Doc,
  lookup?: Lookup<Doc>
): ValueMatcher {
  if (key.startsWith('$lookup.')) {
    const target = getLookupClass(lookup, key) ?? (doc !== undefined ? getLookupDocClass(doc, key) : undefined)
    return target !== undefined && isLookupLinkListAttribute(hierarchy, target._class, target.key)
      ? isSameLink
      : isSameValue
  }
  return isLinkListAttribute(hierarchy, _class, key) ? isSameLink : isSameValue
}

function getEnumValue<T extends Doc> (
  key: string,
  _class: Ref<Class<T>>,
  hierarchy: Hierarchy,
  obj: any,
  _enum: Enum
): number {
  const tkey = checkMixinKey(key, _class, hierarchy)
  const value = getObjectValue(tkey, obj)
  const index = _enum.enumValues.findIndex((p) => p === value)
  return index === -1 ? _enum.enumValues.length : index
}

/**
 * @public
 */
export function resultSort<T extends Doc> (
  result: T[],
  sortOptions: SortingQuery<T>,
  _class: Ref<Class<T>>,
  hierarchy: Hierarchy,
  modelDb: MemDb
): void {
  const enums = getEnums(_class, sortOptions, hierarchy, modelDb)
  const sortFunc = (a: any, b: any): number => {
    for (const key in sortOptions) {
      const _enum = enums[key]
      const aValue =
        _enum !== undefined ? getEnumValue(key, _class, hierarchy, a, _enum) : getValue(key, a, _class, hierarchy)
      const bValue =
        _enum !== undefined ? getEnumValue(key, _class, hierarchy, b, _enum) : getValue(key, b, _class, hierarchy)
      const result = getSortingResult(aValue, bValue, sortOptions[key])
      if (result !== 0) return result
    }
    return 0
  }
  result.sort(sortFunc)
}

function mapSortingValue (order: SortingOrder | SortingRules<any>, val: any): any {
  if (typeof order !== 'object') {
    return val
  }
  for (const r of order.cases) {
    if (typeof r.query === 'object') {
      const q: SortQuerySelector<any> = r.query
      if (q.$in?.includes(val) ?? false) {
        return r.index
      }
      if (q.$nin !== undefined && !q.$nin.includes(val)) {
        return r.index
      }
      if (q.$ne !== undefined && q.$ne !== val) {
        return r.index
      }
    }
    if (r.query === val) {
      return r.index
    }
  }
}

function getSortingResult (aValue: any, bValue: any, order: SortingOrder | SortingRules<any>): number {
  let res = 0
  if (typeof aValue === 'undefined') {
    return typeof bValue === 'undefined' ? 0 : -1
  }
  if (typeof bValue === 'undefined') {
    return 1
  }

  const orderOrder = typeof order === 'object' ? order.order : order

  if (Array.isArray(aValue) && Array.isArray(bValue)) {
    res =
      (aValue.map((it) => mapSortingValue(order, it)).sort((a, b) => (a - b) * orderOrder)[0] ?? 0) -
      (bValue.map((it) => mapSortingValue(order, it)).sort((a, b) => (a - b) * orderOrder)[0] ?? 0)
  } else {
    const aaValue = mapSortingValue(order, aValue)
    const bbValue = mapSortingValue(order, bValue)
    res = typeof aaValue === 'string' ? aaValue.localeCompare(bbValue) : aaValue - bbValue
  }
  return res * orderOrder
}

function getEnums<T extends Doc> (
  _class: Ref<Class<T>>,
  sortOptions: SortingQuery<T>,
  hierarchy: Hierarchy,
  modelDb: MemDb
): Record<string, Enum> {
  const res: Record<string, Enum> = {}
  for (const key in sortOptions) {
    const attr = hierarchy.findAttribute(_class, key)
    if (attr !== undefined) {
      if (attr !== undefined) {
        if (attr.type._class === core.class.EnumOf) {
          const ref = (attr.type as EnumOf).of
          const enu = modelDb.findAllSync(core.class.Enum, { _id: ref })
          res[key] = enu[0]
        }
      }
    }
  }
  return res
}

function getValue<T extends Doc> (key: string, obj: any, _class: Ref<Class<T>>, hierarchy: Hierarchy): any {
  const tkey = checkMixinKey(key, _class, hierarchy)
  let value = getObjectValue(tkey, obj)
  if (typeof value === 'object' && !Array.isArray(value)) {
    value = JSON.stringify(value)
  }
  return value
}
/**
 * @public
 */
export function matchQuery<T extends Doc> (
  docs: Doc[],
  query: DocumentQuery<T>,
  clazz: Ref<Class<T>>,
  hierarchy: Hierarchy,
  skipLookup = false,
  lookup?: Lookup<T>
): Doc[] {
  const baseClass = hierarchy.getBaseClass(clazz)
  let result = docs.filter((r) => hierarchy.isDerived(r._class, baseClass))
  if (baseClass !== clazz) {
    result = docs.filter((r) => hierarchy.hasMixin(r, clazz))
  }
  for (const key in query) {
    if (skipLookup && key.startsWith('$lookup.')) {
      continue
    }
    const value = (query as any)[key]
    const tkey = checkMixinKey(key, clazz, hierarchy)
    if (key.startsWith('$lookup.')) {
      // The attribute belongs to each document's looked-up document.
      result = result.filter((doc) => {
        const matcher = getValueMatcher(hierarchy, clazz, key, doc, lookup)
        return findProperty([doc], tkey, value, matcher).length > 0
      })
    } else {
      result = findProperty(result, tkey, value, getValueMatcher(hierarchy, clazz, key))
    }
    if (result.length === 0) {
      break
    }
  }
  return result
}

/**
 * @public
 */
export function checkMixinKey<T extends Doc> (key: string, clazz: Ref<Class<T>>, hierarchy: Hierarchy): string {
  if (!key.includes('.')) {
    try {
      const attr = hierarchy.findAttribute(clazz, key)
      if (attr !== undefined && hierarchy.isMixin(attr.attributeOf)) {
        // It is mixin
        key = `${attr.attributeOf}.${key}`
      }
    } catch (err: any) {
      // ignore, if
    }
  }
  return key
}
