//
// Copyright © 2026 Intabia Fusion.
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
  type Class,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type FindPageOptions,
  type FindPageResult,
  type FindResult,
  type Hierarchy,
  type Ref,
  toFindResult
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { createHash } from 'crypto'
import type { FindPagination, FindPaginationField, ServerFindOptions } from './types'

/**
 * @public
 */
export const MAX_PAGE_SIZE = 1000

const CURSOR_VERSION = 1

/**
 * A decoded cursor position. Kept implementation agnostic: `ClientSession` wraps it into a signed token,
 * in-process clients encode it as plain JSON, but both validate it the very same way.
 *
 * @public
 */
export interface PageCursorPayload {
  version: number
  objectClass: string
  queryHash: string
  fields: FindPaginationField[]
  values: unknown[]
}

/**
 * @public
 */
export function badPageRequest (): PlatformError<Record<string, never>> {
  return new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
}

/**
 * @public
 */
export function stableStringify (value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * @public
 */
export function checkPageLimit (limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw badPageRequest()
  }
}

/**
 * A cursor signature can not cover `options.lookup`: the very same `$lookup.*` filter key may be resolved
 * through a different join on the next page (another target class, domain, or array/single lookup), so the
 * signature stays valid while the result set changes, producing gaps or duplicates between pages.
 * Lookup based filters are therefore not supported by the paged API, the same way as lookup based sorting.
 *
 * @public
 */
export function checkPageQuery<T extends Doc> (query: DocumentQuery<T>): void {
  for (const key of Object.keys(query)) {
    if (key.startsWith('$lookup')) {
      throw badPageRequest()
    }
  }
}

/**
 * Normalizes the requested sort into a deterministic list of cursor fields, appending `_id` as a tie breaker.
 * When `hierarchy` is passed, attribute types not supported by keyset comparison are rejected as well.
 *
 * @public
 */
export function preparePaginationFields<T extends Doc> (
  _class: Ref<Class<T>>,
  sort: FindPageOptions<T>['sort'],
  hierarchy?: Hierarchy
): FindPaginationField[] {
  const fields: FindPaginationField[] = []
  for (const [field, value] of Object.entries(sort ?? {})) {
    if (field.startsWith('$lookup') || (value !== 1 && value !== -1)) {
      throw badPageRequest()
    }
    fields.push({ field, order: value })
  }
  if (!fields.some(({ field }) => field === '_id')) {
    fields.push({ field: '_id', order: 1 })
  }

  for (const { field } of fields) {
    if (field.includes('.') || field.includes('$')) {
      throw badPageRequest()
    }
    if (field === '_id' || hierarchy === undefined) {
      continue
    }
    try {
      const attr = hierarchy.findAttribute(_class, field)
      if (
        attr === undefined ||
        attr.type._class === core.class.ArrOf ||
        attr.type._class === core.class.TypeIdentifier ||
        attr.type._class === core.class.EnumOf
      ) {
        throw badPageRequest()
      }
    } catch (err) {
      if (err instanceof PlatformError) {
        throw err
      }
      throw badPageRequest()
    }
  }
  return fields
}

/**
 * @public
 */
export function calculatePageQueryHash<T extends Doc> (
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  fields: FindPaginationField[],
  showArchived: boolean | undefined
): string {
  return createHash('sha256').update(stableStringify({ _class, query, fields, showArchived })).digest('base64url')
}

/**
 * Validates that a cursor was issued for the very same class, query and sort, and returns its position.
 *
 * @public
 */
export function checkCursorPayload<T extends Doc> (
  payload: PageCursorPayload,
  _class: Ref<Class<T>>,
  queryHash: string,
  fields: FindPaginationField[]
): unknown[] {
  if (
    payload.version !== CURSOR_VERSION ||
    payload.objectClass !== _class ||
    payload.queryHash !== queryHash ||
    stableStringify(payload.fields) !== stableStringify(fields) ||
    !Array.isArray(payload.values) ||
    payload.values.length !== fields.length
  ) {
    throw badPageRequest()
  }
  return payload.values
}

