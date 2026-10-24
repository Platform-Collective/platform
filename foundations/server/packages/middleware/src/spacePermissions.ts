//
// Copyright © 2024 Hardcore Engineering Inc.
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
  AccountRole,
  hasAccountRole,
  type DocumentUpdate,
  type Class,
  type Doc,
  type Permission,
  type Ref,
  type Role,
  type RolesAssignment,
  type Space,
  type SpaceType,
  type Tx,
  type TxApplyIf,
  type TxCUD,
  type TxCreateDoc,
  type TxMixin,
  TxProcessor,
  type TxUpdateDoc,
  type TypedSpace,
  type MeasureContext,
  type SessionData,
  type AccountUuid,
  matchQuery
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { type Middleware, type TxMiddlewareResult, type PipelineContext } from '@hcengineering/server-core'
import contact from '@hcengineering/contact'
import { BaseMiddleware } from '@hcengineering/server-core'
import { isSystem } from './utils'

const SPACE_ADMIN_ATTRIBUTES = new Set([
  'owners',
  'members',
  'private',
  'restricted',
  'type',
  'autoJoin',
  'autoJoinForRoles'
])

const SPACE_IDENTITY_ATTRIBUTES = new Set(['_id', '_class', 'space', 'createdBy'])

/** Return updated root attributes, including both ends of a rename. Unknown operators fail closed. */
export function getUpdatedAttributes (operations: DocumentUpdate<Doc>): Set<string> | 'all' {
  const result = new Set<string>()
  for (const [key, value] of Object.entries(operations)) {
    if (!key.startsWith('$')) {
      result.add(key.split('.')[0])
      continue
    }
    if (!['$push', '$pull', '$inc', '$unset', '$update', '$rename', '$set'].includes(key)) return 'all'
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'all'
    for (const [path, destination] of Object.entries(value)) {
      result.add(path.split('.')[0])
      if (key === '$rename') {
        if (typeof destination !== 'string') return 'all'
        result.add(destination.split('.')[0])
      }
    }
  }
  return result
}

/** Check that an array operator targets exactly the current account. */
function isSelfMembershipOperand (operand: unknown, uuid: AccountUuid, key: '$each' | '$in'): boolean {
  if (operand === uuid) return true
  if (operand === null || typeof operand !== 'object' || Array.isArray(operand)) return false
  // Attribute editors push a one-element $each, optionally with a numeric $position, and pull a one-element $in.
  const allowed = key === '$each' ? ['$each', '$position'] : ['$in']
  if (!Object.keys(operand).every((name) => allowed.includes(name))) return false
  const position: unknown = Reflect.get(operand, '$position')
  if (position !== undefined && typeof position !== 'number') return false
  const values: unknown = Reflect.get(operand, key)
  return Array.isArray(values) && values.length === 1 && values[0] === uuid
}

