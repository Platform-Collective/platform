// SPDX-License-Identifier: EPL-2.0

import attachment from '@hcengineering/attachment'
import chunter from '@hcengineering/chunter'
import core, {
  type Class,
  type Data,
  type Doc,
  type DocumentUpdate,
  type Hierarchy,
  type Ref,
  type Space,
  type Storage,
  type Tx,
  type TxCUD,
  type TxUpdateDoc,
  type TxMixin,
  TxProcessor,
  systemAccountUuid
} from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabProject } from '@hcengineering/gitlab'
import { gitlabServiceOnlyClasses } from '@hcengineering/server-gitlab'
import type { TriggerControl } from '@hcengineering/server-core'
import type { ToDo } from '@hcengineering/time'
import tracker from '@hcengineering/tracker'

/**
 * @public
 * Sends DocSyncInfo and GitlabUpload changes only to the system account (the GitLab service), never to browsers.
 */
export async function OnGitlabBroadcast (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  control.ctx.contextData.broadcast.targets.gitlab = async (it) => {
    if (TxProcessor.isExtendsCUD(it._class) && gitlabServiceOnlyClasses.includes((it as TxCUD<Doc>).objectClass)) {
      return { target: [systemAccountUuid] }
    }
    return undefined
  }
  return []
}

// Review documents of merge requests; viewed-file marks (GitlabMergeRequestReview) stay in Huly
const REVIEW_CLASSES: Array<Ref<Class<Doc>>> = [
  gitlab.class.GitlabReview,
  gitlab.class.GitlabReviewThread,
  gitlab.class.GitlabReviewComment
]

// Issues (merge requests derive from them), comments and review documents; thread replies (ThreadMessage) are not
// synchronized
function isSyncedClass (h: Hierarchy, objectClass: Ref<Class<Doc>>): boolean {
  return (
    h.isDerived(objectClass, tracker.class.Issue) ||
    objectClass === chunter.class.ChatMessage ||
    REVIEW_CLASSES.includes(objectClass)
  )
}

// A comment gets a sync doc only when it is written on an issue or merge request
function isIssueComment (h: Hierarchy, cud: TxCUD<Doc>): boolean {
  return cud.attachedToClass !== undefined && h.isDerived(cud.attachedToClass, tracker.class.Issue)
}

interface TriggerCache {
  projects?: Set<Ref<Space>>
  // Documents whose DocSyncInfo already has a tx in this batch (applied, broadcast or queued here)
  pending: Set<Ref<Doc>>
  // DocSyncInfo of the batch's documents, loaded with one query; a missing id was never synced
  infos: Map<Ref<Doc>, DocSyncInfo>
}

function syncInfoTxIds (txes: Tx[]): Set<Ref<Doc>> {
  const ids = new Set<Ref<Doc>>()
  for (const it of txes) {
    if (TxProcessor.isExtendsCUD(it._class) && (it as TxCUD<Doc>).objectClass === gitlab.class.DocSyncInfo) {
      ids.add((it as TxCUD<Doc>).objectId)
    }
  }
  return ids
}

// One change to queue: a synced document itself, or the comment whose attachment changed
type QueuedChange =
  | {
    kind: 'document'
    cud: TxCUD<Doc>
    // The document whose DocSyncInfo is looked up
    id: Ref<Doc>
    // The new project of a moved document
    target?: Ref<Space>
  }
  | {
    kind: 'comment'
    cud: TxCUD<Doc>
    // The comment whose DocSyncInfo is looked up
    id: Ref<Doc>
  }

/**
 * @public
 * Queues Huly-side changes of issues and comments in GitLab-linked projects for the GitLab service.
 */
export async function OnProjectChanges (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  await OnGitlabBroadcast(txes, control)
  const cache: TriggerCache = {
    pending: syncInfoTxIds([...control.txes, ...control.ctx.contextData.broadcast.txes]),
    infos: new Map()
  }
  const changes: QueuedChange[] = []
  for (const tx of txes) {
    const change = await queuedChange(control, tx, cache)
    if (change !== undefined) changes.push(change)
  }
  if (changes.length === 0) return []
  const ids = [...new Set(changes.map((it) => it.id))]
  for (const info of await control.findAll(control.ctx, gitlab.class.DocSyncInfo, {
    _id: { $in: ids as Array<Ref<DocSyncInfo>> }
  })) {
    cache.infos.set(info._id, info)
  }
  // Already loaded by queuedChange; cached, so no second query
  const linked = await linkedProjects(control, cache)
  const toApply: Tx[] = []
  for (const change of changes) {
    if (change.kind === 'comment') queueCommentOfAttachment(control, change, cache, toApply)
    else queueSync(control, change, linked, cache, toApply)
  }
  if (toApply.length > 0) {
    await control.apply(control.ctx, toApply)
  }
  return []
}

// The change a tx asks to queue; undefined for txes of other classes, System writes and unlinked projects
async function queuedChange (control: TriggerControl, tx: Tx, cache: TriggerCache): Promise<QueuedChange | undefined> {
  const isGitlabIssueMixin =
    tx._class === core.class.TxMixin && (tx as TxMixin<Doc, Doc>).mixin === gitlab.mixin.GitlabIssue
  if (!isGitlabIssueMixin && !TxProcessor.isExtendsCUD(tx._class)) return undefined
  const cud = tx as TxCUD<Doc>
  // The GitLab service writes its bookkeeping as System; those changes must not queue another sync.
  if (cud.modifiedBy === core.account.System) return undefined
  const linked = await linkedProjects(control, cache)
  if (
    !isGitlabIssueMixin &&
    control.hierarchy.isDerived(cud.objectClass, attachment.class.Attachment) &&
    cud.attachedToClass === chunter.class.ChatMessage
  ) {
    // An attachment added to or removed from a synced comment changes its GitLab note
    if (cud._class !== core.class.TxCreateDoc && cud._class !== core.class.TxRemoveDoc) return undefined
    if (cud.attachedTo === undefined || !linked.has(cud.objectSpace)) return undefined
    return { kind: 'comment', cud, id: cud.attachedTo }
  }
  if (!isGitlabIssueMixin && !isSyncedClass(control.hierarchy, cud.objectClass)) return undefined
  // A move into a GitLab-linked project counts as well
  const target = movedTo(cud)
  if (!linked.has(cud.objectSpace) && (target === undefined || !linked.has(target))) return undefined
  return { kind: 'document', cud, id: cud.objectId, target }
}