/**
 * @public
 */
export function buildCursorPayload<T extends Doc> (
  _class: Ref<Class<T>>,
  queryHash: string,
  fields: FindPaginationField[],
  lastDoc: T
): PageCursorPayload {
  const doc = lastDoc as unknown as Record<string, unknown>
  return {
    version: CURSOR_VERSION,
    objectClass: _class,
    queryHash,
    fields,
    values: fields.map(({ field }) => doc[field])
  }
}

/**
 * @public
 */
export interface CursorCodec {
  encode: (payload: PageCursorPayload) => string
  decode: (cursor: string) => PageCursorPayload
}

/**
 * @public
 */
export interface FindPageContext {
  // Enables validation of cursor field types.
  hierarchy?: Hierarchy
  // Defaults to a plain, unsigned codec suitable for in-process clients only.
  codec?: CursorCodec
}

/**
 * A codec for in-process clients. Transactor sessions sign the very same payload with a token instead,
 * so cursors are not interchangeable between the two and a foreign cursor is rejected rather than misread.
 *
 * @public
 */
export const plainCursorCodec: CursorCodec = {
  encode: (payload) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
  decode: (cursor) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as PageCursorPayload
}

/**
 * Cursor fields may be excluded by a projection, while their values are required to build the next cursor.
 * Returns a patched projection along with the fields which have to be dropped from the response.
 *
 * @public
 */
export function preparePageProjection<T extends Doc> (
  projection: FindOptions<T>['projection'],
  fields: FindPaginationField[]
): { projection: FindOptions<T>['projection'], added: Set<string> } {
  const added = new Set<string>()
  if (projection === undefined) {
    return { projection, added }
  }
  const patched: Record<string, 0 | 1> = { ...(projection as Record<string, 0 | 1>) }
  const inclusion = Object.values(patched).some((value) => value === 1)
  for (const { field } of fields) {
    if (inclusion && patched[field] !== 1) {
      patched[field] = 1
      added.add(field)
    } else if (!inclusion && patched[field] === 0) {
      Reflect.deleteProperty(patched, field)
      added.add(field)
    }
  }
  return { projection: patched as FindOptions<T>['projection'], added }
}

/**
 * @public
 */
export function dropAddedProjection<T extends Doc> (docs: T[], added: Set<string>): void {
  if (added.size === 0) {
    return
  }
  for (const doc of docs as Array<Record<string, unknown>>) {
    for (const field of added) {
      Reflect.deleteProperty(doc, field)
    }
  }
}

/**
 * Shared keyset pagination flow for in-process clients: validates the request and the cursor, delegates a single
 * fetch to the caller and builds the next cursor out of the last returned document.
 *
 * Transactor sessions follow the very same flow, but sign cursors with a token, so a client can not forge
 * a position it has no access to.
 *
 * @public
 */
export async function findPage<T extends Doc> (
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  options: FindPageOptions<T>,
  fetch: (
    pagination: FindPagination,
    sort: FindOptions<T>['sort'],
    projection: FindOptions<T>['projection'],
    limit: number
  ) => Promise<FindResult<T>>,
  context: FindPageContext = {}
): Promise<FindPageResult<T>> {
  const codec = context.codec ?? plainCursorCodec
  checkPageLimit(options.limit)
  checkPageQuery(query)

  const fields = preparePaginationFields(_class, options.sort, context.hierarchy)
  const queryHash = calculatePageQueryHash(_class, query, fields, options.showArchived)
  let values: unknown[] | undefined
  if (options.cursor !== undefined) {
    let payload: PageCursorPayload
    try {
      payload = codec.decode(options.cursor)
    } catch (err) {
      if (err instanceof PlatformError) {
        throw err
      }
      throw badPageRequest()
    }
    values = checkCursorPayload(payload, _class, queryHash, fields)
  }

  const { projection, added } = preparePageProjection<T>(options.projection, fields)
  const sort = Object.fromEntries(fields.map(({ field, order }) => [field, order])) as FindOptions<T>['sort']

  const result = await fetch({ fields, values }, sort, projection, options.limit + 1)

  const hasMore = result.length > options.limit
  const docs = result.slice(0, options.limit)
  const nextCursor =
    hasMore && docs.length > 0
      ? codec.encode(buildCursorPayload(_class, queryHash, fields, docs[docs.length - 1]))
      : undefined
  dropAddedProjection(docs, added)

  return {
    docs,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    ...(options.total === true ? { total: result.total } : {}),
    ...(result.lookupMap !== undefined ? { lookupMap: result.lookupMap } : {})
  }
}

