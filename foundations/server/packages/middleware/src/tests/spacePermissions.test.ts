// SPDX-License-Identifier: EPL-2.0

import core, {
  AccountRole,
  ClassifierKind,
  DOMAIN_MODEL,
  DOMAIN_SPACE,
  Hierarchy,
  MeasureMetricsContext,
  ModelDb,
  TxFactory,
  TxProcessor,
  clone,
  toFindResult,
  systemAccountUuid,
  type AccountUuid,
  type Class,
  type Doc,
  type Domain,
  type DocumentQuery,
  type DocumentUpdate,
  type FindResult,
  type MeasureContext,
  type Mixin,
  type Permission,
  type PersonId,
  type Ref,
  type Role,
  type SessionData,
  type Space,
  type SpaceType,
  type SpaceTypeDescriptor,
  type Tx,
  type TxApplyIf,
  type TxCUD,
  type TxCreateDoc,
  type TxMixin,
  type TxUpdateDoc,
  type TypedSpace,
  type WorkspaceUuid
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import { SpacePermissionsMiddleware } from '../spacePermissions'
import { getUpdatedAttributes } from '../utils'
import { SpaceSecurityMiddleware } from '../spaceSecurity'
import { QueryJoinMiddleware } from '../queryJoin'
import {} from '../broadcast'
import contact from '@hcengineering/contact'

const DOCUMENT = 'test:class:Document' as Ref<Class<Doc>>
const CHANNEL = 'test:class:Channel' as Ref<Class<Space>>
const DIRECT_MESSAGE = 'test:class:DirectMessage' as Ref<Class<Space>>
const TEMPLATE_CATEGORY = 'test:class:TemplateCategory' as Ref<Class<Space>>

const OWNER = 'test:owner' as AccountUuid
const MEMBER = 'test:member' as AccountUuid
const OTHER = 'test:other' as AccountUuid
const SOCIAL = 'test:social' as PersonId
const CREATOR = 'test:creator' as PersonId
const ROLE = 'test:role:Editor' as Ref<Role>
const GLOBAL_ROLE = 'test:role:SpacesAdmin' as Ref<Role>
const TYPE = 'test:type:Default' as Ref<SpaceType>
const GLOBAL_TYPE = 'test:type:Spaces' as Ref<SpaceType>
const ASSIGNMENT = 'test:mixin:Assignment' as Ref<Mixin<TypedSpace>>
const GLOBAL_ASSIGNMENT = 'test:mixin:Spaces' as Ref<Mixin<TypedSpace>>
const OTHER_MIXIN = 'test:mixin:Other' as Ref<Mixin<Space>>
const WRONG_MIXIN = 'test:mixin:Wrong' as Ref<Mixin<Doc>>
const SPACE = 'test:space' as Ref<TypedSpace>
const factory = new TxFactory(SOCIAL)
const forbidden = new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))

function makeContext (uuid = MEMBER, role = AccountRole.User): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account: { uuid, role, primarySocialId: SOCIAL, socialIds: [SOCIAL], fullSocialIds: [] },
    broadcast: { txes: [], targets: {}, queue: [], sessions: {} },
    contextCache: new Map(),
    socialStringsToUsers: new Map()
  } as unknown as SessionData
  return ctx
}

function update (operations: DocumentUpdate<TypedSpace>): TxUpdateDoc<TypedSpace> {
  return factory.createTxUpdateDoc(core.class.TypedSpace, core.space.Space, SPACE, operations)
}

function rawUpdate (operations: Record<string, unknown>): TxUpdateDoc<TypedSpace> {
  return update(operations)
}

function mixin (attributes: Record<string, unknown> = { [ROLE]: [MEMBER] }): TxMixin<TypedSpace, TypedSpace> {
  return factory.createTxMixin(SPACE, core.class.TypedSpace, core.space.Space, ASSIGNMENT, attributes)
}

