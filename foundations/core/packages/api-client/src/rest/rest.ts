//
// Copyright © 2025 Hardcore Engineering Inc.
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

import {
  type Account,
  type AttachedData,
  type AttachedDoc,
  buildModel,
  type Class,
  concatLink,
  type Data,
  type Doc,
  type DocumentUpdate,
  type DocumentQuery,
  type DomainParams,
  type DomainRequestOptions,
  type DomainResult,
  type FindOptions,
  type FindPageOptions,
  type FindPageResult,
  type FindResult,
  type IterateOptions,
  Hierarchy,
  MeasureMetricsContext,
  type Mixin,
  type MixinData,
  type MixinUpdate,
  ModelDb,
  OperationDomain,
  PersonId,
  PersonUuid,
  type Ref,
  type Space,
  type Timestamp,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  SocialIdType,
  type Tx,
  type TxResult,
  type WithLookup
} from '@hcengineering/core'
import { PlatformError, type Status, unknownError } from '@hcengineering/platform'

import { AuthOptions } from '../types'
import { getWorkspaceToken } from '../utils'
import type { EnsurePersonOptions, RestClient } from './types'
import { extractJson, withRetry } from './utils'

export function createRestClient (endpoint: string, workspaceId: string, token: string): RestClient {
  return new RestClientImpl(endpoint, workspaceId, token)
}

export async function connectRest (url: string, options: AuthOptions): Promise<RestClient> {
  const { endpoint, token, workspaceId } = await getWorkspaceToken(url, options)
  return createRestClient(endpoint, workspaceId, token)
}

const rateLimitError = 'rate-limit'

function isRLE (err: any): boolean {
  return err.message === rateLimitError
}

export class RestClientImpl implements RestClient {
  endpoint: string

  slowDownTimer = 0
  currentRateLimit: { remaining: number, limit: number } = { remaining: 1000, limit: 1000 }

  remaining: number = 1000
  limit: number = 1000
  constructor (
    endpoint: string,
    readonly workspace: string,
    readonly token: string
  ) {
    this.endpoint = endpoint.replace('ws', 'http')
  }