function compareValues (left: unknown, right: unknown): number {
  if (left === right) {
    return 0
  }
  return (left as any) < (right as any) ? -1 : 1
}

/**
 * Checks whether a document is positioned strictly after the cursor.
 *
 * Nulls follow the ordering used by database adapters: ascending sorts place them first, descending sorts last.
 *
 * @public
 */
export function isAfterCursor<T extends Doc> (doc: T, pagination: FindPagination): boolean {
  const values = pagination.values
  if (values === undefined) {
    return true
  }
  const record = doc as unknown as Record<string, unknown>
  for (let index = 0; index < pagination.fields.length; index++) {
    const { field, order } = pagination.fields[index]
    const value = values[index]
    const docValue = record[field]
    const valueIsNull = value == null
    const docIsNull = docValue == null

    if (valueIsNull && docIsNull) {
      continue
    }
    if (order === 1) {
      // Ascending: nulls come first.
      if (valueIsNull) {
        return true
      }
      if (docIsNull) {
        return false
      }
      const compared = compareValues(docValue, value)
      if (compared === 0) {
        continue
      }
      return compared > 0
    }
    // Descending: nulls come last.
    if (valueIsNull) {
      return false
    }
    if (docIsNull) {
      return true
    }
    const compared = compareValues(docValue, value)
    if (compared === 0) {
      continue
    }
    return compared < 0
  }
  // All cursor fields are equal, the document is the cursor itself.
  return false
}

/**
 * In memory counterpart of the keyset predicate built by database adapters. Used by adapters which
 * can not push the comparison down to a query.
 *
 * @public
 */
export function filterByPagination<T extends Doc> (docs: T[], pagination: FindPagination): T[] {
  if (pagination.values === undefined) {
    return docs
  }
  return docs.filter((doc) => isAfterCursor(doc, pagination))
}

function slicePage<T extends Doc> (all: FindResult<T>, pagination: FindPagination, limit?: number): FindResult<T> {
  const filtered = filterByPagination(all, pagination)
  return toFindResult(limit === undefined ? filtered : filtered.slice(0, limit), all.total, all.lookupMap)
}

/**
 * Applies a cursor position in memory, for storages which can not push the comparison down to a query.
 * A limit is dropped from the passed options and applied to the filtered result instead.
 *
 * @public
 */
export function paginateInMemory<T extends Doc> (
  options: ServerFindOptions<T> | undefined,
  find: (findOptions?: ServerFindOptions<T>) => FindResult<T>
): FindResult<T> {
  const pagination = options?.pagination
  if (pagination?.values === undefined) {
    return find(options)
  }
  const { limit, ...findOptions } = options ?? {}
  return slicePage(find(findOptions), pagination, limit)
}

/**
 * @public
 */
export async function paginateInMemoryAsync<T extends Doc> (
  options: ServerFindOptions<T> | undefined,
  find: (findOptions?: ServerFindOptions<T>) => Promise<FindResult<T>>
): Promise<FindResult<T>> {
  const pagination = options?.pagination
  if (pagination?.values === undefined) {
    return await find(options)
  }
  const { limit, ...findOptions } = options ?? {}
  return slicePage(await find(findOptions), pagination, limit)
}
