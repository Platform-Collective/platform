// SPDX-License-Identifier: EPL-2.0

import { getCurrentAccount } from '@hcengineering/core'
import { type GitlabAuthentication } from '@hcengineering/gitlab'
import { createQuery } from '@hcengineering/presentation'
import { readable } from 'svelte/store'
import gitlab from '../plugin'

/**
 * This account's GitLab connection, kept live for the settings dialog and the merge request approvals.
 * The query starts with the first subscriber and stops after the last: the OAuth landing tab loads this
 * module without a signed-in account, so nothing may run at import.
 */
export const gitlabAuthentication = readable<GitlabAuthentication | undefined>(undefined, (set) => {
  const query = createQuery(true)
  query.query(gitlab.class.GitlabAuthentication, { attachedTo: getCurrentAccount().primarySocialId }, (res) => {
    set(res[0])
  })
  return () => {
    query.unsubscribe()
  }
})