function wrap (txes: TxCUD<Doc>[]): TxApplyIf {
  return factory.createTxApplyIf(core.space.Space, undefined, [], [], txes, undefined)
}

class StorageMiddleware extends BaseMiddleware {
  readonly documents = new Map<Ref<Doc>, Doc>()
  readonly txes: Tx[] = []
  fail = false
  beforeWrite?: () => Promise<void>
  reads = 0
  beforeRead?: (query: DocumentQuery<Doc>, options?: ServerFindOptions<Doc>) => Promise<void>
  afterRead?: (query: DocumentQuery<Doc>, options?: ServerFindOptions<Doc>) => Promise<void>
  afterWrite?: () => void

  constructor (context: PipelineContext, spaces: Space[]) {
    super(context)
    for (const space of spaces) this.documents.set(space._id, space)
  }

  override async findAll<T extends Doc> (
    ctx: MeasureContext,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    this.reads++
    await this.beforeRead?.(query, options)
    const documents = Array.from(this.documents.values()).filter((doc) => {
      if (!this.context.hierarchy.isDerived(doc._class, _class)) return false
      return Object.entries(query).every(([key, value]) => {
        const actual: unknown = Reflect.get(doc, key)
        if (typeof value === 'object' && value !== null && '$in' in value) {
          return (value.$in as unknown[]).includes(actual)
        }
        return value === actual
      })
    })
    const result = toFindResult(clone(documents) as T[])
    await this.afterRead?.(query, options)
    return result
  }

  override async groupBy<T> (ctx: MeasureContext, domain: string, field: string): Promise<Map<T, number>> {
    return new Map(Array.from(this.documents.values()).map((doc) => [Reflect.get(doc, field) as T, 1]))
  }

  override async tx (ctx: MeasureContext, txes: Tx[]): Promise<TxMiddlewareResult> {
    await this.beforeWrite?.()
    if (this.fail) throw new Error('storage rejected')
    this.txes.push(...txes)
    for (const tx of txes) this.applyTx(tx)
    this.afterWrite?.()
    return {}
  }

  private applyTx (tx: Tx, seen = new Set<Tx>()): void {
    if (seen.has(tx) || seen.size >= 10000) throw new Error('Cyclic or oversized transaction fixture')
    seen.add(tx)
    if (tx._class === core.class.TxApplyIf) {
      for (const child of (tx as TxApplyIf).txes) this.applyTx(child, seen)
      return
    }
    const cud = tx as TxCUD<Doc>
    if (cud.objectSpace === core.space.Model) {
      this.context.modelDb.addTxes(makeContext(), [tx], true)
      return
    }
    if (tx._class === core.class.TxCreateDoc) {
      // Mongo logs duplicate-key failures without rejecting the whole batch.
      if (!this.documents.has(cud.objectId)) {
        this.documents.set(cud.objectId, TxProcessor.createDoc2Doc(tx as TxCreateDoc<Doc>))
      }
      return
    }
    const doc = this.documents.get(cud.objectId)
    if (doc === undefined) return
    if (tx._class === core.class.TxUpdateDoc) TxProcessor.updateDoc2Doc(doc, tx as TxUpdateDoc<Doc>)
    if (tx._class === core.class.TxMixin) TxProcessor.updateMixin4Doc(doc, tx as TxMixin<Doc, Doc>)
    if (tx._class === core.class.TxRemoveDoc) this.documents.delete(cud.objectId)
  }
}