  jsonHeaders (): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + this.token,
      'accept-encoding': 'snappy, gzip'
    }
  }

  requestInit (): RequestInit {
    return {
      method: 'GET',
      keepalive: true,
      headers: this.jsonHeaders()
    }
  }

  async findAll<T extends Doc>(
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<FindResult<T>> {
    const params = new URLSearchParams()
    params.append('class', _class)
    if (query !== undefined && Object.keys(query).length > 0) {
      params.append('query', JSON.stringify(query))
    }
    if (options !== undefined && Object.keys(options).length > 0) {
      params.append('options', JSON.stringify(options))
    }
    const requestUrl = concatLink(this.endpoint, `/api/v1/find-all/${this.workspace}?${params.toString()}`)
    const result = await withRetry<FindResult<T> & { error?: Status }>(async () => {
      const response = await fetch(requestUrl, this.requestInit())
      if (!response.ok) {
        await this.checkRateLimits(response)
        throw new PlatformError(unknownError(response.statusText))
      }
      this.updateRateLimit(response)
      return await extractJson<FindResult<T>>(response)
    }, isRLE)

    if (result.error !== undefined) {
      throw new PlatformError(result.error)
    }

    if (result.lookupMap !== undefined) {
      // We need to extract lookup map to document lookups
      for (const d of result) {
        if (d.$lookup !== undefined) {
          for (const [k, v] of Object.entries(d.$lookup)) {
            if (!Array.isArray(v)) {
              ;(d as any).$lookup[k] = result.lookupMap[v]
            } else {
              ;(d as any).$lookup[k] = v.map((it) => result.lookupMap?.[it])
            }
          }
        }
      }
      delete result.lookupMap
    }

    // We need to revert deleted query simple values.
    // We need to get rid of simple query parameters matched in documents
    for (const doc of result) {
      if (doc._class == null) {
        doc._class = _class
      }
      for (const [k, v] of Object.entries(query)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          if ((doc as any)[k] == null) {
            ;(doc as any)[k] = v
          }
        }
      }
    }

    return result
  }

  async findAllPage<T extends Doc>(
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options: FindPageOptions<T>
  ): Promise<FindPageResult<T>> {
    const requestUrl = concatLink(this.endpoint, `/api/v1/find-page/${this.workspace}`)
    const result = await withRetry<FindPageResult<T> & { error?: Status }>(async () => {
      const response = await fetch(requestUrl, {
        method: 'POST',
        keepalive: true,
        headers: this.jsonHeaders(),
        body: JSON.stringify({ _class, query, options })
      })
      if (!response.ok) {
        await this.checkRateLimits(response)
        throw new PlatformError(unknownError(response.statusText))
      }
      this.updateRateLimit(response)
      return await extractJson<FindPageResult<T>>(response)
    }, isRLE)

    if (result.error !== undefined) {
      throw new PlatformError(result.error)
    }
    if (result.lookupMap !== undefined) {
      for (const doc of result.docs) {
        if (doc.$lookup !== undefined) {
          const lookup = doc.$lookup as Record<string, unknown>
          for (const [key, value] of Object.entries(lookup)) {
            if (Array.isArray(value)) {
              lookup[key] = value.map((item) => result.lookupMap?.[item])
            } else {
              lookup[key] = result.lookupMap[value as string]
            }
          }
        }
      }
      delete result.lookupMap
    }
    for (const doc of result.docs) {
      const docRecord = doc as Record<string, unknown>
      for (const [key, value] of Object.entries(query)) {
        if (
          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') &&
          docRecord[key] == null
        ) {
          docRecord[key] = value
        }
      }
      if (doc._class == null) {
        doc._class = _class
      }
    }
    return result
  }

  async * iterateAll<T extends Doc>(
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: IterateOptions<T>
  ): AsyncIterable<WithLookup<T>> {
    let cursor: string | undefined
    do {
      const page = await this.findAllPage(_class, query, {
        ...options,
        limit: options?.limit ?? 500,
        cursor
      })
      for (const doc of page.docs) {
        yield doc
      }
      cursor = page.nextCursor
    } while (cursor !== undefined)
  }

  private async checkRate (): Promise<void> {
    if (this.currentRateLimit.remaining < this.currentRateLimit.limit / 3) {
      if (this.slowDownTimer < 50) {
        this.slowDownTimer += 50
      }
      this.slowDownTimer++
    } else if (this.slowDownTimer > 0) {
      this.slowDownTimer--
    }
    if (this.slowDownTimer > 0) {
      // We need to wait a bit to avoid ban.
      await new Promise((resolve) => setTimeout(resolve, this.slowDownTimer))
    }
  }

  private updateRateLimit (response: Response): void {
    const rateLimitLimit: number = parseInt(response.headers.get('X-RateLimit-Limit') ?? '100')
    const remaining: number = parseInt(response.headers.get('X-RateLimit-Remaining') ?? '100')
    this.currentRateLimit = { remaining, limit: rateLimitLimit }
  }

  private async checkRateLimits (response: Response): Promise<void> {
    if (response.status === 429) {
      // Extract rate limit information from headers
      const retryAfter = response.headers.get('Retry-After')
      const retryAfterMS = response.headers.get('Retry-After-ms')
      const rateLimitReset = response.headers.get('X-RateLimit-Reset')

      this.updateRateLimit(response)
      const waitTime =
        (retryAfterMS != null ? parseInt(retryAfterMS) : undefined) ??
        (retryAfter != null
          ? parseInt(retryAfter) * 1000
          : rateLimitReset != null
            ? new Date(parseInt(rateLimitReset)).getTime() - Date.now()
            : 1000) // Default to 1 seconds if no headers are provided
      await new Promise((resolve) => setTimeout(resolve, waitTime))
      throw new Error(rateLimitError)
    }
  }

  async getAccount (): Promise<Account> {
    const requestUrl = concatLink(this.endpoint, `/api/v1/account/${this.workspace}`)
    await this.checkRate()
    const result = await withRetry<Account & { error?: Status }>(async () => {
      const response = await fetch(requestUrl, this.requestInit())
      if (!response.ok) {
        await this.checkRateLimits(response)
        throw new PlatformError(unknownError(response.statusText))
      }
      this.updateRateLimit(response)
      return await extractJson<Account>(response)
    })
    if (result.error !== undefined) {
      throw new PlatformError(result.error)
    }
    return result
  }

  async getModel (full: boolean = false): Promise<{ hierarchy: Hierarchy, model: ModelDb }> {
    const requestUrl = new URL(concatLink(this.endpoint, `/api/v1/load-model/${this.workspace}`))
    if (full) {
      requestUrl.searchParams.append('full', 'true')
    }
    await this.checkRate()
    const result = await withRetry<{ hierarchy: Hierarchy, model: ModelDb, error?: Status }>(async () => {
      const response = await fetch(requestUrl, this.requestInit())
      if (!response.ok) {
        await this.checkRateLimits(response)
        throw new PlatformError(unknownError(response.statusText))
      }
      this.updateRateLimit(response)

      const modelResponse: Tx[] = await extractJson<Tx[]>(response)

      const hierarchy = new Hierarchy()
      const model = new ModelDb(hierarchy)

      const ctx = new MeasureMetricsContext('loadModel', {})
      buildModel(ctx, modelResponse, undefined, hierarchy, model)

      return { hierarchy, model }
    }, isRLE)
    if (result.error !== undefined) {
      throw new PlatformError(result.error)
    }
    return result
  }

  async findOne<T extends Doc>(
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<WithLookup<T> | undefined> {
    return (await this.findAll(_class, query, { ...options, limit: 1 })).shift()
  }

  async tx (tx: Tx): Promise<TxResult> {
    const requestUrl = concatLink(this.endpoint, `/api/v1/tx/${this.workspace}`)
    await this.checkRate()
    const result = await withRetry<TxResult & { error?: Status }>(async () => {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: this.jsonHeaders(),
        keepalive: true,
        body: JSON.stringify(tx)
      })
      if (!response.ok) {
        await this.checkRateLimits(response)
        throw new PlatformError(unknownError(response.statusText))
      }
      this.updateRateLimit(response)
      return await extractJson<TxResult>(response)
    }, isRLE)
    if (result.error !== undefined) {
      throw new PlatformError(result.error)
    }
    return result
  }

  async searchFulltext (query: SearchQuery, options: SearchOptions): Promise<SearchResult> {
    const result = await withRetry<SearchResult & { error?: Status }>(async () => {
      const params = new URLSearchParams()
      params.append('query', query.query)
      if (query.classes != null && Object.keys(query.classes).length > 0) {
        params.append('classes', JSON.stringify(query.classes))
      }
      if (query.spaces != null && Object.keys(query.spaces).length > 0) {
        params.append('spaces', JSON.stringify(query.spaces))
      }
      if (options.limit != null) {
        params.append('limit', `${options.limit}`)
      }
      const requestUrl = concatLink(this.endpoint, `/api/v1/search-fulltext/${this.workspace}?${params.toString()}`)
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: this.jsonHeaders(),
        keepalive: true
      })
      if (!response.ok) {
        await this.checkRateLimits(response)
        throw new PlatformError(unknownError(response.statusText))
      }
      this.updateRateLimit(response)
      return await extractJson<TxResult>(response)
    })
    if (result.error !== undefined) {
      throw new PlatformError(result.error)
    }
    return result
  }

  async domainRequest<T>(
    domain: OperationDomain,
    params: DomainParams,
    options?: DomainRequestOptions
  ): Promise<DomainResult<T>> {
    const requestUrl = concatLink(this.endpoint, `/api/v1/request/${domain}/${this.workspace}`)

    await this.checkRate()
    return await withRetry(async () => {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: this.jsonHeaders(),
        keepalive: true,
        body: JSON.stringify(params)
      })
      if (!response.ok) {
        await this.checkRateLimits(response)
        throw new PlatformError(unknownError(response.statusText))
      }
      this.updateRateLimit(response)
      const value = await extractJson<T>(response)
      return { domain, value }
    }, isRLE)
  }

  async ensurePerson (
    socialType: SocialIdType,
    socialValue: string,
    firstName: string,
    lastName: string,
    options?: EnsurePersonOptions
  ): Promise<{ uuid: PersonUuid, socialId: PersonId, localPerson: string }> {
    const requestUrl = concatLink(this.endpoint, `/api/v1/ensure-person/${this.workspace}`)
    await this.checkRate()
    const result = await withRetry(async () => {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: this.jsonHeaders(),
        keepalive: true,
        body: JSON.stringify({
          socialType,
          socialValue,
          firstName,
          lastName,
          options
        })
      })
      if (!response.ok) {
        await this.checkRateLimits(response)
        throw new PlatformError(unknownError(response.statusText))
      }
      this.updateRateLimit(response)
      return await extractJson<{ uuid: PersonUuid, socialId: PersonId, localPerson: string }>(response)
    }, isRLE)
    if (result.error !== undefined) {
      throw new PlatformError(result.error)
    }
    return result
  }

  private async v1op<T extends Doc, P>(op: string, data: any): Promise<P> {
    const requestUrl = concatLink(this.endpoint, `/api/v1/${op}/${this.workspace}`)
    await this.checkRate()
    const result = await withRetry<{ result?: Ref<T>, error?: Status }>(async () => {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: this.jsonHeaders(),
        keepalive: true,
        body: JSON.stringify(data)
      })
      if (!response.ok) {
        await this.checkRateLimits(response)
        throw new PlatformError(unknownError(response.statusText))
      }
      this.updateRateLimit(response)
      return await extractJson<TxResult>(response)
    }, isRLE)
    if (result.error !== undefined) {
      throw new PlatformError(result.error)
    }
    return result as P
  }

  createDoc<T extends Doc>(
    _class: Ref<Class<T>>,
    space: Ref<Space>,
    attributes: Data<T>,
    id?: Ref<T>,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ): Promise<Ref<T>> {
    return this.v1op('create', {
      _class,
      space,
      attributes,
      id,
      modifiedBy,
      modifiedOn
    })
  }

  addCollection<T extends Doc, P extends AttachedDoc>(
    _class: Ref<Class<P>>,
    space: Ref<Space>,
    attachedTo: Ref<T>,
    attachedToClass: Ref<Class<T>>,
    collection: Extract<keyof T, string> | string,
    attributes: AttachedData<P>,
    id?: Ref<P>,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ): Promise<Ref<P>> {
    return this.v1op('addCollection', {
      _class,
      space,
      attachedTo,
      attachedToClass,
      collection,
      attributes,
      id,
      modifiedBy,
      modifiedOn
    })
  }

  update<T extends Doc>(
    doc: T,
    update: DocumentUpdate<T>,
    retrieve?: boolean,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ): Promise<TxResult> {
    const req = {
      _class: doc._class,
      _id: doc._id,
      space: doc.space,
      update,
      retrieve,
      modifiedBy,
      modifiedOn
    }
    const adoc = doc as any as AttachedDoc
    if (adoc.attachedTo !== undefined && adoc.attachedToClass !== undefined && adoc.collection !== undefined) {
      ;(req as any as AttachedDoc).attachedTo = adoc.attachedTo
      ;(req as any as AttachedDoc).attachedToClass = adoc.attachedToClass
      ;(req as any as AttachedDoc).collection = adoc.collection
    }
    return this.v1op('update', req)
  }

  remove<T extends Doc>(doc: T, modifiedOn?: Timestamp, modifiedBy?: PersonId): Promise<TxResult> {
    const req = {
      _class: doc._class,
      _id: doc._id,
      space: doc.space,
      modifiedBy,
      modifiedOn
    }
    const adoc = doc as any as AttachedDoc
    if (adoc.attachedTo !== undefined && adoc.attachedToClass !== undefined && adoc.collection !== undefined) {
      ;(req as any as AttachedDoc).attachedTo = adoc.attachedTo
      ;(req as any as AttachedDoc).attachedToClass = adoc.attachedToClass
      ;(req as any as AttachedDoc).collection = adoc.collection
    }
    return this.v1op('remove', req)
  }

  createMixin<D extends Doc, M extends D>(
    objectId: Ref<D>,
    objectClass: Ref<Class<D>>,
    objectSpace: Ref<Space>,
    mixin: Ref<Mixin<M>>,
    attributes: MixinData<D, M>,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ): Promise<TxResult> {
    return this.v1op('createMixin', {
      objectId,
      objectClass,
      objectSpace,
      mixin,
      attributes,
      modifiedOn,
      modifiedBy
    })
  }

  updateMixin<D extends Doc, M extends D>(
    objectId: Ref<D>,
    objectClass: Ref<Class<D>>,
    objectSpace: Ref<Space>,
    mixin: Ref<Mixin<M>>,
    attributes: MixinUpdate<D, M>,
    modifiedOn?: Timestamp,
    modifiedBy?: PersonId
  ): Promise<TxResult> {
    return this.v1op('updateMixin', {
      objectId,
      objectClass,
      objectSpace,
      mixin,
      attributes,
      modifiedOn,
      modifiedBy
    })
  }
}