/** Only scalar or single-element self-join and self-leave forms are member operations. */
export function isSelfMembershipChange (
  operations: DocumentUpdate<Doc>,
  uuid: AccountUuid
): 'join' | 'leave' | undefined {
  const keys = Object.keys(operations)
  if (keys.length !== 1) return
  const key = keys[0]
  if (key !== '$push' && key !== '$pull') return
  const value: unknown = operations[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  if (Object.keys(value).length !== 1) return
  const operand: unknown = Reflect.get(value, 'members')
  if (!isSelfMembershipOperand(operand, uuid, key === '$push' ? '$each' : '$in')) return
  return key === '$push' ? 'join' : 'leave'
}

interface SpaceAdministrationState {
  created: Map<Ref<Space>, Space>
  initialized: Set<Ref<Space>>
}

/**
 * @public
 */
export class SpacePermissionsMiddleware extends BaseMiddleware implements Middleware {
  private whitelistSpaces = new Set<Ref<Space>>()
  private readonly restrictedSpaces = new Set<Ref<Space>>()
  private assignmentBySpace: Record<Ref<Space>, RolesAssignment> = {}
  private permissionsBySpace: Record<Ref<Space>, Record<AccountUuid, Set<Permission>>> = {}
  private typeBySpace: Record<Ref<Space>, Ref<SpaceType>> = {}
  private administrationTail: Promise<void> = Promise.resolve()
  private readonly pendingSpaces = new Map<Ref<Space>, Promise<void>>()
  private readonly failedSpaces = new Set<Ref<Space>>()
  wasInit: Promise<void> | boolean = false

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<SpacePermissionsMiddleware> {
    return new SpacePermissionsMiddleware(context, next)
  }

  private async init (ctx: MeasureContext): Promise<void> {
    if (this.wasInit === true) {
      return
    }
    if (this.wasInit === false) {
      this.wasInit = (async () => {
        const spaces: Space[] = (await this.next?.findAll(ctx, core.class.Space, {}, { prefix: 'security' })) ?? []

        for (const space of spaces) {
          if (this.isTypedSpace(space)) {
            this.addRestrictedSpace(space)
          }
        }

        this.whitelistSpaces = new Set(spaces.filter((s) => !this.isTypedSpaceClass(s._class)).map((p) => p._id))
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

  private getPermissions (): Permission[] {
    return this.context.modelDb.findAllSync(core.class.Permission, {})
  }

  private getRoles (spaceTypeId: Ref<SpaceType>): Role[] {
    return this.context.modelDb.findAllSync(core.class.Role, { attachedTo: spaceTypeId })
  }

  private getRolePermissions (
    roles: Role[],
    assignment: RolesAssignment,
    permissions: Permission[]
  ): Record<AccountUuid, Set<Permission>> {
    const result: Record<AccountUuid, Set<Permission>> = {}
    for (const role of roles) {
      const roleMembers: AccountUuid[] = assignment[role._id] ?? []

      for (const member of roleMembers) {
        if (result[member] === undefined) {
          result[member] = new Set()
        }

        for (const permission of role.permissions) {
          const p = permissions.find((p) => p._id === permission)
          if (p === undefined) continue
          result[member].add(p)
        }
      }
    }
    return result
  }

  private addRestrictedSpace (space: TypedSpace): void {
    const spaceType = this.context.modelDb.findAllSync(core.class.SpaceType, { _id: space.type })[0]

    if (spaceType === undefined) {
      this.clearSpace(space._id)
      this.typeBySpace[space._id] = space.type
      if (space.restricted === true) this.restrictedSpaces.add(space._id)
      return
    }

    // Role grants must come from stored mixin data, without proxy fallback to top-level keys.
    const assignment: RolesAssignment = Reflect.get(space, spaceType.targetClass) ?? {}

    const allPossibleRoles = this.context.modelDb.findAllSync(core.class.Role, {})
    const requiredValues: RolesAssignment = {}
    for (const role of allPossibleRoles) {
      const v = assignment[role._id]
      if (v !== undefined) {
        requiredValues[role._id] = v
      }
    }

    const permissions = this.getRolePermissions(this.getRoles(spaceType._id), assignment, this.getPermissions())
    this.clearSpace(space._id)
    this.permissionsBySpace[space._id] = permissions
    this.assignmentBySpace[space._id] = requiredValues
    this.typeBySpace[space._id] = space.type
    if (space.restricted === true) this.restrictedSpaces.add(space._id)
  }

  private isTypedSpaceClass (_class: Ref<Class<Space>>): boolean {
    const h = this.context.hierarchy

    return h.isDerived(_class, core.class.TypedSpace)
  }

  private isTypedSpace (space: Space): space is TypedSpace {
    return this.isTypedSpaceClass(space._class)
  }

  /**
   * @private
   *
   * Checks if the required permission is present in the space for the given context
   */
  private checkPermission (
    ctx: MeasureContext<SessionData>,
    space: Ref<TypedSpace>,
    tx: TxCUD<Doc>,
    isSpace: boolean
  ): boolean {
    const account = ctx.contextData.account
    if (account.primarySocialId === core.account.System) return true
    const permissions = this.permissionsBySpace[space]?.[account.uuid] ?? []
    let withoutMatch: Permission | undefined
    for (const permission of permissions) {
      if (!isTxClassMatched(tx, permission)) continue
      if (
        permission.objectClass !== undefined &&
        !this.context.hierarchy.isDerived(getTxObjectClass(tx), permission.objectClass)
      ) {
        continue
      }
      if (permission.txMatch === undefined) {
        withoutMatch = permission
        continue
      } else {
        const checkMatch = matchQuery([tx], permission.txMatch, tx._class, this.context.hierarchy, true)
        if (checkMatch.length === 0) {
          continue
        }
      }
      return permission.forbid !== undefined ? !permission.forbid : true
    }

    if (withoutMatch !== undefined) {
      return withoutMatch.forbid !== undefined ? !withoutMatch.forbid : true
    }

    if (isSpace || !this.restrictedSpaces.has(space)) {
      return true
    }

    const attachedDocAncestors = this.context.hierarchy.getAncestors(core.class.AttachedDoc)
    const ancestors = this.context.hierarchy.getAncestors(getTxObjectClass(tx))
    const targetAncestors = ancestors.filter((a) => !attachedDocAncestors.includes(a))

    const allPermissions = this.context.modelDb.findAllSync(core.class.Permission, {
      objectClass: { $in: targetAncestors }
    })
    for (const permission of allPermissions) {
      if (!isTxClassMatched(tx, permission)) continue
      if (
        permission.objectClass !== undefined &&
        !this.context.hierarchy.isDerived(getTxObjectClass(tx), permission.objectClass)
      ) {
        continue
      }
      if (permission.txMatch === undefined) {
        return false
      } else {
        const checkMatch = matchQuery([tx], permission.txMatch, tx._class, this.context.hierarchy, true)
        if (checkMatch.length === 0) {
          continue
        }
        return false
      }
    }

    return true
  }

  private throwForbidden (): never {
    throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
  }

  // /**
  //  * @private
  //  *
  //  * Throws if the required permission is missing in the space for the given context
  //  */
  // private async needPermission (ctx: MeasureContext, space: Ref<TypedSpace>, id: Ref<Permission>): Promise<void> {
  //   if (this.checkPermission(ctx, space, id)) {
  //     return
  //   }

  //   this.throwForbidden()
  // }

  private clearSpace (spaceId: Ref<Space>): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.permissionsBySpace[spaceId]
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.assignmentBySpace[spaceId]
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.typeBySpace[spaceId]
    this.whitelistSpaces.delete(spaceId)
    this.restrictedSpaces.delete(spaceId)
  }

  private isSpaceTypeTx (tx: TxCUD<Doc>): boolean {
    const h = this.context.hierarchy
    const stored = this.context.modelDb.findObject(tx.objectId)
    return [tx.objectClass, stored?._class].some(
      (_class) =>
        _class !== undefined && (h.isDerived(_class, core.class.Role) || h.isDerived(_class, core.class.SpaceType))
    )
  }

  private rememberSpaceTypes (tx: Tx, types: Map<Ref<Doc>, Ref<SpaceType>>): void {
    if (tx._class === core.class.TxApplyIf) {
      for (const child of (tx as TxApplyIf).txes) this.rememberSpaceTypes(child, types)
    } else if (TxProcessor.isExtendsCUD(tx._class)) {
      const cud = tx as TxCUD<Doc>
      const role = this.context.modelDb.findObject<Role>(cud.objectId as Ref<Role>)
      if (role !== undefined && this.context.hierarchy.isDerived(role._class, core.class.Role)) {
        types.set(cud.objectId, role.attachedTo)
      }
    }
  }

  private collectChangedSpaces (tx: Tx, spaces: Set<Ref<Space>>, types: Map<Ref<Doc>, Ref<SpaceType>>): void {
    if (tx._class === core.class.TxApplyIf) {
      for (const child of (tx as TxApplyIf).txes) this.collectChangedSpaces(child, spaces, types)
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cud = tx as TxCUD<Doc>
    if (this.isSpaceTypeTx(cud)) {
      const role = this.context.modelDb.findObject<Role>(cud.objectId as Ref<Role>)
      const typeIds = new Set([role?.attachedTo, types.get(cud.objectId), cud.attachedTo, cud.objectId])
      for (const [spaceId, spaceTypeId] of Object.entries(this.typeBySpace)) {
        if (!typeIds.has(spaceTypeId)) continue
        if (this.context.hierarchy.isDerived(cud.objectClass, core.class.SpaceType)) {
          spaces.add(spaceId as Ref<Space>)
        } else {
          this.permissionsBySpace[spaceId as Ref<Space>] = this.getRolePermissions(
            this.getRoles(spaceTypeId),
            this.assignmentBySpace[spaceId as Ref<Space>] ?? {},
            this.getPermissions()
          )
        }
      }
      return
    }
    if (!this.context.hierarchy.isDerived(cud.objectClass, core.class.Space)) return
    // A create may have failed silently or belonged to an unmatched TxApplyIf.
    // Only a stored-class read can establish that its id is safe to whitelist.
    if (this.isAdministrationTx(tx) || tx._class === core.class.TxCreateDoc) {
      spaces.add(cud.objectId as Ref<Space>)
    } else if (tx._class === core.class.TxRemoveDoc) {
      this.clearSpace(cud.objectId as Ref<Space>)
    }
  }

  private async refreshSpaces (ctx: MeasureContext, ids: Set<Ref<Space>>): Promise<void> {
    if (ids.size === 0) return
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    for (const id of ids) this.pendingSpaces.set(id, pending)
    try {
      // Keep the last committed entries while readers wait for their replacements.
      const spaces =
        (await this.next?.findAll(ctx, core.class.Space, { _id: { $in: Array.from(ids) } }, { prefix: 'security' })) ??
        []
      const byId = new Map(spaces.map((space) => [space._id, space]))
      for (const id of ids) {
        if (this.pendingSpaces.get(id) !== pending) continue
        const space = byId.get(id)
        if (space !== undefined && this.isTypedSpace(space)) this.addRestrictedSpace(space)
        else {
          this.clearSpace(id)
          if (space !== undefined) this.whitelistSpaces.add(id)
        }
        this.failedSpaces.delete(id)
      }
    } catch (err) {
      for (const id of ids) {
        if (this.pendingSpaces.get(id) === pending) this.failedSpaces.add(id)
      }
      // Persistence already succeeded. Retry affected ids on the next request
      // without reporting the committed write as failed or clearing live grants.
      ctx.error('Failed to refresh space permissions', { ids: Array.from(ids), err })
    } finally {
      for (const id of ids) {
        if (this.pendingSpaces.get(id) === pending) this.pendingSpaces.delete(id)
      }
      release()
    }
  }

  private isSpaceAdminAttribute (attribute: string): boolean {
    if (
      SPACE_ADMIN_ATTRIBUTES.has(attribute) ||
      attribute.startsWith('_') ||
      this.context.hierarchy.isMixin(attribute as Ref<Class<Doc>>)
    ) {
      return true
    }
    const role = this.context.modelDb.findObject(attribute as Ref<Role>)
    return role !== undefined && this.context.hierarchy.isDerived(role._class, core.class.Role)
  }

  private isAdministrationTx (tx: Tx): boolean {
    if (tx._class === core.class.TxApplyIf) {
      return (tx as TxApplyIf).txes.some((child) => this.isAdministrationTx(child))
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return false
    const cudTx = tx as TxCUD<Doc>
    const h = this.context.hierarchy
    if (this.isSpaceTypeTx(cudTx)) return true
    if (!h.isDerived(cudTx.objectClass, core.class.Space)) return false
    if (tx._class === core.class.TxCreateDoc || tx._class === core.class.TxRemoveDoc) {
      return this.isTypedSpaceClass(cudTx.objectClass) || this.typeBySpace[cudTx.objectId as Ref<Space>] !== undefined
    }
    // A declared untyped class is only trustworthy for a known untyped id.
    // Unknown and typed ids must reach the stored-class authorization read.
    if (
      !this.isTypedSpaceClass(cudTx.objectClass) &&
      cudTx.objectClass !== core.class.Space &&
      this.whitelistSpaces.has(cudTx.objectId as Ref<Space>)
    ) {
      // Identity writes can turn an untyped space into a typed one. Refresh its
      // cache entry after persistence instead of retaining the untyped whitelist.
      if (tx._class === core.class.TxUpdateDoc) {
        const attributes = getUpdatedAttributes((tx as TxUpdateDoc<Doc>).operations)
        return (
          attributes === 'all' || Array.from(attributes).some((attribute) => SPACE_IDENTITY_ATTRIBUTES.has(attribute))
        )
      }
      if (tx._class === core.class.TxMixin) return '$rename' in (tx as TxMixin<Space, Space>).attributes
      return false
    }
    if (tx._class === core.class.TxMixin) {
      const mixinTx = tx as TxMixin<Space, Space>
      if (!h.isMixin(mixinTx.mixin)) return true
      // Only universally applicable mixins can skip a stored-class check safely.
      if (!h.isDerived(core.class.Space, h.getBaseClass(mixinTx.mixin))) return true
      const attributes = getUpdatedAttributes(mixinTx.attributes)
      return (
        attributes === 'all' ||
        '$rename' in mixinTx.attributes ||
        this.context.modelDb.findAllSync(core.class.SpaceType, { targetClass: mixinTx.mixin }).length > 0
      )
    }
    if (tx._class !== core.class.TxUpdateDoc) return true
    const attributes = getUpdatedAttributes((tx as TxUpdateDoc<Doc>).operations)
    return (
      attributes === 'all' ||
      Array.from(attributes).some(
        (attribute) =>
          this.isSpaceAdminAttribute(attribute) || SPACE_IDENTITY_ATTRIBUTES.has(attribute) || attribute === 'archived'
      )
    )
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    await this.init(ctx)
    // Serialize administrative reads through persistence, including global role revocations.
    // Operational writes only wait for refreshes of their own permission entries.
    const administration = txes.some((tx) => this.isAdministrationTx(tx))
    let release: (() => void) | undefined
    if (administration) {
      const previous = this.administrationTail
      this.administrationTail = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
    }
    try {
      await this.refreshSpaces(ctx, new Set(this.failedSpaces))
      const state: SpaceAdministrationState = { created: new Map(), initialized: new Set() }
      for (const tx of txes) {
        await this.checkPermissions(ctx, tx, state)
      }
      const previousTypes = new Map<Ref<Doc>, Ref<SpaceType>>()
      for (const tx of txes) this.rememberSpaceTypes(tx, previousTypes)
      const res = await this.provideTx(ctx, txes)
      const changedSpaces = new Set<Ref<Space>>()
      for (const tx of [...txes, ...ctx.contextData.broadcast.txes]) {
        this.collectChangedSpaces(tx, changedSpaces, previousTypes)
      }
      await this.refreshSpaces(ctx, changedSpaces)
      return res
    } finally {
      release?.()
    }
  }

  protected async checkPermissions (
    ctx: MeasureContext<SessionData>,
    tx: Tx,
    state: SpaceAdministrationState = { created: new Map(), initialized: new Set() }
  ): Promise<void> {
    if (tx._class === core.class.TxApplyIf) {
      // Conditional creations may only authorize initialization within their own branch.
      const branch: SpaceAdministrationState = {
        created: new Map(state.created),
        initialized: state.initialized
      }
      for (const child of (tx as TxApplyIf).txes) {
        await this.checkPermissions(ctx, child, branch)
      }
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cudTx = tx as TxCUD<Doc>
    const h = this.context.hierarchy
    const isSpace = h.isDerived(cudTx.objectClass, core.class.Space)

    const ids = [cudTx.objectSpace, ...(isSpace ? [cudTx.objectId as Ref<Space>] : [])]
    for (const id of ids) {
      let pending = this.pendingSpaces.get(id)
      while (pending !== undefined) {
        await pending
        pending = this.pendingSpaces.get(id)
      }
    }

    const account = ctx.contextData.account
    // Settings > Space types uses isOwnerOrMaintainer for both type and role editors.
    if (
      this.isSpaceTypeTx(cudTx) &&
      account.primarySocialId !== core.account.System &&
      !isSystem(account, ctx) &&
      !hasAccountRole(account, AccountRole.Maintainer)
    ) {
      this.throwForbidden()
    }
    this.checkSpacePermissions(ctx, cudTx, cudTx.objectSpace)
    if (isSpace) {
      await this.checkSpaceTypePermissions(ctx, cudTx as TxCUD<Space>, state)
      this.checkSpacePermissions(ctx, cudTx, cudTx.objectId as Ref<Space>, true)
      if (tx._class === core.class.TxCreateDoc) {
        state.created.set(cudTx.objectId as Ref<Space>, TxProcessor.createDoc2Doc(tx as TxCreateDoc<Space>))
      }
    }
  }

  private async checkSpaceTypePermissions (
    ctx: MeasureContext<SessionData>,
    cudTx: TxCUD<Space>,
    state: SpaceAdministrationState
  ): Promise<void> {
    const account = ctx.contextData.account
    if (account.primarySocialId === core.account.System || isSystem(account, ctx)) return
    if (this.context.hierarchy.isDerived(cudTx.objectClass, contact.class.PersonSpace)) {
      this.throwForbidden()
    }
    await this.checkSpaceAdministration(ctx, cudTx, state)
  }

  private hasRolePermission (space: TypedSpace, uuid: AccountUuid, permissionId: Ref<Permission>): boolean {
    const permission = this.getPermissions().find((permission) => permission._id === permissionId)
    if (permission === undefined || permission.forbid === true) return false
    const spaceType = this.context.modelDb.findAllSync(core.class.SpaceType, { _id: space.type })[0]
    if (spaceType === undefined || !this.context.hierarchy.isMixin(spaceType.targetClass)) return false
    const assignment: RolesAssignment = Reflect.get(space, spaceType.targetClass) ?? {}
    return this.getRoles(spaceType._id).some(
      (role) => role.permissions.includes(permissionId) && (assignment[role._id] ?? []).includes(uuid)
    )
  }

  private async checkSpaceAdministration (
    ctx: MeasureContext<SessionData>,
    tx: TxCUD<Space>,
    state: SpaceAdministrationState
  ): Promise<void> {
    if (tx._class !== core.class.TxUpdateDoc && tx._class !== core.class.TxMixin) return
    if (!this.isAdministrationTx(tx)) return
    const h = this.context.hierarchy
    const mixinTx = tx as TxMixin<Space, Space>
    if (tx._class === core.class.TxMixin && !h.isMixin(mixinTx.mixin)) this.throwForbidden()
    const [stored] =
      (await this.next?.findAll(ctx, core.class.Space, { _id: tx.objectId }, { limit: 1, prefix: 'security' })) ?? []
    const space = stored ?? state.created.get(tx.objectId)
    // A missing document is only valid when this request actually creates it.
    if (space === undefined) this.throwForbidden()
    if (tx._class === core.class.TxMixin && !h.isDerived(space._class, h.getBaseClass(mixinTx.mixin))) {
      this.throwForbidden()
    }
    if (!this.isTypedSpace(space)) return
    const spaceType = this.context.modelDb.findAllSync(core.class.SpaceType, { _id: space.type })[0]
    const required = new Set<Ref<Permission>>()
    if (tx._class === core.class.TxMixin) {
      // Mongo prefixes mixin update keys, but not $rename destinations. Such writes
      // can escape even an unrelated mixin and must authorize the destination too.
      const attributes = getUpdatedAttributes(mixinTx.attributes)
      if (attributes === 'all') this.throwForbidden()
      if ('$rename' in mixinTx.attributes) {
        const rename = Reflect.get(mixinTx.attributes, '$rename') as Record<string, unknown>
        for (const destination of Object.values(rename)) {
          if (typeof destination !== 'string') continue
          const root = destination.split('.')[0]
          if (SPACE_IDENTITY_ATTRIBUTES.has(root)) this.throwForbidden()
          if (root === 'archived') required.add(core.permission.ArchiveSpace)
          else if (this.isSpaceAdminAttribute(root)) {
            required.add(core.permission.UpdateSpace)
          }
        }
      }
      const isRoleMixin =
        this.context.modelDb.findAllSync(core.class.SpaceType, { targetClass: mixinTx.mixin }).length > 0
      if (!isRoleMixin && required.size === 0) return
      const account = ctx.contextData.account
      // Preserve create-then-mixin/import flows when the creator chose other owners.
      // Stored spaces only allow first setup with assignments to their current owners.
      if (
        required.size === 0 &&
        mixinTx.mixin === spaceType?.targetClass &&
        space.createdBy !== undefined &&
        account.socialIds.includes(space.createdBy) &&
        !Object.prototype.hasOwnProperty.call(space, mixinTx.mixin) &&
        !state.initialized.has(space._id)
      ) {
        const initialized = TxProcessor.updateMixin4Doc({ ...space }, mixinTx)
        const assignment: RolesAssignment = Reflect.get(initialized, mixinTx.mixin)
        if (
          (stored === undefined && state.created.has(space._id)) ||
          Object.values(assignment).every(
            (assignees) => Array.isArray(assignees) && assignees.every((uuid) => (space.owners ?? []).includes(uuid))
          )
        ) {
          state.initialized.add(space._id)
          TxProcessor.updateMixin4Doc(space, mixinTx)
          return
        }
      }
      if (isRoleMixin) required.add(core.permission.UpdateSpace)
    } else {
      const operations = (tx as TxUpdateDoc<Space>).operations
      const membership = isSelfMembershipChange(operations, ctx.contextData.account.uuid)
      if (membership === 'leave' || (membership === 'join' && !space.private)) return
      const attributes = getUpdatedAttributes(operations)
      if (attributes === 'all') this.throwForbidden()
      for (const attribute of attributes) {
        if (SPACE_IDENTITY_ATTRIBUTES.has(attribute)) this.throwForbidden()
        if (attribute === 'archived') required.add(core.permission.ArchiveSpace)
        else if (this.isSpaceAdminAttribute(attribute) || attribute === spaceType?.targetClass) {
          required.add(core.permission.UpdateSpace)
        }
      }
    }
    if (required.size === 0) return
    const account = ctx.contextData.account
    if (hasAccountRole(account, AccountRole.Owner) || (space.owners ?? []).includes(account.uuid)) return
    const [globalSpace] =
      (await this.next?.findAll(ctx, core.class.Space, { _id: core.space.Space }, { limit: 1, prefix: 'security' })) ??
      []
    for (const permission of required) {
      const globalPermission =
        permission === core.permission.ArchiveSpace ? core.permission.DeleteObject : core.permission.UpdateObject
      if (this.hasRolePermission(space, account.uuid, permission)) continue
      if (
        globalSpace !== undefined &&
        this.isTypedSpace(globalSpace) &&
        this.hasRolePermission(globalSpace, account.uuid, globalPermission)
      ) {
        continue
      }
      this.throwForbidden()
    }
  }

  private checkSpacePermissions (
    ctx: MeasureContext,
    cudTx: TxCUD<Doc>,
    targetSpaceId: Ref<Space>,
    isSpace: boolean = false
  ): void {
    const account = ctx.contextData.account
    if (
      this.failedSpaces.has(targetSpaceId) &&
      account.primarySocialId !== core.account.System &&
      !isSystem(account, ctx)
    ) {
      this.throwForbidden()
    }
    if (this.whitelistSpaces.has(targetSpaceId)) {
      return
    }
    // NOTE: move this checking logic later to be defined in some server plugins?
    // so they can contribute checks into the middleware for their custom permissions?
    if (!this.checkPermission(ctx, targetSpaceId as Ref<TypedSpace>, cudTx, isSpace)) {
      this.throwForbidden()
    }
  }
}

function isMixinUpdateTx (tx: Tx): boolean {
  return tx._class === core.class.TxMixin && Object.keys((tx as TxMixin<Doc, Doc>).attributes).length > 0
}

function isTxClassMatched (tx: Tx, permission: Permission): boolean {
  if (permission.txClass === tx._class) return true
  if (permission.txMatch === undefined && isMixinUpdateTx(tx)) {
    return permission.txClass === core.class.TxUpdateDoc
  }
  return false
}

function getTxObjectClass (tx: TxCUD<Doc>): Ref<Class<Doc>> {
  return tx._class === core.class.TxMixin ? (tx as TxMixin<Doc, Doc>).mixin : tx.objectClass
}
