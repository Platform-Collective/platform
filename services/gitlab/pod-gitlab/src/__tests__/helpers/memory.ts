// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test double over heterogeneous documents */

import type { TxOperations } from '@hcengineering/core'

export type Row = Record<string, any>

export interface MemoryClient {
  docs: Row[]
  findAll: (_class: string, query?: Row, options?: { sort?: Record<string, number>, limit?: number }) => Promise<Row[]>
  findOne: (_class: string, query?: Row, options?: { sort?: Record<string, number> }) => Promise<Row | undefined>
  createDoc: (
    _class: string,
    space: string,
    data: Row,
    id?: string,
    modifiedOn?: number,
    modifiedBy?: string
  ) => Promise<string>
  addCollection: (
    _class: string,
    space: string,
    attachedTo: string,
    attachedToClass: string,
    collection: string,
    data: Row,
    id?: string,
    modifiedOn?: number,
    modifiedBy?: string
  ) => Promise<string>
  update: (doc: Row, ops: Row, retrieve?: boolean, modifiedOn?: number, modifiedBy?: string) => Promise<void>
  updateDoc: (_class: string, space: string, id: string, ops: Row, retrieve?: boolean) => Promise<Row>
  createMixin: (id: string, _class: string, space: string, mixin: string, attrs: Row) => Promise<void>
  updateMixin: (id: string, _class: string, space: string, mixin: string, attrs: Row) => Promise<void>
  remove: (doc: Row) => Promise<void>
  removeCollection: (_class: string, space: string, id: string) => Promise<void>
  removeDoc: (_class: string, space: string, id: string) => Promise<void>
  getHierarchy: () => {
    hasMixin: (doc: Row, mixin: string) => boolean
    as: (doc: Row, mixin: string) => Row
    isDerived: (a: string, b: string) => boolean
  }
}

function matchValue (value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    const c = cond as Row
    if ('$in' in c) return (c.$in as unknown[]).some((it) => matchValue(value, it))
    if ('$nin' in c) return !(c.$nin as unknown[]).some((it) => matchValue(value, it))
    if ('$ne' in c) return !matchValue(value, c.$ne)
    if ('$exists' in c) return (value !== undefined && value !== null) === c.$exists
  }
  if (Array.isArray(value)) return value.includes(cond)
  if (cond === null) return value === null || value === undefined
  return value === cond
}

// A query key may be a dotted path into nested objects ('operations.doneOn'), as on the real client
function valueAt (doc: Row, key: string): unknown {
  if (key in doc) return doc[key]
  return key.split('.').reduce<unknown>((value, part) => (value as Row | undefined)?.[part], doc)
}

// A doc is visible as its class, or as a mixin it carries (merged view, like the real client).
function view (doc: Row, _class: string): Row | undefined {
  if (doc._class === _class) return { ...doc }
  if (doc[_class] !== undefined) return { ...doc, ...doc[_class] }
  return undefined
}

function compare (a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === undefined || a === null) return -1
  if (b === undefined || b === null) return 1
  return (a as any) < (b as any) ? -1 : 1
}

export function createMemoryClient (): MemoryClient {
  const docs: Row[] = []
  let n = 0
  // A Huly document and its DocSyncInfo share the same _id, so documents are addressed by _id and _class.
  const indexOf = (id: string, _class?: string): number =>
    docs.findIndex((d) => d._id === id && (_class === undefined || d._class === _class))
  const byId = (id: string, _class?: string): Row => {
    const doc = docs[indexOf(id, _class)]
    if (doc === undefined) throw new Error(`memory client: no doc ${id} of ${_class ?? 'any class'}`)
    return doc
  }
  const client: MemoryClient = {
    docs,
    findAll: async (_class, query = {}, options = {}) => {
      let rows = docs
        .map((d) => view(d, _class))
        .filter(
          (d): d is Row => d !== undefined && Object.entries(query).every(([k, v]) => matchValue(valueAt(d, k), v))
        )
      if (options.sort !== undefined) {
        const [[key, dir]] = Object.entries(options.sort)
        rows.sort((a, b) => compare(a[key], b[key]) * (dir > 0 ? 1 : -1))
      }
      if (options.limit !== undefined) rows = rows.slice(0, options.limit)
      return rows
    },
    findOne: async (_class, query = {}, options = {}) =>
      (await client.findAll(_class, query, { ...options, limit: 1 }))[0],
    createDoc: async (_class, space, data, id, modifiedOn, modifiedBy) => {
      const _id = id ?? `doc-${++n}`
      const time = modifiedOn ?? Date.now()
      docs.push({ _id, _class, space, modifiedOn: time, createdOn: time, modifiedBy: modifiedBy ?? 'system', ...data })
      return _id
    },
    addCollection: async (_class, space, attachedTo, attachedToClass, collection, data, id, modifiedOn, modifiedBy) =>
      await client.createDoc(
        _class,
        space,
        { ...data, attachedTo, attachedToClass, collection },
        id,
        modifiedOn,
        modifiedBy
      ),
    update: async (doc, ops, _retrieve, modifiedOn, modifiedBy) => {
      const target = byId(doc._id, doc._class)
      Object.assign(target, ops)
      if (modifiedOn !== undefined) target.modifiedOn = modifiedOn
      if (modifiedBy !== undefined) target.modifiedBy = modifiedBy
    },
    updateDoc: async (_class, _space, id, ops) => {
      const target = byId(id, _class)
      for (const [key, value] of Object.entries(ops)) {
        if (key === '$inc') {
          for (const [field, by] of Object.entries(value as Row)) target[field] = (target[field] ?? 0) + by
        } else {
          target[key] = value
        }
      }
      return { object: { ...target } }
    },
    createMixin: async (id, _class, _space, mixin, attrs) => {
      byId(id, _class)[mixin] = { ...attrs }
    },
    updateMixin: async (id, _class, _space, mixin, attrs) => {
      const target = byId(id, _class)
      target[mixin] = { ...(target[mixin] ?? {}), ...attrs }
    },
    remove: async (doc) => {
      docs.splice(indexOf(doc._id, doc._class), 1)
    },
    removeCollection: async (_class, _space, id) => {
      docs.splice(indexOf(id, _class), 1)
    },
    removeDoc: async (_class, _space, id) => {
      docs.splice(indexOf(id, _class), 1)
    },
    getHierarchy: () => ({
      hasMixin: (doc, mixin) => doc[mixin] !== undefined,
      as: (doc, mixin) => ({ ...doc, ...(doc[mixin] ?? {}) }),
      isDerived: (a, b) => a === b
    })
  }
  return client
}

export function asTxOperations (memory: MemoryClient): TxOperations {
  return memory as unknown as TxOperations
}
