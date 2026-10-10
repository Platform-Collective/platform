// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import gitlab from '@hcengineering/gitlab'
import tracker from '@hcengineering/tracker'
import { removeSyncDocs, requeueSyncDocs, upsertGitlabIssueMixin } from '../sync/docs'
import { asTxOperations, createMemoryClient } from './helpers/memory'

describe('sync docs helpers', () => {
  it('requeues and removes the sync docs a query names', async () => {
    const memory = createMemoryClient()
    memory.docs.push(
      { _id: 'a', _class: gitlab.class.DocSyncInfo, space: 'p', parent: 'k', needSync: 'v1' },
      { _id: 'b', _class: gitlab.class.DocSyncInfo, space: 'p', parent: 'other', needSync: 'v1' }
    )
    const derived = asTxOperations(memory)
    await requeueSyncDocs(derived, { parent: 'k' })
    expect(memory.docs.find((d) => d._id === 'a')).toMatchObject({ needSync: '' })
    expect(memory.docs.find((d) => d._id === 'b')).toMatchObject({ needSync: 'v1' })
    await removeSyncDocs(derived, { parent: 'k' })
    expect(memory.docs.map((d) => d._id)).toEqual(['b'])
  })

  it('creates the GitlabIssue mixin once and updates it afterwards', async () => {
    const memory = createMemoryClient()
    memory.docs.push({ _id: 'i1', _class: tracker.class.Issue, space: 'p' })
    const client = asTxOperations(memory)
    const issue = (): any => memory.docs.find((d) => d._id === 'i1')
    await upsertGitlabIssueMixin(client, issue(), { url: 'https://gitlab.example/p/-/issues/1' as any, gitlabIid: 1 })
    await upsertGitlabIssueMixin(client, issue(), { url: 'https://gitlab.example/p/-/issues/2' as any, gitlabIid: 2 })
    expect(client.getHierarchy().as(issue(), gitlab.mixin.GitlabIssue)).toMatchObject({
      url: 'https://gitlab.example/p/-/issues/2',
      gitlabIid: 2
    })
  })
})
