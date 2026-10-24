//
// Copyright © 2023 Hardcore Engineering Inc.
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
  type Account,
  AccountRole,
  type AccountUuid,
  type AttachedDoc,
  type Class,
  clone,
  type Collaborator,
  type Doc,
  type DocumentQuery,
  type Domain,
  DOMAIN_MODEL,
  type FindResult,
  generateId,
  getClassCollaborators,
  type LookupData,
  type MeasureContext,
  type ObjQueryType,
  type Ref,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  type SessionData,
  shouldShowArchived,
  type Space,
  systemAccountUuid,
  toFindResult,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  TxProcessor,
  type TxUpdateDoc,
  type TxWorkspaceEvent,
  WorkspaceEvent
} from '@hcengineering/core'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import { isOwner, isSystem } from './utils'
import { getUpdatedAttributes } from './spacePermissions'

type SpaceWithMembers = Pick<Space, '_id' | 'members' | 'private' | '_class' | 'archived'>

/**
 * @public
 */
export class SpaceSecurityMiddleware extends BaseMiddleware implements Middleware {
  private allowedSpaces: Record<AccountUuid, Ref<Space>[]> = {}
  private readonly spacesMap = new Map<Ref<Space>, SpaceWithMembers>()
  private readonly updateTails = new Map<Ref<Space>, Promise<void>>()
  private readonly privateSpaces = new Set<Ref<Space>>()
  private readonly _domainSpaces = new Map<string, Set<Ref<Space>> | Promise<Set<Ref<Space>>>>()
  private readonly publicSpaces = new Set<Ref<Space>>()
  private readonly systemSpaces = new Set<Ref<Space>>()

  wasInit: Promise<void> | boolean = false

  private readonly mainSpaces = new Set([
    core.space.Configuration,
    core.space.DerivedTx,
    core.space.Model,
    core.space.Space,
    core.space.Workspace,
    core.space.Tx
  ])

  private constructor (
    private readonly skipFindCheck: boolean,
    context: PipelineContext,
    next?: Middleware
  ) {
    super(context, next)
  }

