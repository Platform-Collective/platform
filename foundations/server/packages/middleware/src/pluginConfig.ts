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
import core, {
  AccountRole,
  hasAccountRole,
  roleOrder,
  type MeasureContext,
  type Tx,
  TxProcessor,
  systemAccountUuid,
  type Account,
  type Class,
  type Doc,
  type Domain,
  type Ref,
  type SessionData,
  type TxAccessLevel,
  type TxMixin,
  type TxUpdateDoc,
  type TxApplyIf,
  type TxCUD
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type TxMiddlewareResult,
  type PipelineContext
} from '@hcengineering/server-core'
import { aiBotAccountEmail } from './identity'

/**
 * Classes which may only be created, updated or removed by workspace owners, including derived classes.
 * Defined in code so the requirement does not depend on model metadata; TxAccessLevel may only add restrictions.
 * @public
 */
export const ownerOnlyClasses: Ref<Class<Doc>>[] = [
  'notification:class:WorkspaceNotificationTypeSetting' as Ref<Class<Doc>>
]

/**
 * @public
 */
export class PluginConfigurationMiddleware extends BaseMiddleware implements Middleware {
  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<PluginConfigurationMiddleware> {
    return new PluginConfigurationMiddleware(context, next)
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    if (txes.some((tx) => (tx as TxCUD<Doc>).objectSpace === core.space.Model)) {
      // Model changes could introduce new access levels
      this.restrictedDomains = undefined
    }
    const account = ctx.contextData.account
    if (account.uuid === systemAccountUuid || account.fullSocialIds.some((it) => it.value === aiBotAccountEmail)) {
      // We pass for system accounts and services.
      return await this.provideTx(ctx, txes)
    }
    const forbidden = (): Error =>
      new PlatformError(
        new Status(Severity.ERROR, platform.status.Forbidden, {
          account: account.uuid
        })
      )
    const checkTx = async (tx: Tx): Promise<void> => {
      if (TxProcessor.isExtendsCUD(tx._class)) {
        const cud = tx as TxCUD<Doc>
        if (cud.objectClass === core.class.PluginConfiguration && ctx.contextData.account.role !== AccountRole.Owner) {
          throw forbidden()
        }
        if (!(await this.isAllowedByAccessLevel(cud, account))) {
          throw forbidden()
        }
      }
    }
    for (const tx of txes) {
      await checkTx(tx)
      if (tx._class === core.class.TxApplyIf) {
        const atx = tx as TxApplyIf
        for (const t of atx.txes) {
          await checkTx(t)
        }
      }
    }
    return await this.provideTx(ctx, txes)
  }

  // Domains containing classes which require a role above User to be modified, with the highest required role
  private restrictedDomains: Map<Domain, AccountRole> | undefined

  private getRestrictedDomains (): Map<Domain, AccountRole> {
    if (this.restrictedDomains !== undefined) return this.restrictedDomains
    const h = this.context.hierarchy
    const result = new Map<Domain, AccountRole>()
    for (const _class of ownerOnlyClasses) {
      const domain = h.hasClass(_class) ? h.findDomain(_class) : undefined
      if (domain !== undefined) result.set(domain, AccountRole.Owner)
    }
    for (const _class of h.getDescendants(core.class.Doc)) {
      const required = getMaxRequiredRole(h.classHierarchyMixin(_class, core.mixin.TxAccessLevel))
      if (required === undefined) continue
      const domain = h.findDomain(_class)
      if (domain === undefined) continue
      const current = result.get(domain)
      if (current === undefined || roleOrder[required] > roleOrder[current]) {
        result.set(domain, required)
      }
    }
    this.restrictedDomains = result
    return result
  }

