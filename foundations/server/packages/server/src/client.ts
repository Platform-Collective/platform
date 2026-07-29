//
// Copyright © 2022 Hardcore Engineering Inc.
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

import type { LoginInfoWithWorkspaces } from '@hcengineering/account-client'
import { createHash } from 'crypto'
import core, {
  generateId,
  TxProcessor,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type Domain,
  type DomainParams,
  type DomainResult,
  type FindOptions,
  type FindPageOptions,
  type FindPageResult,
  type FindResult,
  type LoadModelResponse,
  type MeasureContext,
  type OperationDomain,
  type PermissionsGrant,
  type PersonId,
  type Ref,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  type SessionData,
  type SocialId,
  type Space,
  type Timestamp,
  type Tx,
  type TxCUD,
  type TxResult,
  type WorkspaceDataId,
  type WorkspaceIds
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status, unknownError } from '@hcengineering/platform'
import {
  BackupClientOps,
  createBroadcastEvent,
  estimateDocSize,
  SessionDataImpl,
  type ClientSessionCtx,
  type ConnectionSocket,
  type OneSecondCounters,
  type Pipeline,
  type FindPaginationField,
  type Session,
  type SessionRequest,
  type StatisticsElement
} from '@hcengineering/server-core'
import { decodeToken, generateToken, type Token } from '@hcengineering/server-token'

const useReserveContext = (process.env.USE_RESERVE_CTX ?? 'true') === 'true'
const MAX_PAGE_SIZE = 1000

interface PageCursorPayload {
  version: 1
  objectClass: string
  queryHash: string
  fields: FindPaginationField[]
  values: unknown[]
}

