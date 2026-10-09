// SPDX-License-Identifier: EPL-2.0

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