async function setup (
  local: Ref<Permission>[] = [],
  global: Ref<Permission>[] = []
): Promise<{
  middleware: SpacePermissionsMiddleware
  security: SpaceSecurityMiddleware
  storage: StorageMiddleware
  ctx: MeasureContext<SessionData>
  space: TypedSpace
  globalSpace: TypedSpace
  model: ModelDb
  context: PipelineContext
}> {
  const hierarchy = new Hierarchy()
  const model = new ModelDb(hierarchy)
  const classes: Array<[Ref<Class<Doc>>, Ref<Class<Doc>> | undefined, Domain, ClassifierKind]> = [
    [core.class.Doc, undefined, DOMAIN_MODEL, ClassifierKind.CLASS],
    [core.class.AttachedDoc, core.class.Doc, DOMAIN_MODEL, ClassifierKind.CLASS],
    [core.class.Space, core.class.Doc, DOMAIN_SPACE, ClassifierKind.CLASS],
    [DOCUMENT, core.class.Doc, DOMAIN_SPACE, ClassifierKind.CLASS],
    [CHANNEL, core.class.Space, DOMAIN_SPACE, ClassifierKind.CLASS],
    [DIRECT_MESSAGE, core.class.Space, DOMAIN_SPACE, ClassifierKind.CLASS],
    [core.class.SystemSpace, core.class.Space, DOMAIN_SPACE, ClassifierKind.CLASS],
    [TEMPLATE_CATEGORY, core.class.Space, DOMAIN_SPACE, ClassifierKind.CLASS],
    [contact.class.PersonSpace, core.class.Space, DOMAIN_SPACE, ClassifierKind.CLASS],
    [core.class.TypedSpace, core.class.Space, DOMAIN_SPACE, ClassifierKind.CLASS],
    [core.class.SpaceType, core.class.Doc, DOMAIN_MODEL, ClassifierKind.CLASS],
    [core.class.Permission, core.class.Doc, DOMAIN_MODEL, ClassifierKind.CLASS],
    [core.class.Collaborator, core.class.AttachedDoc, DOMAIN_MODEL, ClassifierKind.CLASS],
    [core.class.ClassCollaborators, core.class.Doc, DOMAIN_MODEL, ClassifierKind.CLASS],
    [core.class.Role, core.class.AttachedDoc, DOMAIN_MODEL, ClassifierKind.CLASS],
    [ASSIGNMENT, core.class.TypedSpace, DOMAIN_SPACE, ClassifierKind.MIXIN],
    [GLOBAL_ASSIGNMENT, core.class.TypedSpace, DOMAIN_SPACE, ClassifierKind.MIXIN],
    [OTHER_MIXIN, core.class.Space, DOMAIN_SPACE, ClassifierKind.MIXIN],
    [WRONG_MIXIN, core.class.SpaceType, DOMAIN_MODEL, ClassifierKind.MIXIN]
  ]
  for (const [id, parent, domain, kind] of classes) {
    hierarchy.tx(
      factory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        {
          extends: parent,
          domain,
          kind,
          label: core.string.Space
        },
        id
      )
    )
  }
  const modelDoc = { space: core.space.Model, modifiedBy: SOCIAL, modifiedOn: 1 }
  const spaceType: SpaceType = {
    ...modelDoc,
    _id: TYPE,
    _class: core.class.SpaceType,
    name: 'Test',
    descriptor: 'test:descriptor' as Ref<SpaceTypeDescriptor>,
    roles: 1,
    targetClass: ASSIGNMENT
  }
  model.addDoc(spaceType)
  const globalSpaceType: SpaceType = { ...spaceType, _id: GLOBAL_TYPE, targetClass: GLOBAL_ASSIGNMENT }
  model.addDoc(globalSpaceType)
  for (const id of [
    core.permission.UpdateSpace,
    core.permission.ArchiveSpace,
    core.permission.UpdateObject,
    core.permission.DeleteObject
  ]) {
    const permission: Permission = { ...modelDoc, _id: id, _class: core.class.Permission, label: core.string.Space }
    model.addDoc(permission)
  }
  const role: Role = {
    ...modelDoc,
    _id: ROLE,
    _class: core.class.Role,
    name: 'Editor',
    attachedTo: TYPE,
    attachedToClass: core.class.SpaceType,
    collection: 'roles',
    permissions: local
  }
  model.addDoc(role)
  const globalRole: Role = { ...role, _id: GLOBAL_ROLE, attachedTo: GLOBAL_TYPE, permissions: global }
  model.addDoc(globalRole)
  const space: TypedSpace = {
    _id: SPACE,
    _class: core.class.TypedSpace,
    space: core.space.Space,
    modifiedBy: CREATOR,
    modifiedOn: 1,
    createdBy: CREATOR,
    name: 'Test',
    description: '',
    private: false,
    archived: false,
    owners: [OWNER],
    members: [OWNER, MEMBER],
    type: TYPE
  }
  Object.assign(space, { [ASSIGNMENT]: { [ROLE]: [MEMBER] } })
  const globalSpace: TypedSpace = {
    ...clone(space),
    _id: core.space.Space,
    type: GLOBAL_TYPE,
    owners: [OWNER]
  }
  Object.assign(globalSpace, { [GLOBAL_ASSIGNMENT]: { [GLOBAL_ROLE]: [MEMBER] } })
  const context: PipelineContext = {
    hierarchy,
    modelDb: model,
    workspace: { uuid: 'test:workspace' as WorkspaceUuid, url: 'test' },
    branding: null,
    contextVars: {}
  }
  const storage = new StorageMiddleware(context, [space, globalSpace])
  const ctx = makeContext()
  const middleware = await SpacePermissionsMiddleware.create(ctx, context, storage)
  const security = await SpaceSecurityMiddleware.create(false, ctx, context, middleware)
  return { middleware, security, storage, ctx, space, globalSpace, model, context }
}