  /**
   * Enforce TxAccessLevel requirements above the regular user level (Maintainer, Owner)
   * for all accounts. Lower levels are handled by the guest permissions middleware.
   * For updates and removals the role check uses the stored class of the document.
   */
  private async isAllowedByAccessLevel (tx: TxCUD<Doc>, account: Account): Promise<boolean> {
    if (!this.isAllowedForClass(tx, tx.objectClass, account)) return false
    if (tx._class === core.class.TxCreateDoc) return true

    const h = this.context.hierarchy
    const domain = h.findDomain(tx.objectClass)
    if (domain === undefined) return true
    const domainRole = this.getRestrictedDomains().get(domain)
    if (domainRole === undefined || hasAccountRole(account, domainRole)) return true

    if (tx._class === core.class.TxUpdateDoc && writesClass((tx as TxUpdateDoc<Doc>).operations)) {
      // Changing the class of a document in a restricted domain is not allowed
      return false
    }
    if (tx._class === core.class.TxMixin && writesClass((tx as TxMixin<Doc, Doc>).attributes)) {
      return false
    }

    const lowLevel = this.context.lowLevelStorage
    if (lowLevel === undefined) return false
    const stored = (await lowLevel.rawFindAll(domain, { _id: tx.objectId }, { limit: 1 }))[0]
    if (stored === undefined) return true
    if (stored._class !== tx.objectClass && !h.isDerived(stored._class, tx.objectClass)) return false
    return this.isAllowedForClass(tx, stored._class, account)
  }

  private isAllowedForClass (tx: TxCUD<Doc>, _class: Ref<Class<Doc>>, account: Account): boolean {
    // Code-defined requirement, independent of model metadata
    if (this.isOwnerOnly(_class) && !hasAccountRole(account, AccountRole.Owner)) return false
    // Model access level may only add restrictions
    return hasRequiredRole(account, this.getModelAccessLevel(tx, _class))
  }

  private isOwnerOnly (_class: Ref<Class<Doc>>): boolean {
    const h = this.context.hierarchy
    return ownerOnlyClasses.some((it) => it === _class || h.isDerived(_class, it))
  }

  private getModelAccessLevel (tx: TxCUD<Doc>, _class: Ref<Class<Doc>>): unknown {
    const accessLevel = this.context.hierarchy.classHierarchyMixin(_class, core.mixin.TxAccessLevel)
    if (accessLevel == null) return undefined
    if (tx._class === core.class.TxCreateDoc) return accessLevel.createAccessLevel
    if (tx._class === core.class.TxRemoveDoc) return accessLevel.removeAccessLevel
    return accessLevel.updateAccessLevel
  }
}

/**
 * Check if update operations write the `_class` attribute, directly or through any operator,
 * including `$rename` destinations.
 */
function writesClass (operations: Record<string, any> | undefined): boolean {
  if (operations == null || typeof operations !== 'object') return false
  for (const [key, value] of Object.entries(operations)) {
    if (key === '_class') return true
    if (key.startsWith('$') && value != null && typeof value === 'object') {
      if (Object.keys(value).includes('_class')) return true
      if (key === '$rename' && Object.values(value).includes('_class')) return true
    }
  }
  return false
}

function isValidRole (role: unknown): role is AccountRole {
  return typeof role === 'string' && Object.prototype.hasOwnProperty.call(roleOrder, role)
}

/**
 * Check a model access level value. A missing value or a level up to User does not restrict anything here,
 * a malformed value (null, unknown role) is treated as invalid and never grants access.
 */
function hasRequiredRole (account: Account, required: unknown): boolean {
  if (required === undefined) return true
  if (!isValidRole(required)) return false
  return roleOrder[required] <= roleOrder[AccountRole.User] || hasAccountRole(account, required)
}

/**
 * Highest role above User required by a model access level; malformed values count as Owner.
 */
function getMaxRequiredRole (accessLevel: TxAccessLevel | null | undefined): AccountRole | undefined {
  if (accessLevel == null) return undefined
  let result: AccountRole | undefined
  for (const value of [accessLevel.createAccessLevel, accessLevel.updateAccessLevel, accessLevel.removeAccessLevel]) {
    if (value === undefined) continue
    const role = isValidRole(value) ? value : AccountRole.Owner
    if (roleOrder[role] <= roleOrder[AccountRole.User]) continue
    if (result === undefined || roleOrder[role] > roleOrder[result]) {
      result = role
    }
  }
  return result
}
