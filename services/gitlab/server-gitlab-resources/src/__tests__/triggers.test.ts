// SPDX-License-Identifier: EPL-2.0
import chunter from '@hcengineering/chunter'
import core, { type Doc, type PersonId, type Ref, type Space, type Tx, TxFactory, type TxCreateDoc, type TxUpdateDoc } from '@hcengineering/core'
import gitlab, { type DocSyncInfo } from '@hcengineering/gitlab'
import type { TriggerControl } from '@hcengineering/server-core'
import tracker from '@hcengineering/tracker'
import { OnGitlabBroadcast, OnProjectChanges, OnProjectRemove } from '..'

const linked = 'prj-linked' as Ref<Space>
const plain = 'prj-plain' as Ref<Space>
const user = new TxFactory('user-1' as PersonId)
const system = new TxFactory(core.account.System)

interface FakeOptions {
  infos?: Array<Partial<DocSyncInfo>>
  repos?: Array<Record<string, unknown>>
  removed?: Doc[]
}

// Test double over the slice of TriggerControl the triggers use.
function fakeControl (opts: FakeOptions = {}): { control: TriggerControl, applied: Tx[] } {
  const applied: Tx[] = []
  const matches = (doc: Record<string, unknown>, query: Record<string, unknown>): boolean =>
    Object.entries(query).every(([k, v]) => doc[k] === v)
  const control = {
    ctx: { contextData: { broadcast: { targets: {}, txes: [] } } },
    txes: [],
    txFactory: new TxFactory(core.account.System, true),
    hierarchy: {
      isDerived: (a: string, b: string) => a === b,
      hasMixin: (doc: Record<string, unknown>, mixin: string) => doc[mixin] !== undefined
    },
    queryFind: async () => [{ _id: linked }],
    findAll: async (_ctx: unknown, _class: string, query: Record<string, unknown>) => {
      const source = _class === gitlab.class.DocSyncInfo ? opts.infos ?? [] : opts.repos ?? []
      return (source as Array<Record<string, unknown>>).filter((d) => matches(d, query))
    },
    removedMap: new Map((opts.removed ?? []).map((d) => [d._id, d])),
    apply: async (_ctx: unknown, txes: Tx[]) => {
      applied.push(...txes)
      return {}
    }
  }
  return { control: control as unknown as TriggerControl, applied }
}

function createIssueTx (factory: TxFactory, space: Ref<Space>, id: string): Tx {
  return factory.createTxCreateDoc(tracker.class.Issue, space, { title: 't' } as any, id as Ref<Doc>)
}

describe('OnProjectChanges', () => {
  it('queues a new issue in a GitLab-linked project', async () => {
    const { control, applied } = fakeControl()
    await OnProjectChanges([createIssueTx(user, linked, 'issue-1')], control)
    expect(applied).toHaveLength(1)
    const tx = applied[0] as TxCreateDoc<DocSyncInfo>
    expect(tx._class).toBe(core.class.TxCreateDoc)
    expect(tx.objectId).toBe('issue-1')
    expect(tx.attributes).toMatchObject({ key: '', repository: null, gitlabIid: 0, needSync: '', objectClass: tracker.class.Issue })
  })

  it('records the parent of a new comment', async () => {
    const { control, applied } = fakeControl()
    const tx = user.createTxCreateDoc(chunter.class.ChatMessage, linked, { message: 'm' } as any, 'msg-1' as Ref<Doc>)
    // Collection creates carry the parent on the tx
    ;(tx as any).attachedTo = 'issue-1'
    await OnProjectChanges([tx], control)
    expect((applied[0] as TxCreateDoc<DocSyncInfo>).attributes).toMatchObject({ attachedTo: 'issue-1', objectClass: chunter.class.ChatMessage })
  })

  it('ignores projects without GitLab', async () => {
    const { control, applied } = fakeControl()
    await OnProjectChanges([createIssueTx(user, plain, 'issue-2')], control)
    expect(applied).toEqual([])
  })

  it("ignores the GitLab service's own (System) changes", async () => {
    const { control, applied } = fakeControl()
    await OnProjectChanges([createIssueTx(system, linked, 'issue-3')], control)
    expect(applied).toEqual([])
  })

  it('marks a removed synced issue as deleted', async () => {
    const { control, applied } = fakeControl({ infos: [{ _id: 'issue-4' as Ref<DocSyncInfo>, space: linked, key: 'k' }] })
    await OnProjectChanges([user.createTxRemoveDoc(tracker.class.Issue, linked, 'issue-4' as Ref<Doc>)], control)
    expect((applied[0] as TxUpdateDoc<DocSyncInfo>).operations).toEqual({ needSync: '', deleted: true })
  })

  it('does not create sync docs for removed documents that were never synced', async () => {
    const { control, applied } = fakeControl()
    await OnProjectChanges([user.createTxRemoveDoc(tracker.class.Issue, linked, 'issue-5' as Ref<Doc>)], control)
    expect(applied).toEqual([])
  })
})

describe('OnProjectRemove', () => {
  it('unlinks the repositories and drops the sync docs of a removed GitLab project', async () => {
    const project = { _id: linked, _class: tracker.class.Project, space: core.space.Space, [gitlab.mixin.GitlabProject]: {} } as unknown as Doc
    const { control } = fakeControl({
      removed: [project],
      repos: [{ _id: 'repo-1', _class: gitlab.class.GitlabIntegrationRepository, space: core.space.Configuration, gitlabProject: linked }],
      infos: [{ _id: 'issue-1' as Ref<DocSyncInfo>, _class: gitlab.class.DocSyncInfo, space: linked }]
    })
    const result = await OnProjectRemove([user.createTxRemoveDoc(tracker.class.Project, core.space.Space, linked as unknown as Ref<Doc>)], control)
    expect(result.find((tx) => tx._class === core.class.TxUpdateDoc)).toMatchObject({
      objectId: 'repo-1',
      operations: { enabled: false, gitlabProject: null }
    })
    expect(result.find((tx) => tx._class === core.class.TxRemoveDoc)).toMatchObject({ objectId: 'issue-1' })
  })
})

describe('OnGitlabBroadcast', () => {
  it('targets DocSyncInfo changes at the system account only', async () => {
    const { control } = fakeControl()
    await OnGitlabBroadcast([], control)
    const target = (control.ctx.contextData as any).broadcast.targets.gitlab
    const syncTx = system.createTxUpdateDoc(gitlab.class.DocSyncInfo, linked, 'x' as Ref<DocSyncInfo>, { needSync: '' })
    expect(await target(syncTx)).toEqual({ target: [expect.any(String)] })
    expect(await target(createIssueTx(user, linked, 'y'))).toBeUndefined()
  })
})
