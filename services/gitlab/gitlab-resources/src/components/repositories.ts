// SPDX-License-Identifier: EPL-2.0

import { type IdMap, toIdMap } from '@hcengineering/core'
import { type GitlabIntegrationRepository } from '@hcengineering/gitlab'
import { createQuery } from '@hcengineering/presentation'
import { writable } from 'svelte/store'
import gitlab from '../plugin'

/** Every GitLab repository of the workspace, kept live for the picker, the header and presenters. */
export const gitlabRepositories = writable<IdMap<GitlabIntegrationRepository>>(new Map())

const query = createQuery(true)
query.query(gitlab.class.GitlabIntegrationRepository, {}, (res) => {
  gitlabRepositories.set(toIdMap(res))
})
