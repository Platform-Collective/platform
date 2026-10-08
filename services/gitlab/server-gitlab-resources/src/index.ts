// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import core, {
  type Class,
  type Data,
  type Doc,
  type DocumentUpdate,
  type Hierarchy,
  type Ref,
  type Space,
  type Tx,
  type TxCUD,
  type TxMixin,
  TxProcessor,
  systemAccountUuid
} from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabProject } from '@hcengineering/gitlab'
import type { TriggerControl } from '@hcengineering/server-core'
import tracker from '@hcengineering/tracker'

/**
 * @public
 * Sends DocSyncInfo changes only to the system account (the GitLab service), never to browsers.
 */
export async function OnGitlabBroadcast (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  control.ctx.contextData.broadcast.targets.gitlab = async (it) => {
    if (TxProcessor.isExtendsCUD(it._class) && (it as TxCUD<Doc>).objectClass === gitlab.class.DocSyncInfo) {
      return { target: [systemAccountUuid] }
    }
    return undefined
  }
  return []
}

function isSyncedClass (h: Hierarchy, objectClass: Ref<Class<Doc>>): boolean {
  return h.isDerived(objectClass, tracker.class.Issue) || h.isDerived(objectClass, chunter.class.ChatMessage)
}

interface TriggerCache {
  projects?: Set<Ref<Space>>
}

/**
 * @public
 * Queues Huly-side changes of issues and comments in GitLab-linked projects for the GitLab service.
 */
export async function OnProjectChanges (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  await OnGitlabBroadcast(txes, control)
  const cache: TriggerCache = {}
  const toApply: Tx[] = []
  for (const tx of txes) {
    if (tx._class === core.class.TxMixin && (tx as TxMixin<Doc, Doc>).mixin === gitlab.mixin.GitlabIssue) {
      await queueSync(control, tx as TxCUD<Doc>, cache, toApply)
      continue
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) continue
    const cud = tx as TxCUD<Doc>
    if (isSyncedClass(control.hierarchy, cud.objectClass)) {
      await queueSync(control, cud, cache, toApply)
    }
  }
  if (toApply.length > 0) {
    await control.apply(control.ctx, toApply)
  }
  return []
}

async function linkedProjects (control: TriggerControl, cache: TriggerCache): Promise<Set<Ref<Space>>> {
  if (cache.projects === undefined) {
    const projects = await control.queryFind(control.ctx, gitlab.mixin.GitlabProject, {}, { projection: { _id: 1 } })
    cache.projects = new Set(projects.map((it) => it._id as Ref<Space>))
  }
  return cache.projects
}

async function queueSync (control: TriggerControl, cud: TxCUD<Doc>, cache: TriggerCache, toApply: Tx[]): Promise<void> {
  // The GitLab service writes its bookkeeping as System; those changes must not queue another sync.
  if (cud.modifiedBy === core.account.System) return
  const pending = [...control.txes, ...control.ctx.contextData.broadcast.txes, ...toApply].some(
    (it) =>
      TxProcessor.isExtendsCUD(it._class) &&
      (it as TxCUD<Doc>).objectClass === gitlab.class.DocSyncInfo &&
      (it as TxCUD<Doc>).objectId === cud.objectId
  )
  if (pending) return
  const space = cud.objectSpace
  if (!(await linkedProjects(control, cache)).has(space)) return

  const info = (await control.findAll(control.ctx, gitlab.class.DocSyncInfo, { _id: cud.objectId as Ref<DocSyncInfo> }))[0]
  if (info === undefined) {
    // Removing a document that was never synced needs nothing
    if (cud._class === core.class.TxRemoveDoc) return
    const data: Data<DocSyncInfo> = { key: '', objectClass: cud.objectClass, repository: null, gitlabIid: 0, needSync: '' }
    if (cud.attachedTo !== undefined) data.attachedTo = cud.attachedTo
    toApply.push(control.txFactory.createTxCreateDoc(gitlab.class.DocSyncInfo, space, data, cud.objectId as Ref<DocSyncInfo>))
    return
  }
  const update: DocumentUpdate<DocSyncInfo> =
    cud._class === core.class.TxRemoveDoc ? { needSync: '', deleted: true } : { needSync: '' }
  toApply.push(control.txFactory.createTxUpdateDoc(gitlab.class.DocSyncInfo, info.space, info._id, update))
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
    for (const info of await control.findAll(control.ctx, gitlab.class.DocSyncInfo, { space: cud.objectId as Ref<Space> })) {
      result.push(control.txFactory.createTxRemoveDoc(info._class, info.space, info._id))
    }
  }
  if (result.length > 0) {
    await OnGitlabBroadcast(txes, control)
  }
  return result
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  trigger: {
    OnProjectChanges,
    OnProjectRemove,
    OnGitlabBroadcast
  }
})
