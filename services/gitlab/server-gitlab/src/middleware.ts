// SPDX-License-Identifier: EPL-2.0

import core, {
  AccountRole,
  hasAccountRole,
  systemAccountUuid,
  TxProcessor,
  type Account,
  type Class,
  type Doc,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Tx,
  type TxCUD,
  type TxUpdateDoc
} from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'

/**
 * Fields a workspace member may change on GitLab connection documents, and the role it takes. Everything else
 * (host, connectedBy, gitlabUserId, projectId, ...) is written by the GitLab service only: the service picks the
 * GitLab token and host from these documents, so a member who could edit them could send another member's token to
 * a host of their choice or act with it on other projects.
 */
const MEMBER_FIELDS = new Map<Ref<Class<Doc>>, Map<string, AccountRole>>([
  // Image mode is an owner setting (ImageModeSetting)
  [gitlab.class.GitlabIntegration, new Map([['imageMode', AccountRole.Owner]])],
  // Linking a repository to a tracker project and unlinking it (project-link.ts)
  [
    gitlab.class.GitlabIntegrationRepository,
    new Map([
      ['enabled', AccountRole.User],
      ['gitlabProject', AccountRole.User]
    ])
  ]
])

/**
 * True when `account` may apply `transaction`; throws nothing.
 *
 * In Huly every create, update or delete of a document reaches the server as a transaction (`Tx`). A `TxCUD`
 * transaction creates, updates or removes one document: `objectClass` names the document's class, `modifiedBy` who
 * made it. Only transactions on GitLab connection documents are checked here; every other transaction is allowed.
 */
export function isGitlabTransactionAllowed (account: Account, transaction: Tx): boolean {
  const isDocumentTransaction = TxProcessor.isExtendsCUD(transaction._class)
  if (!isDocumentTransaction) return true
  const documentTransaction = transaction as TxCUD<Doc>
  const fields = MEMBER_FIELDS.get(documentTransaction.objectClass)
  if (fields === undefined) return true
  // The GitLab service itself, or a transaction the server derived (e.g. a repository counter): IdentityMiddleware
  // already refused a transaction from a browser that claims to be System
  const isServiceTransaction =
    account.uuid === systemAccountUuid || documentTransaction.modifiedBy === core.account.System
  if (isServiceTransaction) return true
  // Members never create or remove these documents
  if (documentTransaction._class !== core.class.TxUpdateDoc) return false
  const changedFields = Object.keys((documentTransaction as TxUpdateDoc<Doc>).operations)
  const mayChange = (field: string): boolean => {
    const role = fields.get(field)
    return role !== undefined && hasAccountRole(account, role)
  }
  return changedFields.length > 0 && changedFields.every(mayChange)
}

/**
 * @public
 * Rejects member writes to GitLab connection documents beyond the fields in MEMBER_FIELDS. `@ReadOnly()` on the
 * model is a UI hint only; this is the server-side check.
 */
export class GitlabIntegrationMiddleware extends BaseMiddleware implements Middleware {
  static async create (ctx: MeasureContext, context: PipelineContext, next?: Middleware): Promise<Middleware> {
    return new GitlabIntegrationMiddleware(context, next)
  }

  // Called with every batch of transactions a client sends, before they are stored
  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const account = ctx.contextData.account
    for (const transaction of txes) {
      if (!isGitlabTransactionAllowed(account, transaction)) {
        throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, { account: account.uuid }))
      }
    }
    return await this.provideTx(ctx, txes)
  }
}
