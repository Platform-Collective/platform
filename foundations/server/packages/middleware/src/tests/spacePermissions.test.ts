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
  type ClassCollaborators,
  type Collaborator,
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
  type TxWorkspaceEvent,
  type TypedSpace,
  type WorkspaceUuid,
  WorkspaceEvent
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status, setMetadata } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import { getUpdatedAttributes, isSelfMembershipChange, SpacePermissionsMiddleware } from '../spacePermissions'
import { SpaceSecurityMiddleware } from '../spaceSecurity'
import { QueryJoinMiddleware } from '../queryJoin'
import { BroadcastMiddleware } from '../broadcast'
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

  private applyTx (tx: Tx): void {
    if (tx._class === core.class.TxApplyIf) {
      for (const child of (tx as TxApplyIf).txes) this.applyTx(child)
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

describe('typed space administration', () => {
  it.each(adminChanges)('rejects member %s before forwarding', async (_name, operations) => {
    const { middleware, storage, ctx, space } = await setup()
    const before = clone(space)
    await expect(middleware.tx(ctx, [rawUpdate(operations)])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
    expect(space).toEqual(before)
  })

  it.each(
    adminChanges.filter(([, operations]) => {
      const attributes = getUpdatedAttributes(operations)
      return attributes !== 'all' && !['_id', '_class', 'space', 'createdBy'].some((key) => attributes.has(key))
    })
  )('allows stored owner %s', async (_name, ops) => {
    const { middleware, storage } = await setup()
    // Authorization accepts owners independently of backend operator support.
    jest.spyOn(storage, 'tx').mockImplementation(async (_ctx, txes) => {
      storage.txes.push(...txes)
      return {}
    })
    await middleware.tx(makeContext(OWNER), [rawUpdate(ops)])
    expect(storage.txes).toHaveLength(1)
  })

  it.each([AccountRole.Owner, AccountRole.Admin])('allows workspace %s', async (role) => {
    const { middleware } = await setup()
    await expect(middleware.tx(makeContext(OTHER, role), [update({ owners: [OTHER] })])).resolves.toEqual({})
  })

  it.each([AccountRole.Maintainer, AccountRole.User, AccountRole.Guest])('rejects workspace %s', async (role) => {
    const { middleware } = await setup()
    await expect(middleware.tx(makeContext(OTHER, role), [update({ private: true })])).rejects.toEqual(forbidden)
  })

  it('accepts any stored owner and both system identities', async () => {
    for (const system of [false, true]) {
      const { middleware, ctx } = await setup()
      if (system) ctx.contextData.account.primarySocialId = core.account.System
      else ctx.contextData.account.uuid = systemAccountUuid
      await expect(middleware.tx(ctx, [update({ private: true })])).resolves.toEqual({})
    }
    const { middleware, space } = await setup()
    space.owners = [OTHER, MEMBER]
    await expect(middleware.tx(makeContext(), [update({ private: true })])).resolves.toEqual({})
  })

  it.each([{}, { $inc: { sequence: 1 } }, { name: 'Renamed' }, { description: 'Changed' }])(
    'does not read storage for operational updates %j after initialization',
    async (operations) => {
      const { middleware, ctx, storage } = await setup()
      await middleware.tx(ctx, [])
      storage.reads = 0
      await middleware.tx(ctx, [rawUpdate(operations)])
      expect(storage.reads).toBe(0)
    }
  )

  it.each([false, true])('preserves self membership changes (private=%s)', async (isPrivate) => {
    const { middleware, ctx, space } = await setup()
    space.private = isPrivate
    const join = middleware.tx(ctx, [update({ $push: { members: MEMBER } })])
    if (isPrivate) await expect(join).rejects.toEqual(forbidden)
    else await expect(join).resolves.toEqual({})
    await expect(middleware.tx(ctx, [update({ $pull: { members: MEMBER } })])).resolves.toEqual({})
    await expect(middleware.tx(ctx, [update({ $push: { members: MEMBER }, name: 'also' })])).rejects.toEqual(forbidden)
  })

  it.each([false, true])('accepts attribute editor self membership forms (private=%s)', async (isPrivate) => {
    const { security, storage, space } = await setup()
    space.private = isPrivate
    space.members = [OWNER]
    const other = makeContext(OTHER)
    await security.init(other)
    // The Join button of a members cell sends $push/$each with $position.
    const join = security.tx(other, [rawUpdate({ $push: { members: { $each: [OTHER], $position: 0 } } })])
    if (isPrivate) {
      await expect(join).rejects.toEqual(forbidden)
      expect(storage.txes).toEqual([])
      await expect(security.findAll(other, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
      return
    }
    await expect(join).resolves.toEqual({})
    expect(space.members).toEqual([OTHER, OWNER])
    await expect(security.findAll(other, core.class.Space, { _id: SPACE })).resolves.toHaveLength(1)
    await expect(security.tx(other, [rawUpdate({ $pull: { members: { $in: [OTHER] } } })])).resolves.toEqual({})
    expect(space.members).toEqual([OWNER])
    await expect(
      security.tx(other, [rawUpdate({ $push: { members: { $each: [OTHER, MEMBER], $position: 0 } } })])
    ).rejects.toEqual(forbidden)
    expect(space.members).toEqual([OWNER])
  })

  it.each([
    [[], [], false],
    [[core.permission.UpdateSpace], [], false],
    [[core.permission.ArchiveSpace], [], true],
    [[], [core.permission.UpdateObject], false],
    [[], [core.permission.DeleteObject], true]
  ] as Array<[Ref<Permission>[], Ref<Permission>[], boolean]>)(
    'checks archive grant %j / %j',
    async (local, global, allowed) => {
      const { middleware, ctx } = await setup(local, global)
      const result = middleware.tx(ctx, [update({ archived: true })])
      if (allowed) await expect(result).resolves.toEqual({})
      else await expect(result).rejects.toEqual(forbidden)
    }
  )

  it.each([
    [[core.permission.UpdateSpace], [], false],
    [[core.permission.ArchiveSpace], [], false],
    [[core.permission.UpdateSpace, core.permission.ArchiveSpace], [], true],
    [[core.permission.UpdateSpace], [core.permission.DeleteObject], true],
    [[], [core.permission.UpdateObject, core.permission.DeleteObject], true]
  ] as Array<[Ref<Permission>[], Ref<Permission>[], boolean]>)(
    'requires edit AND archive %j / %j',
    async (local, global, allowed) => {
      const { middleware, ctx } = await setup(local, global)
      const result = middleware.tx(ctx, [update({ owners: [MEMBER], archived: true })])
      if (allowed) await expect(result).resolves.toEqual({})
      else await expect(result).rejects.toEqual(forbidden)
    }
  )

  it.each([false, true])('accepts authoritative edit delegation (global=%s)', async (global) => {
    const { middleware, ctx } = await setup(
      global ? [] : [core.permission.UpdateSpace],
      global ? [core.permission.UpdateObject] : []
    )
    await expect(middleware.tx(ctx, [update({ owners: [MEMBER] })])).resolves.toEqual({})
  })

  it('never grants a forbid permission', async () => {
    const { middleware, ctx, model } = await setup([core.permission.UpdateSpace])
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.UpdateSpace })[0]
    permission.forbid = true
    await expect(middleware.tx(ctx, [update({ owners: [MEMBER] })])).rejects.toEqual(forbidden)
  })

  it.each([undefined, []])('keeps ownerless legacy spaces recoverable only through grants: %j', async (owners) => {
    const { middleware, ctx, space } = await setup()
    space.owners = owners
    space.createdBy = core.account.System
    await expect(middleware.tx(ctx, [update({ private: true })])).rejects.toEqual(forbidden)
    await expect(middleware.tx(makeContext(OTHER, AccountRole.Admin), [update({ private: true })])).resolves.toEqual({})
  })

  it.each(['missing type', 'missing assignment'])(
    'denies delegation with %s, keeps owner recovery',
    async (missing) => {
      const { middleware, ctx, space } = await setup([core.permission.UpdateSpace])
      if (missing === 'missing type') space.type = 'test:missing' as Ref<SpaceType>
      else Reflect.deleteProperty(space, ASSIGNMENT)
      await expect(middleware.tx(ctx, [update({ private: true })])).rejects.toEqual(forbidden)
      await expect(middleware.tx(makeContext(OWNER), [update({ private: true })])).resolves.toEqual({})
    }
  )

  it('checks the stored class even when the transaction uses Space', async () => {
    const { middleware, ctx } = await setup()
    const tx = update({ owners: [MEMBER] })
    tx.objectClass = core.class.Space
    await expect(middleware.tx(ctx, [tx])).rejects.toEqual(forbidden)
  })

  it.each([CHANNEL, DIRECT_MESSAGE, core.class.SystemSpace, TEMPLATE_CATEGORY])(
    'checks the stored class for forged untyped updates and mixins: %s',
    async (_class) => {
      for (const conditional of [false, true]) {
        for (const tx of [update({ owners: [MEMBER] }), mixin()]) {
          const { middleware, ctx, storage, space } = await setup()
          const before = clone(space)
          tx.objectClass = _class
          await expect(middleware.tx(ctx, [conditional ? wrap([tx]) : tx])).rejects.toEqual(forbidden)
          expect(storage.txes).toEqual([])
          expect(space).toEqual(before)
        }
      }
    }
  )

  it('checks unknown ids against storage instead of trusting an untyped declaration', async () => {
    const { middleware, ctx, storage, space } = await setup()
    await middleware.tx(ctx, [])
    const id = 'test:uncached' as Ref<TypedSpace>
    storage.documents.set(id, { ...clone(space), _id: id })
    for (const tx of [update({ private: true }), mixin()]) {
      tx.objectId = id
      tx.objectClass = CHANNEL
      await expect(middleware.tx(ctx, [tx])).rejects.toEqual(forbidden)
    }
    expect(storage.txes).toEqual([])
  })

  it('keeps untyped spaces and ordinary documents unchanged', async () => {
    const { middleware, ctx, space, storage } = await setup()
    space._class = core.class.Space
    await expect(middleware.tx(ctx, [update({ $push: { members: OTHER } })])).resolves.toEqual({})
    const doc = { ...space, _id: 'test:doc' as Ref<Doc>, _class: core.class.Doc, space: SPACE }
    storage.documents.set(doc._id, doc)
    const documentUpdate = factory.createTxUpdateDoc(core.class.Doc, SPACE, doc._id, {})
    await expect(middleware.tx(ctx, [documentUpdate])).resolves.toEqual({})
    const removal = factory.createTxRemoveDoc(core.class.Space, core.space.Space, SPACE)
    await expect(middleware.tx(ctx, [removal])).resolves.toEqual({})
  })

  it('keeps enforcement when optional permissions are disabled', async () => {
    setMetadata(core.metadata.DisablePermissions, true)
    try {
      const { middleware, ctx } = await setup()
      await expect(middleware.tx(ctx, [update({ owners: [MEMBER] })])).rejects.toEqual(forbidden)
    } finally {
      setMetadata(core.metadata.DisablePermissions, false)
    }
  })
})

describe('role assignments and creation', () => {
  it.each([false, true])(
    'rejects a top-level role grant followed by takeover (conditional=%s)',
    async (conditional) => {
      const { middleware, storage, ctx, space } = await setup([core.permission.UpdateSpace])
      Object.assign(space, { [ASSIGNMENT]: {} })
      const grant = rawUpdate({ [ROLE]: [MEMBER] })
      const takeover = update({ owners: [MEMBER] })
      for (const tx of [grant, takeover]) {
        await expect(middleware.tx(ctx, [conditional ? wrap([tx]) : tx])).rejects.toEqual(forbidden)
      }
      expect(storage.txes).toEqual([])
      expect(space.owners).toEqual([OWNER])
      expect(Reflect.get(space, ROLE)).toBeUndefined()
    }
  )

  it.each([false, true])('ignores stored top-level role grants for administration (global=%s)', async (global) => {
    for (const missingMixin of [false, true]) {
      const { middleware, storage, ctx, space, globalSpace } = await setup(
        global ? [] : [core.permission.UpdateSpace],
        global ? [core.permission.UpdateObject] : []
      )
      const target = global ? globalSpace : space
      const assignment = global ? GLOBAL_ASSIGNMENT : ASSIGNMENT
      Object.assign(target, { [assignment]: {}, [global ? GLOBAL_ROLE : ROLE]: [MEMBER] })
      if (missingMixin) Reflect.deleteProperty(target, assignment)
      await expect(middleware.tx(ctx, [update({ owners: [MEMBER] })])).rejects.toEqual(forbidden)
      expect(storage.txes).toEqual([])
    }
  })

  it('ignores stored top-level role grants during cache initialization and refresh', async () => {
    const { middleware, storage, ctx, space, model } = await setup([core.permission.DeleteObject])
    space.restricted = true
    Object.assign(space, { [ASSIGNMENT]: {}, [ROLE]: [MEMBER] })
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
    Object.assign(permission, { txClass: core.class.TxRemoveDoc, objectClass: DOCUMENT })
    const remove = factory.createTxRemoveDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>)
    await expect(middleware.tx(ctx, [remove])).rejects.toEqual(forbidden)
    await middleware.tx(makeContext(OWNER), [update({ private: true })])
    await expect(middleware.tx(ctx, [remove])).rejects.toEqual(forbidden)
    expect(storage.txes).toHaveLength(1)
  })

  it('rejects an unrelated mixin rename escaping to a top-level role', async () => {
    const { middleware, storage, ctx, space } = await setup([core.permission.UpdateSpace])
    Object.assign(space, { [ASSIGNMENT]: {}, [OTHER_MIXIN]: { note: [MEMBER] } })
    const grant = mixin({ $rename: { note: ROLE } })
    grant.mixin = OTHER_MIXIN
    await expect(middleware.tx(ctx, [grant])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
  })

  it('rejects another space type role mixin before a later owner type change', async () => {
    const { middleware, ctx, storage, space } = await setup([], [core.permission.UpdateSpace])
    const grant = mixin({ [GLOBAL_ROLE]: [MEMBER] })
    grant.mixin = GLOBAL_ASSIGNMENT
    await expect(middleware.tx(ctx, [grant])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
    expect(Reflect.get(space, GLOBAL_ASSIGNMENT)).toBeUndefined()
    await expect(middleware.tx(makeContext(OWNER), [update({ type: GLOBAL_TYPE })])).resolves.toEqual({})
    await expect(middleware.tx(ctx, [update({ owners: [MEMBER] })])).rejects.toEqual(forbidden)
    expect(space.owners).toEqual([OWNER])
    await expect(middleware.tx(makeContext(OWNER), [grant])).resolves.toEqual({})
  })

  it('rejects role mixins by members, permits owners and ignores unrelated applicable mixins', async () => {
    const { middleware, ctx, storage } = await setup()
    await expect(middleware.tx(ctx, [mixin()])).rejects.toEqual(forbidden)
    await expect(middleware.tx(makeContext(OWNER), [mixin()])).resolves.toEqual({})
    const other = mixin({ note: 'ok' })
    other.mixin = OTHER_MIXIN
    storage.reads = 0
    await expect(middleware.tx(ctx, [other])).resolves.toEqual({})
    expect(storage.reads).toBe(0)
  })

  it.each(['owners', `${ASSIGNMENT}.${ROLE}`, WRONG_MIXIN])('rejects malformed/inapplicable mixin %s', async (id) => {
    const { middleware, ctx, storage } = await setup()
    const tx = mixin({ '0': MEMBER })
    tx.mixin = id as Ref<Mixin<TypedSpace>>
    await expect(middleware.tx(ctx, [tx])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
  })

  it.each(['owners', 'archived'])('rejects mixin rename escaping to %s', async (destination) => {
    const { middleware, ctx, storage } = await setup()
    const tx = mixin({ $rename: { note: destination } })
    tx.mixin = OTHER_MIXIN
    await expect(middleware.tx(ctx, [tx])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
  })

  it.each([false, true])('rejects grant-self batches entirely (applyIf=%s)', async (applyIf) => {
    const { middleware, ctx, storage } = await setup()
    const txes = [mixin(), update({ owners: [MEMBER] })]
    await expect(middleware.tx(ctx, applyIf ? [wrap(txes)] : txes)).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
    await expect(middleware.tx(makeContext(OWNER), applyIf ? [wrap(txes)] : txes)).resolves.toEqual({})
  })

  it.each([false, true])('preserves create plus initialization and ownership handoff (applyIf=%s)', async (applyIf) => {
    const { middleware, ctx, storage } = await setup()
    storage.documents.delete(SPACE)
    const creation = factory.createTxCreateDoc(
      core.class.TypedSpace,
      core.space.Space,
      {
        name: 'Created',
        description: '',
        type: TYPE,
        members: [MEMBER],
        owners: [MEMBER],
        private: false,
        archived: false
      },
      SPACE
    )
    const txes = [creation, update({ owners: [OTHER] }), mixin({})]
    await expect(middleware.tx(ctx, applyIf ? [wrap(txes)] : txes)).resolves.toEqual({})
    expect((storage.documents.get(SPACE) as TypedSpace).owners).toEqual([OTHER])
  })

  it.each([{}, { [ROLE]: [] }, { [ROLE]: [OWNER] }])(
    'allows separate-request creator setup for current owners: %j',
    async (attributes) => {
      const { middleware, ctx, space, storage } = await setup([core.permission.UpdateSpace])
      Reflect.deleteProperty(space, ASSIGNMENT)
      storage.documents.delete(SPACE)
      const create = factory.createTxCreateDoc(core.class.TypedSpace, core.space.Space, { ...space }, SPACE)
      await expect(middleware.tx(ctx, [create])).resolves.toEqual({})
      const assignment = mixin(attributes)
      await expect(middleware.tx(ctx, [assignment])).resolves.toEqual({})
      expect(Reflect.get(storage.documents.get(SPACE) as Doc, ASSIGNMENT)).toEqual(attributes)
      await expect(middleware.tx(ctx, [mixin()])).rejects.toEqual(forbidden)
      expect(storage.txes).toEqual([create, assignment])
    }
  )

  it.each([MEMBER, OTHER])('rejects separate-request creator setup granting a non-owner: %s', async (assignee) => {
    const { middleware, ctx, space, storage } = await setup([core.permission.UpdateSpace])
    Reflect.deleteProperty(space, ASSIGNMENT)
    storage.documents.delete(SPACE)
    const create = factory.createTxCreateDoc(core.class.TypedSpace, core.space.Space, { ...space }, SPACE)
    await expect(middleware.tx(ctx, [create])).resolves.toEqual({})
    await expect(middleware.tx(ctx, [mixin({ [ROLE]: [OWNER, assignee] })])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([create])
    expect(Object.prototype.hasOwnProperty.call(storage.documents.get(SPACE), ASSIGNMENT)).toBe(false)
  })

  it.each([OWNER, OTHER])('uses current stored owners for separate-request creator setup: %s', async (assignee) => {
    const { middleware, ctx, space, storage } = await setup([core.permission.UpdateSpace])
    Reflect.deleteProperty(space, ASSIGNMENT)
    storage.documents.delete(SPACE)
    const create = factory.createTxCreateDoc(core.class.TypedSpace, core.space.Space, { ...space }, SPACE)
    await middleware.tx(ctx, [create])
    await middleware.tx(makeContext(OWNER), [update({ owners: [OTHER] })])
    const result = middleware.tx(ctx, [mixin({ [ROLE]: [assignee] })])
    if (assignee === OTHER) await expect(result).resolves.toEqual({})
    else await expect(result).rejects.toEqual(forbidden)
  })

  it.each([MEMBER, OTHER])('rejects duplicate-create creator grants to a stored non-owner: %s', async (assignee) => {
    const { middleware, ctx, space, storage } = await setup([core.permission.UpdateSpace])
    space.createdBy = SOCIAL
    Reflect.deleteProperty(space, ASSIGNMENT)
    const create = factory.createTxCreateDoc(
      core.class.TypedSpace,
      core.space.Space,
      { ...space, owners: [assignee] },
      SPACE
    )
    await expect(middleware.tx(ctx, [create, mixin({ [ROLE]: [assignee] })])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
    expect(Object.prototype.hasOwnProperty.call(space, ASSIGNMENT)).toBe(false)
  })

  it('does not allow two first assignments in one batch', async () => {
    const { middleware, ctx, space, storage } = await setup()
    space.createdBy = SOCIAL
    Reflect.deleteProperty(space, ASSIGNMENT)
    storage.documents.delete(SPACE)
    const create = factory.createTxCreateDoc(core.class.TypedSpace, core.space.Space, { ...space }, SPACE)
    await expect(middleware.tx(ctx, [create, mixin({}), mixin()])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
  })

  it('does not allow other users to initialize or arbitrary missing spaces to be updated', async () => {
    const { middleware, ctx, space, storage } = await setup()
    Reflect.deleteProperty(space, ASSIGNMENT)
    await expect(middleware.tx(ctx, [mixin()])).rejects.toEqual(forbidden)
    storage.documents.delete(SPACE)
    await expect(middleware.tx(ctx, [update({ owners: [MEMBER] })])).rejects.toEqual(forbidden)
    await expect(middleware.tx(ctx, [mixin()])).rejects.toEqual(forbidden)
  })

  it.each([false, true])('rejects global grant plus unauthorized edit (applyIf=%s)', async (applyIf) => {
    const { middleware, ctx, globalSpace, storage } = await setup([], [core.permission.UpdateObject])
    globalSpace.owners = [MEMBER]
    Object.assign(globalSpace, { [GLOBAL_ASSIGNMENT]: {} })
    const grant = mixin({ [GLOBAL_ROLE]: [MEMBER] })
    grant.objectId = core.space.Space
    grant.mixin = GLOBAL_ASSIGNMENT
    const txes = [grant, update({ owners: [MEMBER] })]
    await expect(middleware.tx(ctx, applyIf ? [wrap(txes)] : txes)).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
    await expect(middleware.tx(ctx, [update({ owners: [MEMBER] })])).rejects.toEqual(forbidden)
  })

  it('rejects repeated creator initialization across conditional branches', async () => {
    const { middleware, ctx, space, storage } = await setup()
    space.createdBy = SOCIAL
    Reflect.deleteProperty(space, ASSIGNMENT)
    storage.documents.delete(SPACE)
    const create = factory.createTxCreateDoc(core.class.TypedSpace, core.space.Space, { ...space }, SPACE)
    await expect(middleware.tx(ctx, [create, wrap([mixin({})]), wrap([mixin()])])).rejects.toEqual(forbidden)
  })

  it.each([false, true])('allows creation for other owners plus initial assignment (applyIf=%s)', async (applyIf) => {
    const { middleware, ctx, storage } = await setup()
    storage.documents.delete(SPACE)
    const create = factory.createTxCreateDoc(
      core.class.TypedSpace,
      core.space.Space,
      {
        name: 'Created',
        description: '',
        type: TYPE,
        members: [MEMBER],
        owners: [OTHER],
        private: false,
        archived: false
      },
      SPACE
    )
    const txes = [create, mixin()]
    await expect(middleware.tx(ctx, applyIf ? [wrap(txes)] : txes)).resolves.toEqual({})
  })

  it.each([false, true])('a failed role grant cannot authorize later writes (global=%s)', async (global) => {
    const { middleware, ctx, storage } = await setup(
      global ? [] : [core.permission.UpdateSpace],
      global ? [core.permission.UpdateObject] : []
    )
    const target = storage.documents.get(global ? core.space.Space : SPACE)
    Object.assign(target as Doc, { [global ? GLOBAL_ASSIGNMENT : ASSIGNMENT]: {} })
    const grant = mixin()
    if (global) {
      grant.objectId = core.space.Space
      grant.mixin = GLOBAL_ASSIGNMENT
      grant.attributes = { [GLOBAL_ROLE]: [MEMBER] }
    }
    storage.fail = true
    await expect(middleware.tx(makeContext(OWNER), [grant])).rejects.toThrow('storage rejected')
    storage.fail = false
    await expect(middleware.tx(ctx, [update({ owners: [MEMBER] })])).rejects.toEqual(forbidden)
  })
})

describe('composed security pipeline', () => {
  it('does not cache a create that storage silently skips', async () => {
    const { security, storage, ctx, space } = await setup()
    storage.documents.delete(SPACE)
    await security.init(ctx)
    jest.spyOn(storage, 'tx').mockResolvedValueOnce({})
    const create = factory.createTxCreateDoc(core.class.TypedSpace, core.space.Space, { ...space }, SPACE)
    await expect(security.tx(ctx, [create])).resolves.toEqual({})
    space.private = true
    space.members = [OWNER]
    storage.documents.set(SPACE, space)
    await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
  })

  it.each([core.class.TypedSpace, CHANNEL, core.class.SystemSpace])(
    'keeps stored read access after a duplicate create declaring %s',
    async (objectClass) => {
      for (const known of [false, true]) {
        const { security, storage, ctx, space } = await setup()
        space.private = true
        space.members = [OWNER]
        if (!known) storage.documents.delete(SPACE)
        await security.init(ctx)
        storage.documents.set(SPACE, space)
        const create = factory.createTxCreateDoc(
          objectClass,
          core.space.Space,
          { ...space, private: false, members: [MEMBER, OTHER] },
          SPACE
        )
        await expect(security.tx(ctx, [create])).resolves.toEqual({})
        expect(storage.documents.get(SPACE)).toBe(space)
        for (const member of [MEMBER, OTHER]) {
          await expect(security.findAll(makeContext(member), core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
        }
        await expect(security.findAll(makeContext(OWNER), core.class.Space, { _id: SPACE })).resolves.toHaveLength(1)
        await security.handleBroadcast(ctx)
        const targets = await ctx.contextData.broadcast.targets.spaceSec(
          factory.createTxUpdateDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>, {})
        )
        expect(targets).toEqual({ target: [OWNER, systemAccountUuid] })
      }
    }
  )

  it.each([{ $push: { members: MEMBER } }, { members: [OWNER, MEMBER] }, { private: false }, { archived: true }])(
    'a forbidden write leaves storage, read access and broadcasts intact: %j',
    async (ops) => {
      const { security, ctx, space, storage } = await setup()
      space.private = true
      space.members = [OWNER]
      const before = clone(space)
      await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
      await expect(security.tx(ctx, [rawUpdate(ops)])).rejects.toEqual(forbidden)
      expect(space).toEqual(before)
      expect(storage.txes).toEqual([])
      expect(ctx.contextData.broadcast.txes).toEqual([])
      await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
    }
  )

  it('a downstream rejection leaves successful authorization without cache effects', async () => {
    const { security, space, storage, ctx } = await setup()
    space.private = true
    space.members = [OWNER]
    await security.init(ctx)
    storage.fail = true
    const write = security.tx(makeContext(OWNER), [update({ $push: { members: MEMBER } })])
    await expect(write).rejects.toThrow('storage rejected')
    expect(ctx.contextData.broadcast.txes).toEqual([])
    await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
  })

  it('a successful membership change updates subsequent read access', async () => {
    const { security, ctx, space } = await setup()
    space.private = true
    space.members = [OWNER]
    await security.init(ctx)
    await security.tx(makeContext(OWNER), [update({ $push: { members: MEMBER } })])
    await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(1)
  })

  it('synchronizes successful dotted membership updates with private-space reads', async () => {
    const { security, ctx, space } = await setup()
    space.private = true
    space.members = [OWNER, MEMBER]
    await security.init(ctx)
    await security.tx(makeContext(OWNER), [rawUpdate({ 'members.1': OTHER })])
    await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
    await expect(security.findAll(makeContext(OTHER), core.class.Space, { _id: SPACE })).resolves.toHaveLength(1)
  })

  it.each([false, true])('notifies collaborator removal only after success (failure=%s)', async (failure) => {
    const { security, storage, ctx, model } = await setup()
    const collab = {
      _id: 'test:collaborator' as Ref<Collaborator>,
      _class: core.class.Collaborator,
      space: SPACE,
      attachedTo: SPACE,
      attachedToClass: core.class.TypedSpace,
      collection: 'collaborators',
      collaborator: MEMBER,
      modifiedBy: SOCIAL,
      modifiedOn: 1
    }
    storage.documents.set(collab._id, collab)
    model.addDoc({
      _id: 'test:collaborators' as Ref<ClassCollaborators<TypedSpace>>,
      _class: core.class.ClassCollaborators,
      attachedTo: core.class.TypedSpace,
      provideSecurity: true,
      fields: []
    } as unknown as ClassCollaborators<TypedSpace>)
    ctx.contextData.socialStringsToUsers.set(SOCIAL, { accontUuid: MEMBER, role: AccountRole.Guest })
    storage.fail = failure
    const tx = factory.createTxRemoveDoc(core.class.Collaborator, SPACE, collab._id)
    if (failure) {
      await expect(security.tx(ctx, [tx])).rejects.toThrow('storage rejected')
      expect(ctx.contextData.broadcast.txes).toEqual([])
    } else {
      await security.tx(ctx, [tx])
      expect(ctx.contextData.broadcast.txes).toHaveLength(1)
      expect(storage.documents.has(collab._id)).toBe(false)
      expect(storage.reads).toBe(3)
    }
  })

  it.each([false, true])('revocation commits before a racing administrative read (global=%s)', async (global) => {
    const { middleware, ctx, storage } = await setup(
      global ? [] : [core.permission.UpdateSpace],
      global ? [core.permission.UpdateObject] : []
    )
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: () => void = () => {}
    const writing = new Promise<void>((resolve) => {
      started = resolve
    })
    storage.beforeWrite = async () => {
      started()
      await gate
    }
    const revoke = mixin({ [ROLE]: [] })
    if (global) {
      revoke.objectId = core.space.Space
      revoke.mixin = GLOBAL_ASSIGNMENT
      revoke.attributes = { [GLOBAL_ROLE]: [] }
    }
    const revocation = middleware.tx(makeContext(OWNER), [revoke])
    await writing
    const racing = middleware.tx(ctx, [update({ owners: [MEMBER] })])
    const rejected = expect(racing).rejects.toEqual(forbidden)
    release()
    await revocation
    await rejected
    expect(storage.txes).toEqual([revoke])
  })
})

describe('security event broadcast order', () => {
  // Clients refresh queries on SecurityChange. If the refresh follows an already applied
  // update, the live query drops the pending notification and the UI keeps stale data.
  it.each([
    ['archive', OWNER, { archived: true }, [OWNER, MEMBER]],
    ['self-leave', MEMBER, { $pull: { members: MEMBER } }, [MEMBER]],
    ['member removal', OWNER, { members: [OWNER] }, [MEMBER]],
    ['self-join', OTHER, { $push: { members: OTHER } }, [OTHER]],
    ['privacy', OWNER, { private: true }, [OWNER, MEMBER]]
  ] as Array<[string, AccountUuid, Record<string, unknown>, AccountUuid[]]>)(
    'sends security events before the committed %s',
    async (_name, actor, operations, notified) => {
      const { storage, context, ctx: setupCtx } = await setup()
      const sent: Array<{ txes: Tx[], target?: AccountUuid }> = []
      const broadcast = new BroadcastMiddleware(context, storage, {
        broadcast: (_ctx, txes, target) => {
          sent.push({ txes, target: target as AccountUuid | undefined })
        },
        broadcastSessions: () => {}
      })
      const permissions = await SpacePermissionsMiddleware.create(setupCtx, context, broadcast)
      const security = await SpaceSecurityMiddleware.create(false, setupCtx, context, permissions)
      const ctx = makeContext(actor)
      for (const [index, account] of [OWNER, MEMBER, OTHER].entries()) {
        ctx.contextData.socialStringsToUsers.set(`test:social:${index}` as PersonId, {
          accontUuid: account,
          role: AccountRole.User
        })
      }
      await security.init(ctx)
      const tx = rawUpdate(operations)
      await security.tx(ctx, [tx])
      await security.handleBroadcast(ctx)
      const isEvent = (it: Tx): boolean =>
        it._class === core.class.TxWorkspaceEvent && (it as TxWorkspaceEvent).event === WorkspaceEvent.SecurityChange
      for (const account of notified) {
        const txes = sent.find((it) => it.target === account)?.txes ?? []
        const event = txes.findIndex(isEvent)
        expect(event).toBeGreaterThanOrEqual(0)
        expect(event).toBeLessThan(txes.findIndex((it) => it._id === tx._id))
      }
    }
  )

  it('keeps the order of earlier broadcasts and denies reads after a removal', async () => {
    const { security, storage, ctx, space } = await setup()
    space.private = true
    space.members = [OWNER, MEMBER]
    const owner = makeContext(OWNER)
    await security.init(owner)
    const earlier = rawUpdate({ name: 'earlier' })
    owner.contextData.broadcast.txes.push(earlier)
    jest.spyOn(storage, 'tx').mockImplementation(async (_ctx, txes) => {
      owner.contextData.broadcast.txes.push(...txes)
      for (const tx of txes) TxProcessor.updateDoc2Doc(space, tx as TxUpdateDoc<TypedSpace>)
      return {}
    })
    const removal = update({ members: [OWNER] })
    await security.tx(owner, [removal])
    expect(owner.contextData.broadcast.txes.map((it) => it._class)).toEqual([
      core.class.TxUpdateDoc,
      core.class.TxWorkspaceEvent,
      core.class.TxUpdateDoc
    ])
    expect(owner.contextData.broadcast.txes[0]).toBe(earlier)
    expect(owner.contextData.broadcast.txes[2]).toBe(removal)
    await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
  })
})

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

  it('requires a scalar or single-element self membership form', () => {
    expect(isSelfMembershipChange({ $push: { members: MEMBER } }, MEMBER)).toBe('join')
    expect(isSelfMembershipChange({ $pull: { members: MEMBER } }, MEMBER)).toBe('leave')
    expect(isSelfMembershipChange({ $push: { members: OTHER } }, MEMBER)).toBeUndefined()
    // Attribute editors use these forms for the Join button and member removal.
    const forms: Array<[Record<string, unknown>, 'join' | 'leave' | undefined]> = [
      [{ $push: { members: { $each: [MEMBER] } } }, 'join'],
      [{ $push: { members: { $each: [MEMBER], $position: 0 } } }, 'join'],
      [{ $pull: { members: { $in: [MEMBER] } } }, 'leave'],
      [{ $push: { members: { $each: [MEMBER, OTHER] } } }, undefined],
      [{ $push: { members: { $each: [OTHER], $position: 0 } } }, undefined],
      [{ $push: { members: { $each: [MEMBER], $position: '0' } } }, undefined],
      [{ $push: { members: { $each: [MEMBER], $slice: 1 } } }, undefined],
      [{ $push: { members: { $in: [MEMBER] } } }, undefined],
      [{ $pull: { members: { $each: [MEMBER] } } }, undefined],
      [{ $pull: { members: { $in: [MEMBER], $position: 0 } } }, undefined],
      [{ $pull: { members: { $in: [OWNER] } } }, undefined],
      [{ $pull: { members: { $in: MEMBER } } }, undefined],
      [{ $push: { members: { $each: [MEMBER] }, owners: MEMBER } }, undefined]
    ]
    for (const [operations, expected] of forms) {
      expect(isSelfMembershipChange(operations as DocumentUpdate<Doc>, MEMBER)).toBe(expected)
    }
  })
})

function deferred (): { promise: Promise<void>, resolve: () => void } {
  let complete: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: complete }
}

describe('space type and role editor authorization', () => {
  const roleEdits = [
    factory.createTxCreateDoc(
      core.class.Role,
      core.space.Model,
      {
        attachedTo: TYPE,
        attachedToClass: core.class.SpaceType,
        collection: 'roles',
        name: 'New',
        permissions: [core.permission.UpdateSpace]
      },
      'test:role:new' as Ref<Role>
    ),
    factory.createTxUpdateDoc(core.class.Role, core.space.Model, ROLE, { permissions: [core.permission.UpdateSpace] }),
    factory.createTxUpdateDoc(core.class.Role, core.space.Model, ROLE, {
      $push: { permissions: core.permission.UpdateSpace }
    }),
    factory.createTxRemoveDoc(core.class.Role, core.space.Model, ROLE),
    factory.createTxCreateDoc(
      core.class.SpaceType,
      core.space.Model,
      {
        name: 'New',
        shortDescription: '',
        descriptor: 'test:descriptor' as Ref<SpaceTypeDescriptor>,
        targetClass: ASSIGNMENT,
        roles: 0
      },
      'test:type:new' as Ref<SpaceType>
    ),
    factory.createTxUpdateDoc(core.class.SpaceType, core.space.Model, TYPE, { targetClass: GLOBAL_ASSIGNMENT }),
    factory.createTxRemoveDoc(core.class.SpaceType, core.space.Model, TYPE),
    factory.createTxMixin(ROLE, core.class.Role, core.space.Model, WRONG_MIXIN, {})
  ]

  it.each([AccountRole.User, AccountRole.Guest, AccountRole.ReadOnlyGuest, AccountRole.DocGuest])(
    'denies all type and role writes by %s before forwarding',
    async (role) => {
      for (const tx of roleEdits) {
        const { middleware, storage } = await setup()
        await expect(middleware.tx(makeContext(MEMBER, role), [tx])).rejects.toEqual(forbidden)
        expect(storage.txes).toEqual([])
      }
    }
  )

  it.each([AccountRole.Maintainer, AccountRole.Owner, AccountRole.Admin])(
    'mirrors the UI editor access for %s',
    async (role) => {
      for (const tx of roleEdits.slice(0, -1)) {
        const { middleware, storage } = await setup()
        await expect(middleware.tx(makeContext(MEMBER, role), [tx])).resolves.toEqual({})
        expect(storage.txes).toEqual([tx])
      }
    }
  )

  it.each([false, true])('allows system editor writes (system uuid=%s)', async (uuid) => {
    const { middleware, ctx } = await setup()
    if (uuid) ctx.contextData.account.uuid = systemAccountUuid
    else ctx.contextData.account.primarySocialId = core.account.System
    await expect(middleware.tx(ctx, [roleEdits[1]])).resolves.toEqual({})
  })

  it.each([false, true])('rejects local/global role escalation and takeover batches (global=%s)', async (global) => {
    const { middleware, ctx, storage } = await setup()
    const grant = factory.createTxUpdateDoc(core.class.Role, core.space.Model, global ? GLOBAL_ROLE : ROLE, {
      permissions: [global ? core.permission.UpdateObject : core.permission.UpdateSpace]
    })
    await expect(middleware.tx(ctx, [grant])).rejects.toEqual(forbidden)
    await expect(middleware.tx(ctx, [wrap([grant, update({ owners: [MEMBER] })])])).rejects.toEqual(forbidden)
    await expect(middleware.tx(ctx, [update({ owners: [MEMBER] })])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
  })

  it.each([ROLE, TYPE])('uses the stored model class for disguised edits of %s', async (id) => {
    const { middleware, ctx, storage } = await setup()
    const tx = factory.createTxUpdateDoc(core.class.Doc, core.space.Model, id, {})
    await expect(middleware.tx(ctx, [tx])).rejects.toEqual(forbidden)
    expect(storage.txes).toEqual([])
  })

  it('recomputes affected role permissions from ModelDb without storage reads', async () => {
    const { middleware, storage, ctx, model } = await setup()
    const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
    permission.txClass = core.class.TxRemoveDoc
    permission.objectClass = core.class.Doc
    permission.forbid = true
    await middleware.tx(ctx, [])
    storage.reads = 0
    const grant = factory.createTxUpdateDoc(core.class.Role, core.space.Model, ROLE, {
      $push: { permissions: core.permission.DeleteObject }
    })
    await middleware.tx(makeContext(OWNER, AccountRole.Maintainer), [grant])
    const remove = factory.createTxRemoveDoc(core.class.Doc, SPACE, 'test:doc' as Ref<Doc>)
    await expect(middleware.tx(ctx, [remove])).rejects.toEqual(forbidden)
    expect(storage.reads).toBe(0)
    await middleware.tx(makeContext(OWNER, AccountRole.Maintainer), [
      factory.createTxRemoveDoc(core.class.Role, core.space.Model, ROLE)
    ])
    await expect(middleware.tx(ctx, [remove])).resolves.toEqual({})
    expect(storage.reads).toBe(0)
  })
})

describe('immutable typed space identity', () => {
  const changes = [
    { _class: core.class.Space },
    { _id: 'test:new' },
    { space: 'test:new' },
    { createdBy: SOCIAL },
    { $unset: { createdBy: true } },
    { $rename: { name: '_class' } },
    { 'createdBy.value': SOCIAL },
    { $future: { name: 'unknown' } }
  ]

  it.each([AccountRole.User, AccountRole.Owner, AccountRole.Admin])(
    'rejects identity changes even for a stored owner or workspace %s',
    async (role) => {
      for (const operations of changes) {
        const { middleware, storage } = await setup()
        await expect(middleware.tx(makeContext(OWNER, role), [rawUpdate(operations)])).rejects.toEqual(forbidden)
        const tx = mixin({ $rename: { name: '_class' } })
        tx.mixin = OTHER_MIXIN
        await expect(middleware.tx(makeContext(OWNER, role), [tx])).rejects.toEqual(forbidden)
        expect(storage.txes).toEqual([])
      }
    }
  )

  it('rejects downgrades by a delegated space editor', async () => {
    const { middleware, ctx } = await setup([core.permission.UpdateSpace])
    await expect(middleware.tx(ctx, [rawUpdate({ _class: core.class.Space })])).rejects.toEqual(forbidden)
  })
})

describe('permission cache refresh', () => {
  it.each([false, true])(
    'does not whitelist a failed untyped create on an unknown typed id (applyIf=%s)',
    async (applyIf) => {
      const { middleware, ctx, storage, space } = await setup()
      await middleware.tx(ctx, [])
      const id = 'test:unknown' as Ref<TypedSpace>
      const typed: TypedSpace = { ...clone(space), _id: id }
      storage.documents.set(id, typed)
      const create = factory.createTxCreateDoc(
        CHANNEL,
        core.space.Space,
        { name: 'Forged', description: '', members: [MEMBER], owners: [MEMBER], private: false, archived: false },
        id
      )
      if (applyIf) {
        jest.spyOn(storage, 'tx').mockResolvedValueOnce({ success: false })
      }
      await expect(middleware.tx(ctx, applyIf ? [wrap([create])] : [create])).resolves.toEqual(
        applyIf ? { success: false } : {}
      )
      const takeover = factory.createTxUpdateDoc(CHANNEL, core.space.Space, id, { owners: [MEMBER] })
      await expect(middleware.tx(ctx, [takeover])).rejects.toEqual(forbidden)
      expect(typed.owners).toEqual([OWNER])
      expect(typed._class).toBe(core.class.TypedSpace)
    }
  )

  it('blocks every non-system space write on a failed id until its refresh recovers', async () => {
    const { middleware, storage, ctx } = await setup()
    await middleware.tx(ctx, [])
    const owner = makeContext(OWNER)
    jest.spyOn(owner, 'error').mockImplementation(() => {})
    jest.spyOn(ctx, 'error').mockImplementation(() => {})
    storage.beforeRead = async (query) => {
      if (typeof query._id === 'object') throw new Error('refresh unavailable')
    }
    const id = 'test:failed-create' as Ref<TypedSpace>
    const creation = factory.createTxCreateDoc(
      core.class.TypedSpace,
      core.space.Space,
      {
        name: 'Created',
        description: '',
        type: TYPE,
        members: [OWNER, MEMBER],
        owners: [OWNER],
        private: false,
        archived: false
      },
      id
    )
    await expect(middleware.tx(owner, [creation])).resolves.toEqual({})
    const create = factory.createTxCreateDoc(
      CHANNEL,
      core.space.Space,
      { ...creation.attributes, owners: [MEMBER] },
      id
    )
    const takeover = factory.createTxUpdateDoc(CHANNEL, core.space.Space, id, { owners: [MEMBER] })
    const operational = factory.createTxUpdateDoc(CHANNEL, core.space.Space, id, { name: 'Changed' })
    const other = factory.createTxMixin(id, CHANNEL, core.space.Space, OTHER_MIXIN, {})
    const remove = factory.createTxRemoveDoc(CHANNEL, core.space.Space, id)
    for (const tx of [create, takeover, operational, other, remove]) {
      await expect(middleware.tx(ctx, [tx])).rejects.toEqual(forbidden)
    }
    expect(storage.txes).toEqual([creation])
    const system = makeContext(systemAccountUuid)
    jest.spyOn(system, 'error').mockImplementation(() => {})
    await expect(middleware.tx(system, [operational])).resolves.toEqual({})
    storage.beforeRead = undefined
    await middleware.tx(owner, [])
    const later = factory.createTxUpdateDoc(core.class.TypedSpace, core.space.Space, id, { private: true })
    await expect(middleware.tx(ctx, [takeover])).rejects.toEqual(forbidden)
    await expect(middleware.tx(ctx, [later])).rejects.toEqual(forbidden)
    expect(storage.documents.get(id)).toMatchObject({ owners: [OWNER], _class: core.class.TypedSpace, private: false })
    await expect(middleware.tx(owner, [later])).resolves.toEqual({})
  })

  it.each([CHANNEL, DIRECT_MESSAGE, core.class.SystemSpace, TEMPLATE_CATEGORY])(
    'drops the untyped whitelist after a class rewrite from %s',
    async (_class) => {
      const { middleware, storage, ctx, space, model } = await setup()
      space._class = _class
      space.restricted = true
      const permission = model.findAllSync(core.class.Permission, { _id: core.permission.DeleteObject })[0]
      Object.assign(permission, { txClass: core.class.TxRemoveDoc, objectClass: DOCUMENT })
      await middleware.tx(ctx, [])
      const rewrite = rawUpdate({ _class: core.class.TypedSpace })
      rewrite.objectClass = _class
      await expect(middleware.tx(ctx, [rewrite])).resolves.toEqual({})
      expect(space._class).toBe(core.class.TypedSpace)
      const takeover = update({ owners: [MEMBER] })
      takeover.objectClass = _class
      await expect(middleware.tx(ctx, [takeover])).rejects.toEqual(forbidden)
      await expect(
        middleware.tx(ctx, [factory.createTxRemoveDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>)])
      ).rejects.toEqual(forbidden)
      expect(storage.txes).toEqual([rewrite])
    }
  )

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

describe('concurrent committed space security updates', () => {
  it('retries read access initialization after a committed create read-back fails', async () => {
    const { security, storage, ctx, space } = await setup()
    storage.documents.delete(SPACE)
    await security.init(ctx)
    const errors = jest.spyOn(ctx, 'error').mockImplementation(() => {})
    storage.beforeRead = async (_query, options) => {
      if (options?.projection !== undefined && options.prefix === 'security') throw new Error('read-back failed')
    }
    const create = factory.createTxCreateDoc(core.class.TypedSpace, core.space.Space, { ...space }, SPACE)
    await expect(security.tx(ctx, [create])).resolves.toEqual({})
    expect(storage.documents.has(SPACE)).toBe(true)
    expect(security.wasInit).toBe(false)
    expect(errors).toHaveBeenCalled()
    storage.beforeRead = undefined
    await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(1)
    expect(security.wasInit).toBe(true)
  })

  it('serializes create snapshots with subsequent membership revocations', async () => {
    const { security, storage, ctx, space } = await setup()
    storage.documents.delete(SPACE)
    await security.init(ctx)
    space.private = true
    const reading = deferred()
    const gate = deferred()
    let first = true
    storage.afterRead = async (_query, options) => {
      if (options?.projection !== undefined && options.prefix === 'security' && first) {
        first = false
        reading.resolve()
        await gate.promise
      }
    }
    const create = factory.createTxCreateDoc(core.class.TypedSpace, core.space.Space, { ...space }, SPACE)
    const creating = security.tx(makeContext(OWNER), [create])
    await reading.promise
    const committed = deferred()
    storage.afterWrite = committed.resolve
    const removing = security.tx(makeContext(OWNER), [update({ members: [OWNER] })])
    await committed.promise
    gate.resolve()
    await Promise.all([creating, removing])
    await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
  })

  it.each([{ members: [OWNER] }, { members: [OWNER], private: true }])(
    'resyncs read access after a committed update read-back fails: %j',
    async (operations) => {
      const { security, storage, ctx, space } = await setup()
      space.private = !operations.private
      await security.init(ctx)
      const owner = makeContext(OWNER)
      const errors = jest.spyOn(owner, 'error').mockImplementation(() => {})
      storage.beforeRead = async (query, options) => {
        if (query._id === SPACE && options?.projection !== undefined && options.prefix === 'security') {
          throw new Error('read-back failed')
        }
      }
      await expect(security.tx(owner, [update(operations)])).resolves.toEqual({})
      expect(space.members).toEqual([OWNER])
      expect(security.wasInit).toBe(false)
      expect(errors).toHaveBeenCalled()
      storage.beforeRead = async () => {
        throw new Error('resync unavailable')
      }
      await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).rejects.toThrow('resync unavailable')
      expect(security.wasInit).toBe(false)
      storage.beforeRead = undefined
      await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
      await security.handleBroadcast(owner)
      const targets = await owner.contextData.broadcast.targets.spaceSec(
        factory.createTxUpdateDoc(DOCUMENT, SPACE, 'test:doc' as Ref<Doc>, {})
      )
      expect(targets).toEqual({ target: [OWNER, systemAccountUuid] })
    }
  )

  it('serializes membership snapshots and removes read access and broadcast targets after revocation', async () => {
    const { security, storage, ctx, space } = await setup()
    space.private = true
    space.members = [OWNER]
    await security.init(ctx)
    const reading = deferred()
    const gate = deferred()
    let first = true
    storage.afterRead = async (_query, options) => {
      if (options?.projection !== undefined && options.prefix === 'security' && first) {
        first = false
        reading.resolve()
        await gate.promise
      }
    }
    const adding = security.tx(makeContext(OWNER), [update({ $push: { members: MEMBER } })])
    await reading.promise
    const removed = deferred()
    storage.afterWrite = removed.resolve
    const removing = security.tx(makeContext(OWNER), [update({ $pull: { members: MEMBER } })])
    await removed.promise
    gate.resolve()
    await Promise.all([adding, removing])
    await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
    const owner = makeContext(OWNER)
    await security.handleBroadcast(owner)
    const targets = await owner.contextData.broadcast.targets.spaceSec(
      factory.createTxUpdateDoc(core.class.Doc, SPACE, 'test:doc' as Ref<Doc>, {})
    )
    expect(targets).toEqual({ target: [OWNER, systemAccountUuid] })
  })

  it.each([
    [{ private: true }, { private: false }, { private: true }, false],
    [{ private: false }, { archived: true }, { archived: false }, true]
  ] as Array<[DocumentUpdate<TypedSpace>, DocumentUpdate<TypedSpace>, DocumentUpdate<TypedSpace>, boolean]>)(
    'keeps concurrent privacy/archive snapshots ordered: %j, %j, %j',
    async (initial, first, second, readable) => {
      const { security, storage, ctx, space } = await setup()
      Object.assign(space, initial)
      space.members = [OWNER]
      await security.init(ctx)
      const reading = deferred()
      const gate = deferred()
      let paused = false
      storage.afterRead = async (_query, options) => {
        if (options?.projection !== undefined && options.prefix === 'security' && !paused) {
          paused = true
          reading.resolve()
          await gate.promise
        }
      }
      const firstWrite = security.tx(makeContext(OWNER), [update(first)])
      await reading.promise
      const committed = deferred()
      storage.afterWrite = committed.resolve
      const secondWrite = security.tx(makeContext(OWNER), [update(second)])
      await committed.promise
      gate.resolve()
      await Promise.all([firstWrite, secondWrite])
      await expect(security.findAll(makeContext(OTHER), core.class.Space, { _id: SPACE })).resolves.toHaveLength(
        readable ? 1 : 0
      )
      await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(readable ? 1 : 0)
    }
  )

  it('does not retain duplicate member access after removal or resync', async () => {
    const { security, ctx, space } = await setup()
    space.private = true
    space.members = [OWNER, MEMBER, MEMBER]
    await security.init(ctx)
    security.wasInit = false
    await security.init(ctx)
    await security.tx(makeContext(OWNER), [update({ members: [OWNER] })])
    await expect(security.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
  })

  it('bypasses a stale client query during a security refresh', async () => {
    const { storage, ctx, context } = await setup([core.permission.UpdateSpace])
    const joiner = await QueryJoinMiddleware.create(ctx, context, storage)
    // Compose SpaceSecurity -> SpacePermissions -> QueryJoin -> storage.
    const permissions = await SpacePermissionsMiddleware.create(ctx, context, joiner)
    const composed = await SpaceSecurityMiddleware.create(false, ctx, context, permissions)
    await composed.init(ctx)
    const reading = deferred()
    const gate = deferred()
    storage.afterRead = async (_query, options) => {
      if (options?.prefix !== 'security' && options?.limit === 1) {
        reading.resolve()
        await gate.promise
      }
    }
    const stale = joiner.findAll(ctx, core.class.Space, { _id: SPACE }, { limit: 1 })
    await reading.promise
    await composed.tx(makeContext(OWNER), [update({ members: [OWNER], private: true })])
    await composed.tx(makeContext(OWNER), [mixin({ [ROLE]: [] })])
    await expect(permissions.tx(ctx, [update({ owners: [MEMBER] })])).rejects.toEqual(forbidden)
    gate.resolve()
    expect((await stale)[0].private).toBe(false)
    await expect(composed.findAll(ctx, core.class.Space, { _id: SPACE })).resolves.toHaveLength(0)
  })
})
