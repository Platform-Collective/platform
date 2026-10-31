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
  type PersonId,
  type Ref,
  type SessionData,
  type Tx,
  type TxCUD,
  type TxUpdateDoc
} from '@hcengineering/core'
import gitlab, { type GitlabIntegrationRepository } from '@hcengineering/gitlab'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'

/**
 * Who may change a field: an account role, or CONNECTOR for the rule `repository-enable` applies in the GitLab
 * service (workspace Maintainer, or the member who connected the repository's integration).
 */
const CONNECTOR = 'connector'
type FieldRule = AccountRole | typeof CONNECTOR

/**
 * Fields a workspace member may change on GitLab connection documents, and who may change them. Everything else
 * (host, connectedBy, gitlabUserId, projectId, ...) is written by the GitLab service only: the service picks the
 * GitLab token and host from these documents, so a member who could edit them could send another member's token to
 * a host of their choice or act with it on other projects.
 */
const MEMBER_FIELDS = new Map<Ref<Class<Doc>>, Map<string, FieldRule>>([
  // Image mode is an owner setting (ImageModeSetting)
  [gitlab.class.GitlabIntegration, new Map([['imageMode', AccountRole.Owner]])],
  // Linking a repository to a tracker project and unlinking it (project-link.ts). The sync worker activates a
  // repository on these fields alone, so they take the same check as the service's repository-enable route.
  [
    gitlab.class.GitlabIntegrationRepository,
    new Map([
      ['enabled', CONNECTOR],
      ['gitlabProject', CONNECTOR]
    ])
  ]
])

/** Finds who connected the GitLab integration of a repository; undefined when either document is missing. */
export type FindRepositoryConnector = (repository: Ref<GitlabIntegrationRepository>) => Promise<PersonId | undefined>

/**
 * True when `account` may apply `transaction`. Throws only when `findConnector` does.
 *
 * In Huly every create, update or delete of a document reaches the server as a transaction (`Tx`). A `TxCUD`
 * transaction creates, updates or removes one document: `objectClass` names the document's class, `modifiedBy` who
 * made it. Only transactions on GitLab connection documents are checked here; every other transaction is allowed.
 */
export async function isGitlabTransactionAllowed (
  account: Account,
  transaction: Tx,
  findConnector: FindRepositoryConnector
): Promise<boolean> {
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
  if (changedFields.length === 0) return false
  let needsConnector = false
  for (const field of changedFields) {
    const rule = fields.get(field)
    if (rule === undefined) return false
    if (rule === CONNECTOR) needsConnector = true
    else if (!hasAccountRole(account, rule)) return false
  }
  if (!needsConnector || hasAccountRole(account, AccountRole.Maintainer)) return true
  const connectedBy = await findConnector(documentTransaction.objectId as Ref<GitlabIntegrationRepository>)
  // The social id the client posts and the service stores as connectedBy (repository-enable compares the same)
  return connectedBy !== undefined && connectedBy === account.primarySocialId
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
    const findConnector: FindRepositoryConnector = async (repositoryId) => await this.findConnector(ctx, repositoryId)
    for (const transaction of txes) {
      if (!(await isGitlabTransactionAllowed(account, transaction, findConnector))) {
        throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, { account: account.uuid }))
      }
    }
    return await this.provideTx(ctx, txes)
  }

  private async findConnector (
    ctx: MeasureContext<SessionData>,
    repositoryId: Ref<GitlabIntegrationRepository>
  ): Promise<PersonId | undefined> {
    const [repository] = await this.provideFindAll(
      ctx,
      gitlab.class.GitlabIntegrationRepository,
      { _id: repositoryId },
      { limit: 1 }
    )
    if (repository === undefined) return undefined
    const [integration] = await this.provideFindAll(
      ctx,
      gitlab.class.GitlabIntegration,
      { _id: repository.attachedTo },
      { limit: 1 }
    )
    return integration?.connectedBy
  }
}