function stableStringify (value: unknown): string {
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

function calculateQueryHash<T extends Doc> (
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  fields: FindPaginationField[],
  showArchived: boolean | undefined
): string {
  return createHash('sha256').update(stableStringify({ _class, query, fields, showArchived })).digest('base64url')
}

function badPageRequest (): PlatformError<Record<string, never>> {
  return new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
}

function normalizePageSort<T extends Doc> (options: FindPageOptions<T>): FindPaginationField[] {
  const fields: FindPaginationField[] = []
  for (const [field, value] of Object.entries(options.sort ?? {})) {
    if (field.startsWith('$lookup') || (value !== 1 && value !== -1)) {
      throw badPageRequest()
    }
    fields.push({ field, order: value })
  }
  if (fields.length === 0) {
    fields.push({ field: '_id', order: 1 })
  } else if (!fields.some(({ field }) => field === '_id')) {
    fields.push({ field: '_id', order: 1 })
  }
  return fields
}

/**
 * @public
 */
export class ClientSession implements Session {
  createTime = Date.now()
  requests = new Map<string, SessionRequest>()
  binaryMode: boolean = false
  useCompression: boolean = false
  sessionId = ''
  lastRequest = Date.now()

  lastPing: number = Date.now()

  total: StatisticsElement = { find: 0, tx: 0 }
  current: StatisticsElement = { find: 0, tx: 0 }
  mins5: StatisticsElement = { find: 0, tx: 0 }
  measures: { id: string, message: string, time: 0 }[] = []

  ops: BackupClientOps | undefined
  opsPipeline: Pipeline | undefined
  isAdmin: boolean

  constructor (
    readonly token: Token,
    readonly workspace: WorkspaceIds,
    readonly account: Account,
    readonly info: LoginInfoWithWorkspaces,
    readonly allowUpload: boolean,
    readonly counter: OneSecondCounters
  ) {
    this.isAdmin = this.token.extra?.admin === 'true'
  }

  getUser (): AccountUuid {
    return this.token.account
  }

  getUserSocialIds (): PersonId[] {
    return this.account.socialIds
  }

  getSocialIds (): SocialId[] {
    return this.info.socialIds
  }

  getRawAccount (): Account {
    return this.account
  }

  isUpgradeClient (): boolean {
    return this.token.extra?.model === 'upgrade'
  }

  getMode (): string {
    return this.token.extra?.mode ?? 'normal'
  }

  updateLast (): void {
    this.lastRequest = Date.now()
  }

  async ping (ctx: ClientSessionCtx): Promise<void> {
    this.lastRequest = Date.now()
    ctx.sendPong()
  }

  async loadModel (ctx: ClientSessionCtx, lastModelTx: Timestamp, hash?: string): Promise<void> {
    try {
      this.includeSessionContext(ctx)
      const result = await this.counter.withCounter('loadModel', 1, () =>
        ctx.pipeline.loadModel(ctx.ctx, lastModelTx, hash)
      )

      await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
        ctx.sendResponse(ctx.requestId, result)
      )
    } catch (err) {
      await ctx.sendError(ctx.requestId, 'Failed to loadModel', unknownError(err))
      ctx.ctx.error('failed to loadModel', { err })
    }
  }

  async loadModelRaw (ctx: ClientSessionCtx, lastModelTx: Timestamp, hash?: string): Promise<LoadModelResponse | Tx[]> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.includeSessionContext(ctx)
    return await ctx.ctx.with('load-model', {}, (_ctx) => ctx.pipeline.loadModel(_ctx, lastModelTx, hash))
  }

  private getPermissionsGrant (): PermissionsGrant | undefined {
    if (this.token.grant == null) {
      return
    }

    return {
      spaces: this.token.grant?.spaces as Ref<Space>[] | undefined,
      grantedBy: this.token.grant?.grantedBy
    }
  }

  includeSessionContext (ctx: ClientSessionCtx): void {
    const dataId = this.workspace.dataId ?? (this.workspace.uuid as unknown as WorkspaceDataId)
    const contextData = new SessionDataImpl(
      this.account,
      this.sessionId,
      this.isAdmin,
      undefined,
      {
        ...this.workspace,
        dataId
      },
      false,
      undefined,
      undefined,
      ctx.pipeline.context.modelDb,
      ctx.socialStringsToUsers,
      this.token.extra?.service ?? '🤦‍♂️user',
      this.getPermissionsGrant()
    )
    ctx.ctx.contextData = contextData
  }

  findAllRaw<T extends Doc>(
    ctx: ClientSessionCtx,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<FindResult<T>> {
    this.lastRequest = Date.now()
    this.total.find++
    this.current.find++
    this.includeSessionContext(ctx)
    return ctx.pipeline.findAll(ctx.ctx, _class, query, options)
  }

  estimateSize (doc: any): number {
    return Math.round((estimateDocSize(doc) * 10) / (1024 * 1024)) / 10
  }

  async findAll<T extends Doc>(
    ctx: ClientSessionCtx,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<void> {
    const domain = ctx.pipeline.context.hierarchy.findDomain(_class) ?? ''
    if (domain === '') {
      // Unknown domain, send error
      await ctx.sendError(
        ctx.requestId,
        'Invalid class name is passed. Failed to findAll.',
        new Error('Unknown domain')
      )
      return
    }
    try {
      const result = await this.counter.withCounter('find-' + domain, 1, () =>
        this.findAllRaw(ctx, _class, query, options)
      )

      await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
        ctx.sendResponse(ctx.requestId, result)
      )
    } catch (err) {
      await ctx.sendError(ctx.requestId, 'Failed to findAll', unknownError(err))
      ctx.ctx.error('failed to findAll', { err })
    }
  }

  async findAllPageRaw<T extends Doc>(
    ctx: ClientSessionCtx,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options: FindPageOptions<T>
  ): Promise<FindPageResult<T>> {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_PAGE_SIZE) {
      throw badPageRequest()
    }

    this.lastRequest = Date.now()
    this.total.find++
    this.current.find++
    this.includeSessionContext(ctx)

    const fields = normalizePageSort(options)
    for (const { field } of fields) {
      if (field.includes('.') || field.includes('$')) {
        throw badPageRequest()
      }
      if (field !== '_id') {
        try {
          const attr = ctx.pipeline.context.hierarchy.findAttribute(_class, field)
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
    }
    const queryHash = calculateQueryHash(_class, query, fields, options.showArchived)
    let values: unknown[] | undefined
    if (options.cursor !== undefined) {
      try {
        const decoded = decodeToken(options.cursor)
        const payload = JSON.parse(decoded.extra?.cursor ?? '') as PageCursorPayload
        if (
          decoded.account !== this.account.uuid ||
          decoded.workspace !== this.workspace.uuid ||
          payload.version !== 1 ||
          payload.objectClass !== _class ||
          payload.queryHash !== queryHash ||
          stableStringify(payload.fields) !== stableStringify(fields) ||
          !Array.isArray(payload.values) ||
          payload.values.length !== fields.length
        ) {
          throw badPageRequest()
        }
        values = payload.values
      } catch (err) {
        if (err instanceof PlatformError) {
          throw err
        }
        throw badPageRequest()
      }
    }

    const originalProjection = options.projection
    const projection = originalProjection === undefined ? undefined : { ...originalProjection }
    const addedProjectionFields = new Set<string>()
    if (projection !== undefined) {
      const inclusionProjection = Object.values(projection).some((value) => value === 1)
      for (const { field } of fields) {
        const projectionRecord = projection as Record<string, 0 | 1>
        if (inclusionProjection && projectionRecord[field] !== 1) {
          projectionRecord[field] = 1
          addedProjectionFields.add(field)
        } else if (!inclusionProjection && projectionRecord[field] === 0) {
          Reflect.deleteProperty(projectionRecord, field)
          addedProjectionFields.add(field)
        }
      }
    }

    const sort = Object.fromEntries(fields.map(({ field, order }) => [field, order])) as FindOptions<T>['sort']
    const findOptions = { ...options }
    delete findOptions.cursor
    const result = await ctx.pipeline.findAll(ctx.ctx, _class, query, {
      ...findOptions,
      limit: options.limit + 1,
      sort,
      projection,
      pagination: { fields, values }
    })

    const hasMore = result.length > options.limit
    const docs = result.slice(0, options.limit)
    let nextCursor: string | undefined
    if (hasMore && docs.length > 0) {
      const last = docs[docs.length - 1] as Record<string, unknown>
      const payload: PageCursorPayload = {
        version: 1,
        objectClass: _class,
        queryHash,
        fields,
        values: fields.map(({ field }) => last[field])
      }
      nextCursor = generateToken(this.account.uuid, this.workspace.uuid, { cursor: JSON.stringify(payload) })
    }

    if (addedProjectionFields.size > 0) {
      for (const doc of docs as Array<Record<string, unknown>>) {
        for (const field of addedProjectionFields) {
          Reflect.deleteProperty(doc, field)
        }
      }
    }

    return {
      docs,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
      ...(options.total === true ? { total: result.total } : {}),
      ...(result.lookupMap !== undefined ? { lookupMap: result.lookupMap } : {})
    }
  }

  async findAllPage<T extends Doc>(
    ctx: ClientSessionCtx,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options: FindPageOptions<T>
  ): Promise<void> {
    const domain = ctx.pipeline.context.hierarchy.findDomain(_class) ?? ''
    if (domain === '') {
      await ctx.sendError(
        ctx.requestId,
        'Invalid class name is passed. Failed to findAllPage.',
        new Error('Unknown domain')
      )
      return
    }
    try {
      const result = await this.counter.withCounter('find-page-' + domain, 1, () =>
        this.findAllPageRaw(ctx, _class, query, options)
      )
      await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
        ctx.sendResponse(ctx.requestId, result)
      )
    } catch (err) {
      await ctx.sendError(
        ctx.requestId,
        'Failed to findAllPage',
        err instanceof PlatformError ? err.status : unknownError(err)
      )
      ctx.ctx.error('failed to findAllPage', { err })
    }
  }

  async searchFulltext (ctx: ClientSessionCtx, query: SearchQuery, options: SearchOptions): Promise<void> {
    try {
      this.lastRequest = Date.now()
      this.includeSessionContext(ctx)
      const result = await this.counter.withCounter('fulltext', 1, () =>
        ctx.pipeline.searchFulltext(ctx.ctx, query, options)
      )
      await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
        ctx.sendResponse(ctx.requestId, result)
      )
    } catch (err) {
      await ctx.sendError(ctx.requestId, 'Failed to searchFulltext', unknownError(err))
      ctx.ctx.error('failed to searchFulltext', { err })
    }
  }

  async searchFulltextRaw (ctx: ClientSessionCtx, query: SearchQuery, options: SearchOptions): Promise<SearchResult> {
    this.lastRequest = Date.now()
    this.includeSessionContext(ctx)
    return await ctx.pipeline.searchFulltext(ctx.ctx, query, options)
  }

  async txRaw (
    ctx: ClientSessionCtx,
    tx: Tx
  ): Promise<{
      result: TxResult
      broadcastPromise: Promise<void>
      asyncsPromise: Promise<void> | undefined
    }> {
    this.lastRequest = Date.now()
    this.total.tx++
    this.current.tx++
    this.includeSessionContext(ctx)

    let cid = 'client_' + generateId()
    ctx.ctx.id = cid
    let onEnd = useReserveContext ? ctx.pipeline.context.adapterManager?.reserveContext?.(cid) : undefined
    let result: TxResult
    try {
      result = await ctx.pipeline.tx(ctx.ctx, [tx])
    } finally {
      onEnd?.()
    }
    // Send result immideately
    await ctx.sendResponse(ctx.requestId, result)

    // We need to broadcast all collected transactions
    const broadcastPromise = ctx.pipeline.handleBroadcast(ctx.ctx)

    // ok we could perform async requests if any
    const asyncs = (ctx.ctx.contextData as SessionData).asyncRequests ?? []
    let asyncsPromise: Promise<void> | undefined
    if (asyncs.length > 0) {
      cid = 'client_async_' + generateId()
      ctx.ctx.id = cid
      onEnd = useReserveContext ? ctx.pipeline.context.adapterManager?.reserveContext?.(cid) : undefined
      const handleAyncs = async (): Promise<void> => {
        try {
          for (const r of asyncs) {
            await r(ctx.ctx, cid)
          }
        } finally {
          onEnd?.()
        }
      }
      asyncsPromise = handleAyncs()
    }

    return { result, broadcastPromise, asyncsPromise }
  }

  async tx (ctx: ClientSessionCtx, tx: Tx): Promise<void> {
    const domain =
      ctx.pipeline.context.hierarchy.findDomain(
        TxProcessor.isExtendsCUD(tx._class) ? (tx as TxCUD<Doc>).objectClass : tx._class
      ) ?? ''
    await this.counter.withCounter('tx-' + domain, 1, async () => {
      try {
        const { broadcastPromise, asyncsPromise } = await this.txRaw(ctx, tx)
        await broadcastPromise
        if (asyncsPromise !== undefined) {
          await asyncsPromise
        }
      } catch (err) {
        await ctx.sendError(ctx.requestId, 'Failed to tx', unknownError(err))
        ctx.ctx.error('failed to tx', { err })
      }
    })
  }

  broadcast (ctx: MeasureContext, socket: ConnectionSocket, tx: Tx[]): void {
    if (this.tx.length > 10000) {
      const classes = new Set<Ref<Class<Doc>>>()
      for (const dtx of tx) {
        if (TxProcessor.isExtendsCUD(dtx._class)) {
          classes.add((dtx as TxCUD<Doc>).objectClass)
          const attachedToClass = (dtx as TxCUD<Doc>).attachedToClass
          if (attachedToClass !== undefined) {
            classes.add(attachedToClass)
          }
        }
      }
      const bevent = createBroadcastEvent(Array.from(classes))
      void socket.send(
        ctx,
        {
          result: [bevent]
        },
        this.binaryMode,
        this.useCompression
      )
    } else {
      void socket.send(ctx, { result: tx }, this.binaryMode, this.useCompression)
    }
  }

  getOps (pipeline: Pipeline): BackupClientOps {
    if (this.ops === undefined || this.opsPipeline !== pipeline) {
      if (pipeline.context.lowLevelStorage === undefined) {
        throw new PlatformError(unknownError('Low level storage is not available'))
      }
      this.ops = new BackupClientOps(pipeline.context.lowLevelStorage)
      this.opsPipeline = pipeline
    }
    return this.ops
  }

  async loadChunk (ctx: ClientSessionCtx, domain: Domain, idx?: number): Promise<void> {
    this.lastRequest = Date.now()
    try {
      const result = await this.getOps(ctx.pipeline).loadChunk(ctx.ctx, domain, idx)
      await ctx.sendResponse(ctx.requestId, result)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to upload', unknownError(err))
      ctx.ctx.error('failed to loadChunk', { domain, err })
    }
  }

  async getDomainHash (ctx: ClientSessionCtx, domain: Domain): Promise<void> {
    this.lastRequest = Date.now()
    try {
      const result = await this.getOps(ctx.pipeline).getDomainHash(ctx.ctx, domain)
      await ctx.sendResponse(ctx.requestId, result)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to upload', unknownError(err))
      ctx.ctx.error('failed to getDomainHash', { domain, err })
    }
  }

  async closeChunk (ctx: ClientSessionCtx, idx: number): Promise<void> {
    try {
      this.lastRequest = Date.now()
      await this.getOps(ctx.pipeline).closeChunk(ctx.ctx, idx)
      await ctx.sendResponse(ctx.requestId, {})
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to closeChunk', unknownError(err))
      ctx.ctx.error('failed to closeChunk', { err })
    }
  }

  async loadDocs (ctx: ClientSessionCtx, domain: Domain, docs: Ref<Doc>[]): Promise<void> {
    this.lastRequest = Date.now()
    try {
      const result = await this.getOps(ctx.pipeline).loadDocs(ctx.ctx, domain, docs)
      await ctx.sendResponse(ctx.requestId, result)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to loadDocs', unknownError(err))
      ctx.ctx.error('failed to loadDocs', { domain, err })
    }
  }

  async upload (ctx: ClientSessionCtx, domain: Domain, docs: Doc[]): Promise<void> {
    if (!this.allowUpload) {
      await ctx.sendResponse(ctx.requestId, { error: 'Upload not allowed' })
    }
    this.lastRequest = Date.now()
    try {
      await this.getOps(ctx.pipeline).upload(ctx.ctx, domain, docs)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to upload', unknownError(err))
      ctx.ctx.error('failed to loadDocs', { domain, err })
      return
    }
    await ctx.sendResponse(ctx.requestId, {})
  }

  async clean (ctx: ClientSessionCtx, domain: Domain, docs: Ref<Doc>[]): Promise<void> {
    if (!this.allowUpload) {
      await ctx.sendResponse(ctx.requestId, { error: 'Clean not allowed' })
    }
    this.lastRequest = Date.now()
    try {
      await this.getOps(ctx.pipeline).clean(ctx.ctx, domain, docs)
    } catch (err: any) {
      await ctx.sendError(ctx.requestId, 'Failed to clean', unknownError(err))
      ctx.ctx.error('failed to clean', { domain, err })
      return
    }
    await ctx.sendResponse(ctx.requestId, {})
  }

  async domainRequest (ctx: ClientSessionCtx, domain: OperationDomain, params: DomainParams): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await this.counter.withCounter('dr-' + domain, 1, async () => {
      try {
        const { asyncsPromise, broadcastPromise } = await this.domainRequestRaw(ctx, domain, params)

        await broadcastPromise

        if (asyncsPromise !== undefined) {
          await asyncsPromise
        }
      } catch (err) {
        await ctx.sendError(ctx.requestId, 'Failed to domainRequest', unknownError(err))
        ctx.ctx.error('failed to domainRequest', { err })
      }
    })
  }

  async domainRequestRaw (
    ctx: ClientSessionCtx,
    domain: OperationDomain,
    params: DomainParams
  ): Promise<{
      result: DomainResult
      broadcastPromise: Promise<void>
      asyncsPromise: Promise<void> | undefined
    }> {
    this.lastRequest = Date.now()
    this.total.find++
    this.current.find++
    this.includeSessionContext(ctx)

    const result: DomainResult = await ctx.pipeline.domainRequest(ctx.ctx, domain, params)

    await this.counter.withCounter('clientSendMemory', this.estimateSize(result), () =>
      ctx.sendResponse(ctx.requestId, result)
    )
    // We need to broadcast all collected transactions
    const broadcastPromise = ctx.pipeline.handleBroadcast(ctx.ctx)

    // ok we could perform async requests if any
    const asyncs = (ctx.ctx.contextData as SessionData).asyncRequests ?? []
    let asyncsPromise: Promise<void> | undefined
    if (asyncs.length > 0) {
      const handleAyncs = async (): Promise<void> => {
        // Make sure the broadcast is complete before we start the asyncs
        await broadcastPromise
        ctx.ctx.contextData.broadcast.queue = []
        ctx.ctx.contextData.broadcast.txes = []
        ctx.ctx.contextData.broadcast.sessions = {}
        try {
          for (const r of asyncs) {
            await r(ctx.ctx)
          }
        } catch (err: any) {
          ctx.ctx.error('failed to handleAsyncs', { err })
        }
      }
      asyncsPromise = handleAyncs().then(async () => {
        await ctx.pipeline?.handleBroadcast(ctx.ctx)
      })
    }

    return { result, asyncsPromise, broadcastPromise }
  }
}