async function linkedProjects (control: TriggerControl, cache: TriggerCache): Promise<Set<Ref<Space>>> {
  if (cache.projects === undefined) {
    const projects = await control.queryFind(control.ctx, gitlab.mixin.GitlabProject, {}, { projection: { _id: 1 } })
    cache.projects = new Set(projects.map((it) => it._id as Ref<Space>))
  }
  return cache.projects
}

// The new project of a moved document: an update that sets `space`
function movedTo (cud: TxCUD<Doc>): Ref<Space> | undefined {
  if (cud._class !== core.class.TxUpdateDoc) return undefined
  const space = (cud as TxUpdateDoc<Doc>).operations.space
  return typeof space === 'string' ? space : undefined
}

function queueSync (
  control: TriggerControl,
  change: Extract<QueuedChange, { kind: 'document' }>,
  linked: Set<Ref<Space>>,
  cache: TriggerCache,
  toApply: Tx[]
): void {
  const { cud, target } = change
  if (cache.pending.has(cud.objectId)) return
  const info = cache.infos.get(cud.objectId)
  if (info === undefined) {
    // Removing a document that was never synced needs nothing
    if (cud._class === core.class.TxRemoveDoc) return
    if (cud.objectClass === chunter.class.ChatMessage && !isIssueComment(control.hierarchy, cud)) return
    // Where the document is now; a never-synced document that left a linked project needs nothing
    const space = target ?? cud.objectSpace
    if (!linked.has(space)) return
    const data: Data<DocSyncInfo> = {
      key: '',
      objectClass: cud.objectClass,
      repository: null,
      gitlabIid: 0,
      needSync: ''
    }
    if (cud.attachedTo !== undefined) data.attachedTo = cud.attachedTo
    toApply.push(
      control.txFactory.createTxCreateDoc(gitlab.class.DocSyncInfo, space, data, cud.objectId as Ref<DocSyncInfo>)
    )
    cache.pending.add(cud.objectId)
    return
  }
  const update: DocumentUpdate<DocSyncInfo> =
    cud._class === core.class.TxRemoveDoc ? { needSync: '', deleted: true } : { needSync: '' }
  toApply.push(control.txFactory.createTxUpdateDoc(gitlab.class.DocSyncInfo, info.space, info._id, update))
  cache.pending.add(cud.objectId)
}

function queueCommentOfAttachment (
  control: TriggerControl,
  change: Extract<QueuedChange, { kind: 'comment' }>,
  cache: TriggerCache,
  toApply: Tx[]
): void {
  if (cache.pending.has(change.id)) return
  const info = cache.infos.get(change.id)
  // A comment not synced yet picks up its attachments when it syncs
  if (info === undefined || info.deleted === true) return
  toApply.push(control.txFactory.createTxUpdateDoc(gitlab.class.DocSyncInfo, info.space, info._id, { needSync: '' }))
  cache.pending.add(change.id)
}

/**
 * @public
 * When a GitLab-linked project is removed: unlink its repositories (the GitLab service then deletes their hooks)
 * and drop its sync docs.
 */
export async function OnProjectRemove (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const tx of txes) {
    if (tx._class !== core.class.TxRemoveDoc) continue
    const cud = tx as TxCUD<Doc>
    if (!control.hierarchy.isDerived(cud.objectClass, tracker.class.Project)) continue
    const project = control.removedMap.get(cud.objectId)
    if (project === undefined || !control.hierarchy.hasMixin(project, gitlab.mixin.GitlabProject)) continue
    const repositories = await control.findAll(control.ctx, gitlab.class.GitlabIntegrationRepository, {
      gitlabProject: cud.objectId as Ref<GitlabProject>
    })
    for (const repository of repositories) {
      result.push(
        control.txFactory.createTxUpdateDoc(repository._class, repository.space, repository._id, {
          enabled: false,
          gitlabProject: null
        })
      )
    }
    // Only what the remove tx needs: a large project has many sync docs
    for (const info of await control.findAll(
      control.ctx,
      gitlab.class.DocSyncInfo,
      { space: cud.objectId as Ref<Space> },
      { projection: { _id: 1, _class: 1, space: 1 } }
    )) {
      result.push(control.txFactory.createTxRemoveDoc(info._class, info.space, info._id))
    }
  }
  if (result.length > 0) {
    await OnGitlabBroadcast(txes, control)
  }
  return result
}

/**
 * @public
 * A GitLab ToDo is completed by the GitLab service; completing it must not advance its task's status.
 */
export async function TodoDoneTester (
  client: { findAll: Storage['findAll'], hierarchy: Hierarchy },
  todo: ToDo
): Promise<boolean> {
  return !client.hierarchy.hasMixin(todo, gitlab.mixin.GitlabTodo)
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  trigger: {
    OnProjectChanges,
    OnProjectRemove,
    OnGitlabBroadcast
  },
  functions: {
    TodoDoneTester
  }
})
