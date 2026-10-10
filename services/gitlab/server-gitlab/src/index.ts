// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref } from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import type { Plugin, Resource } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { TriggerFunc } from '@hcengineering/server-core'
import type { TodoDoneTester } from '@hcengineering/time'

/**
 * @public
 */
export const serverGitlabId = 'server-gitlab' as Plugin

/**
 * @public
 * Bookkeeping classes of the GitLab service. Browsers never receive their changes, and the broadcast trigger runs
 * only for batches that carry them.
 */
export const gitlabServiceOnlyClasses: Array<Ref<Class<Doc>>> = [gitlab.class.DocSyncInfo, gitlab.class.GitlabUpload]

/**
 * @public
 */
export default plugin(serverGitlabId, {
  trigger: {
    OnProjectChanges: '' as Resource<TriggerFunc>,
    OnProjectRemove: '' as Resource<TriggerFunc>,
    OnGitlabBroadcast: '' as Resource<TriggerFunc>
  },
  functions: {
    TodoDoneTester: '' as Resource<TodoDoneTester>
  }
})
