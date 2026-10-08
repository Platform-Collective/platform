// SPDX-License-Identifier: EPL-2.0

import core from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'
import serverCore from '@hcengineering/server-core'
import serverGitlab from '@hcengineering/server-gitlab'
import tracker from '@hcengineering/tracker'

export { serverGitlabId } from '@hcengineering/server-gitlab'

export function createModel (builder: Builder): void {
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverGitlab.trigger.OnProjectChanges,
    isAsync: true
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverGitlab.trigger.OnProjectRemove,
    txMatch: {
      _class: core.class.TxRemoveDoc,
      objectClass: tracker.class.Project
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverGitlab.trigger.OnGitlabBroadcast,
    isAsync: false
  })
}