const adminChanges: Array<[string, Record<string, unknown>]> = [
  ['owners replacement', { owners: [MEMBER] }],
  ['members replacement', { members: [MEMBER] }],
  ['members push', { $push: { members: OTHER } }],
  ['owners push', { $push: { owners: MEMBER } }],
  ['members pull', { $pull: { members: OWNER } }],
  ['owners pull', { $pull: { owners: OWNER } }],
  ['each', { $push: { members: { $each: [OTHER] } } }],
  ['each with self', { $push: { members: { $each: [MEMBER, OTHER] } } }],
  ['each with slice', { $push: { members: { $each: [MEMBER], $slice: 1 } } }],
  ['in', { $pull: { members: { $in: [OWNER] } } }],
  ['in with self', { $pull: { members: { $in: [MEMBER, OWNER] } } }],
  ['unset owners', { $unset: { owners: true } }],
  ['unset members', { $unset: { members: true } }],
  ['dotted owner', { 'owners.0': MEMBER }],
  ['dotted member', { 'members.0': MEMBER }],
  ['rename source', { $rename: { owners: 'name' } }],
  ['rename destination', { $rename: { name: 'owners.0' } }],
  ['private', { private: true }],
  ['restricted', { restricted: true }],
  ['type', { type: 'test:another' }],
  ['autoJoin', { autoJoin: true }],
  ['autoJoinForRoles', { autoJoinForRoles: [AccountRole.User] }],
  ['class downgrade', { _class: core.class.Space }],
  ['creator spoof', { createdBy: SOCIAL }],
  ['id', { _id: 'test:changed' }],
  ['space', { space: 'test:changed' }],
  ['role root', { [ASSIGNMENT]: { [ROLE]: [MEMBER] } }],
  ['top-level role', { [ROLE]: [MEMBER] }],
  ['top-level role path', { [`${ROLE}.0`]: MEMBER }],
  ['top-level role push', { $push: { [ROLE]: MEMBER } }],
  ['top-level role unset', { $unset: { [ROLE]: true } }],
  ['top-level role rename', { $rename: { name: ROLE } }],
  ['role path', { [`${ASSIGNMENT}.${ROLE}`]: [MEMBER] }],
  ['role push', { $push: { [`${ASSIGNMENT}.${ROLE}`]: MEMBER } }],
  ['role unset', { $unset: { [ASSIGNMENT]: true } }],
  ['role rename', { $rename: { name: `${ASSIGNMENT}.${ROLE}` } }],
  ['embedded update', { $update: { owners: { $query: {}, $set: { '0': MEMBER } } } }],
  ['inc', { $inc: { 'owners.0': 1 } }],
  ['set', { $set: { owners: [MEMBER] } }],
  ['unknown operator', { $future: { name: 'ignored' } }]
]

