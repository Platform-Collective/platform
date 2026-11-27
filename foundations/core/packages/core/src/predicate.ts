//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021 Hardcore Engineering Inc.
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

import type { Doc } from './classes'
import { getObjectValue } from './objvalue'
import { escapeLikeForRegexp } from './utils'

import { deepEqual } from 'fast-equals'

type Predicate = (docs: Doc[]) => Doc[]
type PredicateFactory = (pred: any, propertyKey: string, same: ValueMatcher) => Predicate

type ExecPredicate = (value: any) => boolean

/**
 * Compares a query value with a stored value (or a stored list item).
 */
export type ValueMatcher = (queryValue: any, value: any) => boolean

function isPlainObject (value: any): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

/**
 * Literal matching: objects are compared by content, since the query and the document never share
 * the same object instance; other values with `==`.
 */
export function isSameValue (queryValue: any, value: any): boolean {
  if (queryValue !== null && typeof queryValue === 'object') {
    return deepEqual(queryValue, value)
  }
  return queryValue == value
}

/**
 * The fields that identify a link (`RelatedDocument`) in a query value, or undefined when the value is
 * not a link. Items of a link list are matched by these fields only; other fields are ignored.
 */
export function getLinkIdentity (queryValue: any): { _id?: any, _class?: any } | undefined {
  if (!isPlainObject(queryValue)) return undefined
  if (queryValue._id === undefined && queryValue._class === undefined) return undefined
  const result: { _id?: any, _class?: any } = {}
  if (queryValue._id !== undefined) result._id = queryValue._id
  if (queryValue._class !== undefined) result._class = queryValue._class
  return result
}

/**
 * Matching for items of a link list (`ArrOf(TypeRef(core.class.TypeRelatedDocument))`): a link matches a
 * stored item with the same `_id` and `_class`, whatever other fields it holds. Other values match literally.
 */
export function isSameLink (queryValue: any, value: any): boolean {
  const identity = getLinkIdentity(queryValue)
  if (identity === undefined) return isSameValue(queryValue, value)
  if (!isPlainObject(value)) return false
  return (
    (identity._id === undefined || value._id === identity._id) &&
    (identity._class === undefined || value._class === identity._class)
  )
}

/**
 * Checks if an array holds a query value.
 */
export function includesValue (values: any[], queryValue: any, same: ValueMatcher = isSameValue): boolean {
  if (queryValue !== null && typeof queryValue === 'object') {
    return values.some((it) => same(queryValue, it))
  }
  return values.includes(queryValue)
}

function execPredicate (docs: Doc[], propertyKey: string, pred: ExecPredicate): Doc[] {
  const result: Doc[] = []
  for (const doc of docs) {
    const value = getObjectValue(propertyKey, doc)
    if (pred(value)) {
      result.push(doc)
    }
  }
  return result
}

const predicates: Record<string, PredicateFactory> = {
  $in: (o, propertyKey, same) => {
    if (!Array.isArray(o)) {
      throw new Error('$in predicate requires array')
    }
    return (docs) =>
      execPredicate(docs, propertyKey, (value) => {
        if (Array.isArray(value)) {
          return o.some((p) => includesValue(value, p, same))
        } else {
          return o.some((p) => same(p, value))
        }
      })
  },
  $all: (o, propertyKey, same) => {
    if (!Array.isArray(o)) {
      throw new Error('$all predicate requires array')
    }
    return (docs) =>
      execPredicate(docs, propertyKey, (value: any[]) => {
        if (!Array.isArray(value)) return false
        for (const val of o) {
          if (!includesValue(value, val, same)) return false
        }
        return true
      })
  },
  $nin: (o, propertyKey, same) => {
    if (!Array.isArray(o)) {
      throw new Error('$nin predicate requires array')
    }
    return (docs) =>
      execPredicate(docs, propertyKey, (value) => {
        if (Array.isArray(value)) {
          return !o.some((p) => includesValue(value, p, same))
        } else {
          return !o.some((p) => same(p, value))
        }
      })
  },

  $like: (query: string, propertyKey: string): Predicate => {
    const searchString = query
      .split('%')
      .map((it) => escapeLikeForRegexp(it))
      .join('.*')
    const regex = RegExp(`^${searchString}$`, 'i')

    return (docs) => execPredicate(docs, propertyKey, (value) => regex.test(value))
  },

  $regex: (o: { $regex: string, $options: string }, propertyKey: string): Predicate => {
    const re = new RegExp(o.$regex, o.$options)
    return (docs) => execPredicate(docs, propertyKey, (value) => value.match(re) !== null)
  },
  $gt: (o, propertyKey) => (docs) => execPredicate(docs, propertyKey, (value) => value > o),
  $gte: (o, propertyKey) => (docs) => execPredicate(docs, propertyKey, (value) => value >= o),
  $lt: (o, propertyKey) => (docs) => execPredicate(docs, propertyKey, (value) => value < o),
  $lte: (o, propertyKey) => (docs) => execPredicate(docs, propertyKey, (value) => value <= o),
  $exists: (o, propertyKey) => (docs) => execPredicate(docs, propertyKey, (value) => (value !== undefined) === o),
  $ne: (o, propertyKey) => (docs) =>
    execPredicate(docs, propertyKey, (value) => (o != null ? !deepEqual(o, value) : value != null)),
  $size: (o, propertyKey) => (docs) =>
    execPredicate(docs, propertyKey, (value) => {
      if (value == null) {
        return false
      }
      if (!Array.isArray(value)) {
        throw new Error('$size predicate requires array')
      }
      if (typeof o === 'number') {
        return value.length === o
      }
      if (typeof o === 'object' && o.$gt !== undefined) {
        return value.length > o.$gt
      }
      if (typeof o === 'object' && o.$gte !== undefined) {
        return value.length >= o.$gte
      }
      if (typeof o === 'object' && o.$lt !== undefined) {
        return value.length < o.$lt
      }
      if (typeof o === 'object' && o.$lte !== undefined) {
        return value.length <= o.$lte
      }
      return false
    })
}

export function isPredicate (o: Record<string, any>): boolean {
  if (o === null || typeof o !== 'object') {
    return false
  }
  const keys = Object.keys(o)
  return keys.length > 0 && keys.every((key) => key.startsWith('$'))
}

export function createPredicates (
  o: Record<string, any>,
  propertyKey: string,
  same: ValueMatcher = isSameValue
): Predicate[] {
  const keys = Object.keys(o)
  const result: Predicate[] = []
  for (const key of keys) {
    const factory = predicates[key]
    if (factory === undefined) throw new Error(`unknown predicate: ${keys[0]}`)
    result.push(factory(o[key], propertyKey, same))
  }
  return result
}
