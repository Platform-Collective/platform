//
// Copyright © 2026 Hardcore Engineering Inc.
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
  hasAccountRole,
  AccountRole,
  type Doc,
  type MeasureContext,
  type SessionData,
  type Tx,
  type TxCUD,
  TxProcessor,
  systemAccountUuid
} from '@hcengineering/core'
import { DOMAIN_WORKSPACE_NOTIFICATION } from '@hcengineering/notification'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'

/**
 * Workspace-wide notification defaults may only be created, changed or removed by workspace owners.
 * @public
 */
export class WorkspaceNotificationDefaultsMiddleware extends BaseMiddleware implements Middleware {
  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next?: Middleware
  ): Promise<WorkspaceNotificationDefaultsMiddleware> {
    return new WorkspaceNotificationDefaultsMiddleware(context, next)
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const { account, admin } = ctx.contextData
    const allowed = account.uuid === systemAccountUuid || admin === true || hasAccountRole(account, AccountRole.Owner)
    if (!allowed) {
      for (const tx of txes) {
        if (
          TxProcessor.isExtendsCUD(tx._class) &&
          this.context.hierarchy.findDomain((tx as TxCUD<Doc>).objectClass) === DOMAIN_WORKSPACE_NOTIFICATION
        ) {
          throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
        }
      }
    }
    return await this.provideTx(ctx, txes)
  }
}