describe('operation classification', () => {
  it.each(adminChanges)('extracts attributes for %s', (_name, operations) => {
    const attributes = getUpdatedAttributes(operations)
    if ('$future' in operations) expect(attributes).toBe('all')
    else expect(attributes).toBeInstanceOf(Set)
  })

  it('includes dotted roots and both rename endpoints', () => {
    const rename: Record<string, unknown> = { $rename: { 'name.text': 'owners.0' } }
    expect(getUpdatedAttributes(rename)).toEqual(new Set(['name', 'owners']))
    expect(getUpdatedAttributes({ $unset: null } as unknown as DocumentUpdate<Doc>)).toBe('all')
  })
})

function deferred (): { promise: Promise<void>, resolve: () => void } {
  let complete: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: complete }
}

describe('permission cache refresh', () => {
  it('does not join security reads across a committed write', async () => {
    const { storage, ctx, context, space } = await setup()
    space.private = false
    const joiner = await QueryJoinMiddleware.create(ctx, context, storage)
    const reading = deferred()
    const gate = deferred()
    let first = true
    storage.afterRead = async (_query, options) => {
      if (first && options?.prefix === 'security') {
        first = false
        reading.resolve()
        await gate.promise
      }
    }
    const firstRead = joiner.findAll(ctx, core.class.Space, { _id: SPACE }, { limit: 1, prefix: 'security' })
    await reading.promise
    try {
      await storage.tx(ctx, [update({ private: true })])
      const freshRead = joiner.findAll(ctx, core.class.Space, { _id: SPACE }, { limit: 1, prefix: 'security' })
      gate.resolve()
      const [before, after] = await Promise.all([firstRead, freshRead])
      expect(before[0].private).toBe(false)
      expect(after[0].private).toBe(true)
    } finally {
      gate.resolve()
    }
  })

  it('measures bulk creation and administration with 1000 stored spaces', async () => {
    const { middleware, storage, space } = await setup()
    const ctx = makeContext(OWNER)
    await middleware.tx(ctx, [])
    const before = storage.reads
    const creates = Array.from({ length: 1000 }, (_, index) =>
      factory.createTxCreateDoc(
        core.class.TypedSpace,
        core.space.Space,
        { ...space, name: `Bulk ${index}` },
        `test:bulk:${index}` as Ref<TypedSpace>
      )
    )
    const started = Date.now()
    await middleware.tx(ctx, creates)
    const createMs = Date.now() - started
    const createReads = storage.reads - before
    expect(createReads).toBe(1)
    const reads = storage.reads
    const updates = creates.map((tx) =>
      factory.createTxUpdateDoc(core.class.TypedSpace, core.space.Space, tx.objectId, { private: true })
    )
    const updateStarted = Date.now()
    await middleware.tx(ctx, updates)
    const updateReads = storage.reads - reads
    ctx.info('Synthetic space administration measurement', {
      spaces: creates.length,
      createReads,
      createMs,
      updateReads,
      updateMs: Date.now() - updateStarted
    })
    // One stored cache reload per batch; authorization reads belong to the next cut.
    expect(updateReads).toBe(1)
    expect(storage.documents.size).toBe(1002)
  })

  it.each([false, true])('checks ordinary deletes after refresh (forbid=%s)', async (forbid) => {
    const { middleware, storage, ctx, space, model } = await setup(forbid ? [core.permission.DeleteObject] : [])
    space.restricted = !forbid
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
    Object.assign(permission, { txClass: core.class.TxRemoveDoc, objectClass: DOCUMENT, forbid })
    await middleware.tx(ctx, [])
    const reading = deferred()
    const gate = deferred()
    storage.afterRead = async (query) => {
      if (typeof query._id === 'object') {
        reading.resolve()
        await gate.promise
      }
    }
    const writing = middleware.tx(makeContext(OWNER), [update({ private: true })])
    await reading.promise
    const remove = factory.createTxRemoveDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>)
    const removing = middleware.tx(ctx, [remove])
    const rejected = expect(removing).rejects.toEqual(forbidden)
    gate.resolve()
    await writing
    await rejected
    expect(storage.txes).toHaveLength(1)
  })

  it.each([false, true])('waits for refresh before ordinary writes (conditional=%s)', async (conditional) => {
    const { middleware, storage, ctx } = await setup()
    await middleware.tx(ctx, [])
    const reading = deferred()
    const gate = deferred()
    storage.afterRead = async (query) => {
      if (typeof query._id === 'object') {
        reading.resolve()
        await gate.promise
      }
    }
    const writing = middleware.tx(makeContext(OWNER), [update({ $push: { members: OTHER } })])
    await reading.promise
    const create = factory.createTxCreateDoc(DOCUMENT, SPACE, {}, 'test:issue' as Ref<Doc>)
    const increment = rawUpdate({ $inc: { sequence: 1 } })
    const ordinary = [create, increment]
    let completed = false
    const concurrent = middleware.tx(ctx, conditional ? [wrap(ordinary)] : ordinary).then((result) => {
      completed = true
      return result
    })
    // Let the request reach the pending entry before releasing its refresh.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(completed).toBe(false)
    expect(storage.txes).toHaveLength(1)
    gate.resolve()
    await writing
    await expect(concurrent).resolves.toEqual({})
    expect(storage.txes).toHaveLength(conditional ? 2 : 3)
  })

  it('uses refreshed permissions for ordinary writes after a revocation', async () => {
    const { middleware, storage, ctx, space, model } = await setup([core.permission.DeleteObject])
    space.restricted = true
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
    Object.assign(permission, { txClass: core.class.TxRemoveDoc, objectClass: DOCUMENT })
    await middleware.tx(ctx, [])
    const reading = deferred()
    const gate = deferred()
    storage.afterRead = async (query) => {
      if (typeof query._id === 'object') {
        reading.resolve()
        await gate.promise
      }
    }
    const writing = middleware.tx(makeContext(OWNER), [mixin({ [ROLE]: [] })])
    await reading.promise
    const removing = middleware.tx(ctx, [factory.createTxRemoveDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>)])
    const rejected = expect(removing).rejects.toEqual(forbidden)
    gate.resolve()
    await writing
    await rejected
    expect(storage.txes).toHaveLength(1)
  })

  it('denies stale ordinary grants and administration until affected ids refresh', async () => {
    const { middleware, storage, ctx, space, model } = await setup([core.permission.DeleteObject])
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
    Object.assign(permission, { txClass: core.class.TxRemoveDoc, objectClass: DOCUMENT })
    space.restricted = true
    await middleware.tx(ctx, [])
    const errors = jest.spyOn(ctx, 'error').mockImplementation(() => {})
    const owner = makeContext(OWNER)
    jest.spyOn(owner, 'error').mockImplementation(() => {})
    let fail = true
    const refreshed: unknown[] = []
    storage.beforeRead = async (query) => {
      if (typeof query._id === 'object') {
        refreshed.push(query._id)
        if (fail) throw new Error('refresh unavailable')
      }
    }
    // Revoke a cached grant, then fail its post-write reload.
    await expect(middleware.tx(owner, [mixin({ [ROLE]: [] })])).resolves.toEqual({})
    expect(space[ASSIGNMENT as keyof TypedSpace]).toEqual({ [ROLE]: [] })
    const remove = factory.createTxRemoveDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>)
    const ordinary = [
      factory.createTxCreateDoc(DOCUMENT, SPACE, {}, 'test:new' as Ref<Doc>),
      factory.createTxUpdateDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>, {}),
      factory.createTxMixin('test:doc' as Ref<Doc>, DOCUMENT, SPACE, OTHER_MIXIN, {}),
      remove
    ]
    for (const tx of ordinary) {
      await expect(middleware.tx(ctx, [tx])).rejects.toEqual(forbidden)
      await expect(middleware.tx(ctx, [wrap([tx])])).rejects.toEqual(forbidden)
    }
    expect(storage.txes).toHaveLength(1)
    await expect(middleware.tx(owner, [update({ private: true })])).rejects.toEqual(forbidden)
    expect(errors).toHaveBeenCalled()
    await expect(
      middleware.tx(ctx, [factory.createTxUpdateDoc(DOCUMENT, core.space.Workspace, 'test:unrelated' as Ref<Doc>, {})])
    ).resolves.toEqual({})
    fail = false
    await expect(middleware.tx(ctx, [remove])).rejects.toEqual(forbidden)
    await expect(middleware.tx(owner, [update({ private: true })])).resolves.toEqual({})
    expect(refreshed.every((query) => JSON.stringify(query) === JSON.stringify({ $in: [SPACE] }))).toBe(true)
    expect(middleware.wasInit).toBe(true)
  })

  it('refreshes grants after an owner uses a forged untyped class', async () => {
    const { middleware, storage, ctx, space, model } = await setup([core.permission.DeleteObject])
    space.restricted = true
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
    Object.assign(permission, { txClass: core.class.TxRemoveDoc, objectClass: DOCUMENT })
    await middleware.tx(ctx, [])
    const revoke = mixin({ [ROLE]: [] })
    revoke.objectClass = CHANNEL
    await middleware.tx(makeContext(OWNER), [revoke])
    await expect(
      middleware.tx(ctx, [factory.createTxRemoveDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>)])
    ).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([revoke])
  })

  it('retries a rejected initial load', async () => {
    const { middleware, storage, ctx } = await setup()
    storage.beforeRead = async () => {
      throw new Error('initial load failed')
    }
    await expect(middleware.tx(ctx, [])).rejects.toThrow('initial load failed')
    storage.beforeRead = undefined
    await expect(middleware.tx(ctx, [])).resolves.toEqual({})
  })

  it.each([CHANNEL, DIRECT_MESSAGE, contact.class.PersonSpace])(
    'verifies untyped creates without queueing, then skips reloads for membership, mixin and remove: %s',
    async (_class) => {
      const { middleware, storage, ctx } = await setup()
      ctx.contextData.account.uuid = systemAccountUuid
      ctx.contextData.account.primarySocialId = core.account.System
      await middleware.tx(ctx, [])
      const started = deferred()
      const gate = deferred()
      storage.beforeWrite = async () => {
        storage.beforeWrite = undefined
        started.resolve()
        await gate.promise
      }
      const writing = middleware.tx(makeContext(OWNER), [update({ private: true })])
      await started.promise
      const reads = storage.reads
      const id = 'test:untyped' as Ref<Space>
      const create = factory.createTxCreateDoc(
        _class,
        core.space.Space,
        {
          name: 'Untyped',
          description: '',
          members: [],
          private: false,
          archived: false
        },
        id
      )
      await middleware.tx(ctx, [create])
      await middleware.tx(ctx, [
        factory.createTxUpdateDoc(_class, core.space.Space, id, { $push: { members: MEMBER } })
      ])
      await middleware.tx(ctx, [factory.createTxMixin(id, _class, core.space.Space, OTHER_MIXIN, {})])
      await middleware.tx(ctx, [factory.createTxRemoveDoc(_class, core.space.Space, id)])
      expect(storage.reads).toBe(reads + 1)
      gate.resolve()
      await writing
    }
  )

  it('does not overwrite a newer refresh of the same space with an older snapshot', async () => {
    const { middleware, storage, ctx, space, model } = await setup()
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
    Object.assign(permission, { txClass: core.class.TxRemoveDoc, objectClass: DOCUMENT })
    await middleware.tx(ctx, [])
    const reading = deferred()
    const gate = deferred()
    let first = true
    storage.afterRead = async (query) => {
      if (typeof query._id === 'object' && first) {
        first = false
        reading.resolve()
        await gate.promise
      }
    }
    const writing = middleware.tx(makeContext(OWNER), [update({ private: true })])
    await reading.promise
    space.restricted = true
    const triggerCtx = makeContext()
    triggerCtx.contextData.broadcast.txes.push(update({ restricted: true }))
    await middleware.tx(triggerCtx, [])
    gate.resolve()
    await writing
    const remove = factory.createTxRemoveDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>)
    await expect(middleware.tx(ctx, [remove])).rejects.toEqual(forbidden)
  })

  it('waits for a replacement refresh before authorizing a queued write', async () => {
    const { middleware, storage, ctx, space, model } = await setup()
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
    Object.assign(permission, { txClass: core.class.TxRemoveDoc, objectClass: DOCUMENT })
    await middleware.tx(ctx, [])
    const firstRead = deferred()
    const secondRead = deferred()
    const firstGate = deferred()
    const secondGate = deferred()
    let reads = 0
    storage.afterRead = async (query) => {
      if (typeof query._id !== 'object') return
      reads++
      if (reads === 1) {
        firstRead.resolve()
        await firstGate.promise
      } else if (reads === 2) {
        secondRead.resolve()
        await secondGate.promise
      }
    }
    const writing = middleware.tx(makeContext(OWNER), [update({ private: true })])
    await firstRead.promise
    const remove = factory.createTxRemoveDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>)
    let settled = false
    const deleting = middleware.tx(ctx, [remove]).then(
      () => {
        settled = true
        return undefined
      },
      (err) => {
        settled = true
        return err
      }
    )
    // Let the operational write enter the first refresh's wait before replacing it.
    await new Promise<void>((resolve) => setImmediate(resolve))
    space.restricted = true
    const triggerCtx = makeContext()
    triggerCtx.contextData.broadcast.txes.push(update({ restricted: true }))
    const restricting = middleware.tx(triggerCtx, [])
    await secondRead.promise
    firstGate.resolve()
    await writing
    await new Promise<void>((resolve) => setImmediate(resolve))
    const settledBeforeRefresh = settled
    secondGate.resolve()
    await restricting
    const result = await deleting
    expect(settledBeforeRefresh).toBe(false)
    expect(result).toEqual(forbidden)
    expect(storage.txes).not.toContain(remove)
  })

  it('preserves a trigger-created restricted space during another refresh', async () => {
    const { middleware, storage, ctx, space, model } = await setup()
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
    Object.assign(permission, { txClass: core.class.TxRemoveDoc, objectClass: DOCUMENT })
    await middleware.tx(ctx, [])
    const reading = deferred()
    const gate = deferred()
    storage.afterRead = async (query) => {
      if (JSON.stringify(query._id) === JSON.stringify({ $in: [SPACE] })) {
        reading.resolve()
        await gate.promise
      }
    }
    const writing = middleware.tx(makeContext(OWNER), [update({ private: true })])
    await reading.promise
    const id = 'test:trigger-created' as Ref<TypedSpace>
    const created = factory.createTxCreateDoc(
      core.class.TypedSpace,
      core.space.Space,
      {
        name: 'Trigger',
        description: '',
        owners: [OWNER],
        members: [MEMBER],
        type: TYPE,
        restricted: true,
        private: false,
        archived: false
      },
      id
    )
    storage.documents.set(id, { ...clone(space), _id: id, restricted: true })
    const triggerCtx = makeContext()
    triggerCtx.contextData.broadcast.txes.push(created)
    await middleware.tx(triggerCtx, [])
    gate.resolve()
    await writing
    await expect(middleware.tx(ctx, [factory.createTxRemoveDoc(DOCUMENT, id, 'test:doc' as Ref<Doc>)])).rejects.toEqual(
      forbidden
    )
  })
})
