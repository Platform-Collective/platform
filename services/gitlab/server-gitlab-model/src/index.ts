// SPDX-License-Identifier: EPL-2.0

import core from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'
import serverCore from '@hcengineering/server-core'
import serverGitlab from '@hcengineering/server-gitlab'
import time from '@hcengineering/time'
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

  // A done GitLab ToDo must not move its merge request's status, and Huly's issue automation must not complete it:
  // the GitLab service completes it when its review or fix is done
  builder.createDoc(time.class.TodoAutomationHelper, core.space.Model, {
    onDoneTester: serverGitlab.functions.TodoDoneTester,
    onAutoCompleteTester: serverGitlab.functions.TodoDoneTester
  })
}