  static async create (
    skipFindCheck: boolean,
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<SpaceSecurityMiddleware> {
    return new SpaceSecurityMiddleware(skipFindCheck, context, next)
  }

  private resyncDomains (): void {
    this.wasInit = false
  }

  private addMemberSpace (member: AccountUuid, space: Ref<Space>): void {
    const arr = this.allowedSpaces[member] ?? []
    if (!arr.includes(space)) arr.push(space)
    this.allowedSpaces[member] = arr
  }

  private addSpace (space: SpaceWithMembers): void {
    this.spacesMap.set(space._id, space)
    if (space.private) {
      this.privateSpaces.add(space._id)
    } else {
      this.publicSpaces.add(space._id)
    }
    for (const member of space.members) {
      this.addMemberSpace(member, space._id)
    }
  }

  async init (ctx: MeasureContext): Promise<void> {
    if (this.wasInit === true) {
      return
    }
    if (this.wasInit === false) {
      this.wasInit = (async () => {
        await ctx.with('init-space-security', {}, async (ctx) => {
          ctx.contextData = undefined
          const spaces: SpaceWithMembers[] =
            (await this.next?.findAll(
              ctx,
              core.class.Space,
              {},
              {
                projection: {
                  archived: 1,
                  private: 1,
                  _class: 1,
                  _id: 1,
                  members: 1
                }
              }
            )) ?? []
          this.allowedSpaces = {}
          this.privateSpaces.clear()
          this.spacesMap.clear()
          this.publicSpaces.clear()
          this.systemSpaces.clear()
          for (const space of spaces) {
            if (space._class === core.class.SystemSpace) {
              this.systemSpaces.add(space._id)
            } else {
              this.addSpace(space)
            }
          }
        })
      })()
    }
    if (this.wasInit instanceof Promise) {
      try {
        await this.wasInit
        this.wasInit = true
      } catch (err) {
        this.wasInit = false
        throw err
      }
    }
  }

  private removeMemberSpace (member: AccountUuid, space: Ref<Space>): void {
    const arr = this.allowedSpaces[member]
    if (arr !== undefined) {
      this.allowedSpaces[member] = arr.filter((id) => id !== space)
    }
  }

  private removeSpace (_id: Ref<Space>): void {
    const space = this.spacesMap.get(_id)
    if (space !== undefined) {
      for (const member of space.members) {
        this.removeMemberSpace(member, space._id)
      }
    }
    this.spacesMap.delete(_id)
    this.privateSpaces.delete(_id)
    this.publicSpaces.delete(_id)
  }

  private async handeCollaborator (ctx: MeasureContext<SessionData>, tx: TxCUD<Collaborator>): Promise<void> {
    if (!this.context.hierarchy.isDerived(tx.objectClass, core.class.Collaborator)) return
    if (tx._class === core.class.TxCreateDoc) {
      const collab = TxProcessor.createDoc2Doc<Collaborator>(tx as TxCreateDoc<Collaborator>)
      this.handleChangeCollaborator(ctx, collab)
    } else if (tx._class === core.class.TxRemoveDoc) {
      const collab = (await this.next?.findAll(ctx, core.class.Collaborator, {
        _id: tx.objectId
      })) as Collaborator[]
      if (collab.length === 0) return
      this.handleChangeCollaborator(ctx, collab[0])
    }
  }

  private handleChangeCollaborator (ctx: MeasureContext<SessionData>, collab: Collaborator): void {
    const collabSec = this.context.modelDb.findAllSync(core.class.ClassCollaborators, {
      attachedTo: collab.attachedToClass
    })[0]
    if (collabSec?.provideSecurity === true) {
      for (const val of ctx.contextData.socialStringsToUsers.values()) {
        if (
          val.accontUuid === collab.collaborator &&
          [AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(val.role)
        ) {
          this.brodcastEvent(ctx, [val.accontUuid])
        }
      }
    }
  }

  private async handleCreate (ctx: MeasureContext, tx: TxCUD<Space>): Promise<void> {
    if (!this.context.hierarchy.isDerived(tx.objectClass, core.class.Space)) return
    // Duplicate inserts can be ignored by storage. Trust only the committed document.
    await this.refreshSpace(ctx, tx.objectId)
  }

  private syncMembers (ctx: MeasureContext, members: AccountUuid[], space: SpaceWithMembers): void {
    const oldMembers = new Set(space.members)
    const newMembers = new Set(members)
    const changed: AccountUuid[] = []
    for (const old of oldMembers) {
      if (!newMembers.has(old)) {
        this.removeMemberSpace(old, space._id)
        changed.push(old)
      }
    }
    for (const newMem of newMembers) {
      if (!oldMembers.has(newMem)) {
        this.addMemberSpace(newMem, space._id)
        changed.push(newMem)
      }
    }
    // TODO: consider checking if updated social strings actually change assigned accounts
    if (changed.length > 0) {
      this.brodcastEvent(ctx, changed, space._id)
    }
  }

  private brodcastEvent (ctx: MeasureContext<SessionData>, users: AccountUuid[], space?: Ref<Space>): void {
    const targets = this.getTargets(users)
    const tx: TxWorkspaceEvent = {
      _class: core.class.TxWorkspaceEvent,
      _id: generateId(),
      event: WorkspaceEvent.SecurityChange,
      modifiedBy: core.account.System,
      modifiedOn: Date.now(),
      objectSpace: space ?? core.space.DerivedTx,
      space: core.space.DerivedTx,
      params: null
    }
    ctx.contextData.broadcast.txes.push(tx)
    ctx.contextData.broadcast.targets['security' + tx._id] = async (it) => {
      // TODO: I'm not sure it is called
      if (it._id === tx._id) {
        return {
          target: targets
        }
      }
    }
  }

  private broadcastNonMembers (ctx: MeasureContext<SessionData>, space: SpaceWithMembers): void {
    const members = space?.members ?? []

    this.brodcastEvent(ctx, members, space._id)
  }

  private broadcastAll (ctx: MeasureContext<SessionData>, space: SpaceWithMembers): void {
    const { socialStringsToUsers } = ctx.contextData
    const accounts = Array.from(new Set(Array.from(socialStringsToUsers.values()).map((v) => v.accontUuid)))

    this.brodcastEvent(ctx, accounts, space._id)
  }

  private async handleUpdate (ctx: MeasureContext, tx: TxCUD<Space>): Promise<void> {
    await this.init(ctx)

    const updateDoc = tx as TxUpdateDoc<Space>
    if (!this.context.hierarchy.isDerived(updateDoc.objectClass, core.class.Space)) return

    const attributes = getUpdatedAttributes(updateDoc.operations)
    if (attributes !== 'all' && !['members', 'private', 'archived', '_class'].some((key) => attributes.has(key))) return
    await this.refreshSpace(ctx, updateDoc.objectId)
  }

  private async refreshSpace (ctx: MeasureContext, id: Ref<Space>): Promise<void> {
    const previous = this.updateTails.get(id) ?? Promise.resolve()
    let release: () => void = () => {}
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    this.updateTails.set(id, tail)
    await previous
    try {
      // Serialize fresh reads per space, so an older snapshot cannot overwrite a
      // newer one. The projection matches init and bypasses in-flight client reads.
      const [stored] =
        (await this.next?.findAll(
          ctx,
          core.class.Space,
          { _id: id },
          {
            limit: 1,
            prefix: 'security',
            projection: { _id: 1, _class: 1, members: 1, private: 1, archived: 1 }
          }
        )) ?? []
      if (stored === undefined) return
      if (stored._class === core.class.SystemSpace) {
        this.removeSpace(id)
        this.systemSpaces.add(id)
        return
      }
      this.systemSpaces.delete(id)
      const updatedSpace: SpaceWithMembers = {
        _id: stored._id,
        _class: stored._class,
        members: stored.members ?? [],
        private: stored.private,
        archived: stored.archived
      }
      const space = this.spacesMap.get(id)
      if (space === undefined) {
        this.addSpace(updatedSpace)
        return
      }
      if (space.private !== updatedSpace.private) {
        if (updatedSpace.private) {
          this.privateSpaces.add(id)
          this.publicSpaces.delete(id)
        } else {
          this.privateSpaces.delete(id)
          this.publicSpaces.add(id)
        }
        this.broadcastNonMembers(ctx, space)
      }
      this.syncMembers(ctx, updatedSpace.members, space)
      if (space.archived !== updatedSpace.archived) this.broadcastAll(ctx, space)
      this.spacesMap.set(id, updatedSpace)
    } catch (err) {
      // The write already committed. Reload read access before the next request.
      this.resyncDomains()
      ctx.error('Failed to refresh space security', { id, err })
    } finally {
      release()
      if (this.updateTails.get(id) === tail) this.updateTails.delete(id)
    }
  }

  private handleRemove (tx: TxCUD<Space>): void {
    const removeTx = tx
    if (!this.context.hierarchy.isDerived(removeTx.objectClass, core.class.Space)) return
    if (removeTx._class !== core.class.TxRemoveDoc) return
    this.removeSpace(tx.objectId)
  }

  private async handleTx (ctx: MeasureContext, tx: TxCUD<Space>): Promise<void> {
    await this.init(ctx)
    if (tx._class === core.class.TxCreateDoc) {
      await this.handleCreate(ctx, tx)
    } else if (tx._class === core.class.TxUpdateDoc) {
      await this.handleUpdate(ctx, tx)
    } else if (tx._class === core.class.TxRemoveDoc) {
      this.handleRemove(tx)
    }
  }

  getTargets (accounts: AccountUuid[]): AccountUuid[] {
    const res = Array.from(new Set(accounts))
    // We need to add system account for targets for integrations to work properly
    res.push(systemAccountUuid)

    return res
  }

  private async processTxSpaceDomain (sctx: MeasureContext, actualTx: TxCUD<Doc>): Promise<void> {
    if (actualTx._class === core.class.TxCreateDoc) {
      const ctx = actualTx as TxCreateDoc<Doc>
      const doc = TxProcessor.createDoc2Doc(ctx)
      const domain = this.context.hierarchy.getDomain(ctx.objectClass)
      const key = this.getKey(domain)
      const space = (doc as any)[key]
      if (space === undefined) return
      ;(await this.getDomainSpaces(sctx, domain)).add(space)
    } else if (actualTx._class === core.class.TxUpdateDoc) {
      const updTx = actualTx as TxUpdateDoc<Doc>
      const domain = this.context.hierarchy.getDomain(updTx.objectClass)
      const key = this.getKey(domain)
      const space = (updTx.operations as any)[key]
      if (space !== undefined) {
        ;(await this.getDomainSpaces(sctx, domain)).add(space)
      }
    }
  }

  private async processTx (ctx: MeasureContext<SessionData>, tx: Tx, skipCollaboratorRemove = false): Promise<void> {
    const h = this.context.hierarchy
    if (TxProcessor.isExtendsCUD(tx._class)) {
      const cudTx = tx as TxCUD<Doc>
      const isSpace = h.isDerived(cudTx.objectClass, core.class.Space)
      if (isSpace) {
        await this.handleTx(ctx, cudTx as TxCUD<Space>)
      } else if (!skipCollaboratorRemove || tx._class !== core.class.TxRemoveDoc) {
        await this.handeCollaborator(ctx, cudTx as TxCUD<Collaborator>)
      }
      await this.processTxSpaceDomain(ctx, tx as TxCUD<Doc>)
    } else if (tx._class === core.class.TxWorkspaceEvent) {
      const event = tx as TxWorkspaceEvent
      if (event.event === WorkspaceEvent.BulkUpdate) {
        this.resyncDomains()
      }
    }
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    await this.init(ctx)
    // Preserve removal notifications: these documents are unavailable after persistence.
    const removedCollaborators: Collaborator[] = []
    for (const tx of txes) {
      const cud = tx as TxCUD<Collaborator>
      if (
        tx._class === core.class.TxRemoveDoc &&
        this.context.hierarchy.isDerived(cud.objectClass, core.class.Collaborator)
      ) {
        removedCollaborators.push(
          ...((await this.next?.findAll(ctx, core.class.Collaborator, {
            _id: cud.objectId
          })) ?? [])
        )
      }
    }
    const broadcast = ctx.contextData.broadcast
    const start = broadcast.txes.length
    // Authorization and persistence must succeed before changing read access or broadcasts.
    const res = await this.provideTx(ctx, txes)
    const persisted = broadcast.txes.length
    const processed = new Set<Ref<Tx>>()
    ctx.contextData.contextCache.set('processed', processed)
    for (const tx of txes) {
      processed.add(tx._id)
      await this.processTx(ctx, tx, true)
    }
    for (const collaborator of removedCollaborators) this.handleChangeCollaborator(ctx, collaborator)
    // Clients must receive security events before the committed changes. A query refresh
    // that follows an already applied update drops the pending live query notification.
    if (broadcast.txes.length > persisted) {
      broadcast.txes.splice(start, 0, ...broadcast.txes.splice(persisted))
    }
    return res
  }

  override async handleBroadcast (ctx: MeasureContext<SessionData>): Promise<void> {
    const processed: Set<Ref<Tx>> = ctx.contextData.contextCache.get('processed') ?? new Set<Ref<Tx>>()
    ctx.contextData.contextCache.set('processed', processed)
    for (const txd of ctx.contextData.broadcast.txes) {
      if (!processed.has(txd._id)) {
        await this.processTx(ctx, txd)
      }
    }
    for (const tx of ctx.contextData.broadcast.txes) {
      if (TxProcessor.isExtendsCUD(tx._class)) {
        // TODO: Do we need security check here?
        const cudTx = tx as TxCUD<Doc>
        await this.processTxSpaceDomain(ctx, cudTx)
      } else if (tx._class === core.class.TxWorkspaceEvent) {
        const event = tx as TxWorkspaceEvent
        if (event.event === WorkspaceEvent.BulkUpdate) {
          this.resyncDomains()
        }
      }
    }

    ctx.contextData.broadcast.targets.spaceSec = async (tx) => {
      const cud = tx as TxCUD<Doc>
      if (cud.objectClass === undefined) return undefined

      // For system and main spaces broadcast to all users except guests that are not collaborators for objects with collab security enabled
      if (this.systemSpaces.has(tx.objectSpace) || this.mainSpaces.has(tx.objectSpace)) {
        const collabSec = getClassCollaborators(this.context.modelDb, this.context.hierarchy, cud.objectClass)
        if (collabSec?.provideSecurity === true) {
          const guests = new Set<AccountUuid>()
          for (const val of ctx.contextData.socialStringsToUsers.values()) {
            if ([AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(val.role)) {
              guests.add(val.accontUuid)
            }
          }
          const collabs = (await this.next?.findAll(ctx, core.class.Collaborator, {
            attachedTo: cud.objectId
          })) as Collaborator[]
          for (const collab of collabs) {
            guests.delete(collab.collaborator)
          }
          return { exclude: Array.from(guests) }
        }
        return undefined
      }

      const space = this.spacesMap.get(tx.objectSpace)
      if (space === undefined) return undefined

      const getCollabTargets = async (_id: Ref<Doc>): Promise<AccountUuid[]> => {
        const guests = new Set<AccountUuid>()
        for (const val of ctx.contextData.socialStringsToUsers.values()) {
          if ([AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(val.role)) {
            guests.add(val.accontUuid)
          }
        }
        const collaboratorObjs = (await this.next?.findAll(ctx, core.class.Collaborator, {
          attachedTo: _id
        })) as Collaborator[]

        return collaboratorObjs.map((it) => it.collaborator).filter((it) => guests.has(it))
      }

      // For all other spaces broadcast to space members
      // + guests that are collaborators for objects with collab security enabled
      // + guests that are collaborators for attached objects with collab security enabled
      let collabTargets: AccountUuid[] = []
      const collabSec = getClassCollaborators(this.context.modelDb, this.context.hierarchy, cud.objectClass)
      if (collabSec?.provideSecurity === true) {
        collabTargets = await getCollabTargets(cud.objectId)
      } else if (cud.attachedTo != null && cud.attachedToClass != null) {
        const attachedCollabSec = getClassCollaborators(
          this.context.modelDb,
          this.context.hierarchy,
          cud.attachedToClass
        )
        if (attachedCollabSec?.provideSecurity === true) {
          collabTargets = await getCollabTargets(cud.attachedTo)
        }
      }

      const spaceTargets = space.members.length === 0 ? [] : this.getTargets(space?.members)
      const target = [...collabTargets, ...spaceTargets]

      return target.length === 0 ? undefined : { target }
    }

    await this.next?.handleBroadcast(ctx)
  }

  private getAllAllowedSpaces (
    account: Account,
    isData: boolean,
    showArchived: boolean,
    forSearch: boolean = false
  ): Ref<Space>[] {
    const userSpaces = this.allowedSpaces[account.uuid] ?? []
    let res = [...Array.from(userSpaces), account.uuid as unknown as Ref<Space>, ...this.mainSpaces]
    if (!forSearch || ![AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(account.role)) {
      res = [...res, ...this.systemSpaces]
    }
    const ignorePublicSpaces = isData || account.role === AccountRole.ReadOnlyGuest
    const unfilteredRes = ignorePublicSpaces ? res : [...res, ...this.publicSpaces]
    if (showArchived) {
      return unfilteredRes
    }
    return unfilteredRes.filter((p) => this.spacesMap.get(p)?.archived !== true)
  }

  async getDomainSpaces (ctx: MeasureContext, domain: Domain): Promise<Set<Ref<Space>>> {
    let domainSpaces = this._domainSpaces.get(domain)
    if (domainSpaces === undefined) {
      const p = (
        this.next?.groupBy<Ref<Space>, Doc>(ctx, domain, this.getKey(domain)) ?? Promise.resolve(new Map())
      ).then((r) => new Set<Ref<Space>>(r.keys()))
      this._domainSpaces.set(domain, p)
      domainSpaces = await p
      this._domainSpaces.set(domain, domainSpaces)
    }
    return domainSpaces instanceof Promise ? await domainSpaces : domainSpaces
  }

  private async filterByDomain (
    ctx: MeasureContext,
    domain: Domain,
    spaces: Ref<Space>[]
  ): Promise<{ result: Set<Ref<Space>>, allDomainSpaces: boolean, domainSpaces: Set<Ref<Space>> }> {
    const domainSpaces = await this.getDomainSpaces(ctx, domain)
    const result = new Set(spaces.filter((p) => domainSpaces.has(p)))
    return {
      result,
      allDomainSpaces: result.size === domainSpaces.size,
      domainSpaces
    }
  }

  private async mergeQuery<T extends Doc> (
    ctx: MeasureContext,
    account: Account,
    query: ObjQueryType<T['space']>,
    domain: Domain,
    isSpace: boolean,
    showArchived: boolean
  ): Promise<ObjQueryType<T['space']> | undefined> {
    const spaces = await this.filterByDomain(ctx, domain, this.getAllAllowedSpaces(account, !isSpace, showArchived))
    if (query == null) {
      if (spaces.allDomainSpaces) {
        return undefined
      }
      return { $in: Array.from(spaces.result) }
    }
    if (typeof query === 'string') {
      if (!spaces.result.has(query)) {
        return { $in: [] }
      }
    } else if (query.$in != null) {
      query.$in = query.$in.filter((p) => spaces.result.has(p))
      if (query.$in.length === spaces.domainSpaces.size) {
        // all domain spaces
        delete query.$in
      }
    } else {
      if (spaces.allDomainSpaces) {
        delete query.$in
      } else {
        query.$in = Array.from(spaces.result)
      }
    }
    if (Object.keys(query).length === 0) {
      return undefined
    }
    return query
  }

  private getKey (domain: string): string {
    return domain === 'tx' ? 'objectSpace' : domain === 'space' ? '_id' : 'space'
  }

  override async findAll<T extends Doc> (
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    await this.init(ctx)

    const domain = this.context.hierarchy.getDomain(_class)
    const newQuery = clone(query)
    const account = ctx.contextData.account
    const isSpace = this.context.hierarchy.isDerived(_class, core.class.Space)
    const field = this.getKey(domain)
    const showArchived: boolean = shouldShowArchived(newQuery, options)

    let clientFilterSpaces: Set<Ref<Space>> | undefined

    if (!isSystem(account, ctx) && account.role !== AccountRole.DocGuest && domain !== DOMAIN_MODEL) {
      if (!isOwner(account, ctx) || !isSpace || !showArchived) {
        if (newQuery[field] !== undefined) {
          const res = await this.mergeQuery(ctx, account, newQuery[field], domain, isSpace, showArchived)
          if (res === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete newQuery[field]
          } else {
            newQuery[field] = res
            if (typeof res === 'object') {
              if (Array.isArray(res.$in) && res.$in.length === 1 && Object.keys(res).length === 1) {
                newQuery[field] = res.$in[0]
              }
            }
          }
        } else {
          const spaces = await this.filterByDomain(
            ctx,
            domain,
            this.getAllAllowedSpaces(account, !isSpace, showArchived)
          )
          if (spaces.allDomainSpaces) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete newQuery[field]
          } else if (spaces.result.size === 1) {
            newQuery[field] = Array.from(spaces.result)[0]
            if (options !== undefined) {
              options.allowedSpaces = Array.from(spaces.result)
            } else {
              options = { allowedSpaces: Array.from(spaces.result) }
            }
          } else {
            // Check if spaces are greater than 85% of all domain spaces. In this case, return all and filter on the client.
            if (spaces.result.size / spaces.domainSpaces.size > 0.85 && options?.limit === undefined) {
              clientFilterSpaces = spaces.result
              delete newQuery.space
            } else {
              newQuery[field] = { $in: Array.from(spaces.result) }
              if (options !== undefined) {
                options.allowedSpaces = Array.from(spaces.result)
              } else {
                options = { allowedSpaces: Array.from(spaces.result) }
              }
            }
          }
        }
      }
    }

    let findResult = await this.provideFindAll(ctx, _class, !this.skipFindCheck ? newQuery : query, options)
    if (clientFilterSpaces !== undefined) {
      const cfs = clientFilterSpaces
      findResult = toFindResult(
        findResult.filter((it) => cfs.has((it as any)[field])),
        findResult.total,
        findResult.lookupMap
      )
    }
    if (account.role !== AccountRole.DocGuest) {
      if (options?.lookup !== undefined) {
        for (const object of findResult) {
          if (object.$lookup !== undefined) {
            this.filterLookup(ctx, object.$lookup, showArchived)
          }
        }
      }
    }
    return findResult
  }

  override async searchFulltext (
    ctx: MeasureContext<SessionData>,
    query: SearchQuery,
    options: SearchOptions
  ): Promise<SearchResult> {
    await this.init(ctx)
    const newQuery = { ...query }
    const account = ctx.contextData.account
    if (!isSystem(account, ctx)) {
      const allSpaces = this.getAllAllowedSpaces(account, true, false, true)
      if (query.classes !== undefined) {
        const res = new Set<Ref<Space>>()
        const passedDomains = new Set<string>()
        for (const _class of query.classes) {
          const domain = this.context.hierarchy.getDomain(_class)
          if (passedDomains.has(domain)) {
            continue
          }
          passedDomains.add(domain)
          const spaces = await this.filterByDomain(ctx, domain, allSpaces)
          for (const space of spaces.result) {
            res.add(space)
          }
        }
        newQuery.spaces = [...res]
      } else {
        newQuery.spaces = allSpaces
      }
    }
    const result = await this.provideSearchFulltext(ctx, newQuery, options)
    return result
  }

  filterLookup<T extends Doc> (ctx: MeasureContext, lookup: LookupData<T>, showArchived: boolean): void {
    if (Object.keys(lookup).length === 0) return
    const account = ctx.contextData.account
    if (isSystem(account, ctx)) return
    const owner = isOwner(account, ctx)
    const h = this.context.hierarchy
    const allowedSpaces = new Set(this.getAllAllowedSpaces(account, true, showArchived))
    for (const key in lookup) {
      const val = lookup[key]
      if (Array.isArray(val)) {
        const arr: AttachedDoc[] = []
        for (const value of val) {
          const isSpace = '_class' in value && h.isDerived(value._class, core.class.Space)
          const availableForOwner = owner && isSpace
          const availableSpace = isSpace && allowedSpaces.has(value._id)
          const availableDoc = !isSpace && allowedSpaces.has(value.space)
          if (availableForOwner || availableSpace || availableDoc) {
            arr.push(value)
          }
        }
        lookup[key] = arr as any
      } else if (val !== undefined) {
        const isSpace = '_class' in val && h.isDerived(val._class, core.class.Space)
        const availableForOwner = owner && isSpace
        const availableSpace = isSpace && allowedSpaces.has(val._id as Ref<Space>)
        const availableDoc = !isSpace && allowedSpaces.has(val.space)
        if (!availableForOwner && !availableSpace && !availableDoc) {
          // allow attached lookups for guests when collaborator security is enabled
          // do not check if collaborator of the doc because it's being checked on the storage (DB) level
          // as otherwise there will be no doc here at all
          if (key === 'attachedTo' && ctx.contextData.modelDb?.hierarchy != null) {
            const attachedVal = val as AttachedDoc
            if (attachedVal.attachedToClass == null) {
              lookup[key] = undefined
              continue
            }

            const collabSec = getClassCollaborators(
              ctx.contextData.modelDb,
              ctx.contextData.modelDb.hierarchy,
              attachedVal.attachedToClass
            )
            const collabSecEnabled =
              collabSec?.provideSecurity === true &&
              [AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(account.role)
            if (!collabSecEnabled) {
              lookup[key] = undefined
            }
          } else {
            lookup[key] = undefined
          }
        }
      }
    }
  }
}
