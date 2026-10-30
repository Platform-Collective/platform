// SPDX-License-Identifier: EPL-2.0
import core, { type Tx, type TxCreateDoc } from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import { Builder } from '@hcengineering/model'
import serverCore, { type Trigger } from '@hcengineering/server-core'
import serverGitlab, { gitlabServiceOnlyClasses } from '@hcengineering/server-gitlab'
import { createModel } from '..'

let txes: Tx[] = []

beforeAll(() => {
  const builder = new Builder()
  createModel(builder)
  txes = builder.getTxes()
})

function trigger (resource: string): TxCreateDoc<Trigger> | undefined {
  return txes.find(
    (tx): tx is TxCreateDoc<Trigger> =>
      tx._class === core.class.TxCreateDoc &&
      (tx as TxCreateDoc<Trigger>).objectClass === serverCore.class.Trigger &&
      (tx as TxCreateDoc<Trigger>).attributes.trigger === resource
  )
}

describe('server-gitlab model', () => {
  it('runs the broadcast filter only for service bookkeeping', () => {
    const broadcast = trigger(serverGitlab.trigger.OnGitlabBroadcast)
    expect(broadcast?.attributes.txMatch).toEqual({ objectClass: { $in: gitlabServiceOnlyClasses } })
    expect(broadcast?.attributes.isAsync).toBe(false)
    expect(gitlabServiceOnlyClasses).toEqual([gitlab.class.DocSyncInfo, gitlab.class.GitlabUpload])
  })
})
