<!--
// Copyright © 2022 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { getCurrentEmployee } from '@hcengineering/contact'
  import core, { DocumentQuery, getCurrentAccount, Ref } from '@hcengineering/core'
  import type { PersonId } from '@hcengineering/core'
  import type { IntlString, Asset } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { Issue, IssueStatus } from '@hcengineering/tracker'
  import { IModeSelector, resolvedLocationStore } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy } from 'svelte'
  import { selectedFilterStore } from '@hcengineering/view-resources'

  import task from '@hcengineering/task'
  import tracker from '../../plugin'
  import IssuesView from '../issues/IssuesView.svelte'
  import { getSavedMyIssuesScope } from './saved-view'
  import type { MyIssuesScope } from './saved-view'

  export let config: [string, IntlString, object][] = []
  export let icon: Asset | undefined = undefined

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const account = getCurrentAccount()
  const currentScope: MyIssuesScope = {
    employee: getCurrentEmployee(),
    socialIds: account.socialIds,
    account: account.uuid
  }
  let scope = currentScope
  let scopeVersion = 0
  const dispatch = createEventDispatcher()
  let subscribed = { _id: { $in: [] as Ref<Issue>[] } }
  let query: DocumentQuery<Issue> | undefined = undefined
  let modeSelectorProps: IModeSelector | undefined = undefined
  let mode: string | undefined = undefined

  async function updateScope(creator: PersonId | undefined): Promise<void> {
    const version = ++scopeVersion
    if (creator === undefined || account.socialIds.includes(creator)) {
      if (scope.account !== currentScope.account) subscribed = { _id: { $in: [] } }
      scope = currentScope
      return
    }
    subscribed = { _id: { $in: [] } }
    scope = { employee: null, socialIds: [], account: undefined }
    try {
      const savedScope = await getSavedMyIssuesScope(client, creator)
      if (version === scopeVersion) scope = savedScope
    } catch (err) {
      console.error('Failed to resolve saved My Issues view creator', err)
    }
  }

  // Update the scope before deriving queries so synchronous resets apply in the same Svelte update.
  $: creator = $selectedFilterStore?.location.path[3] === 'my-issues' ? $selectedFilterStore.createdBy : undefined
  $: void updateScope(creator)
  $: assigned = { assignee: { $in: scope.employee === null ? [] : [scope.employee] } }
  $: created = { createdBy: { $in: scope.socialIds } }
  onDestroy(() => {
    scopeVersion++
  })

  const activeStatusQuery = createQuery()

  let activeStatuses: Ref<IssueStatus>[] = []

  $: activeStatusQuery.query(
    tracker.class.IssueStatus,
    { category: { $in: [task.statusCategory.Active, task.statusCategory.ToDo] } },
    (result) => {
      activeStatuses = result.map(({ _id }) => _id)
    }
  )

  let active: DocumentQuery<Issue>
  $: active = { status: { $in: activeStatuses }, ...assigned }

  const backlogStatusQuery = createQuery()

  let backlogStatuses: Ref<IssueStatus>[] = []
  let backlog: DocumentQuery<Issue> = {}
  $: backlogStatusQuery.query(tracker.class.IssueStatus, { category: task.statusCategory.UnStarted }, (result) => {
    backlogStatuses = result.map(({ _id }) => _id)
  })
  $: backlog = { status: { $in: backlogStatuses }, ...assigned }

  const subscribedQuery = createQuery()
  $: subscribedQuery.query(
    core.class.Collaborator,
    {
      collaborator: { $in: scope.account === undefined ? [] : [scope.account] },
      attachedToClass: { $in: hierarchy.getDescendants(tracker.class.Issue) }
    },
    (collaborators) => {
      const newSub = collaborators.map((it) => it.attachedTo as Ref<Issue>)
      const curSub = subscribed._id.$in
      if (curSub.length !== newSub.length || curSub.some((id, i) => newSub[i] !== id)) {
        subscribed = { _id: { $in: newSub } }
      }
    },
    { sort: { attachedTo: 1 }, projection: { attachedTo: 1 } }
  )

  $: queries = { assigned, active, backlog, created, subscribed }
  $: mode = $resolvedLocationStore.query?.mode ?? undefined
  $: if (mode === undefined || (queries as any)[mode] === undefined) {
    ;[[mode]] = config
  }
  $: if (mode !== undefined) {
    query = { ...(queries as any)[mode] }

    modeSelectorProps = {
      config,
      mode,
      onChange: (newMode: string) => dispatch('action', { mode: newMode })
    }
  }
</script>

{#if query !== undefined && modeSelectorProps !== undefined}
  <IssuesView {query} space={undefined} {icon} title={tracker.string.MyIssues} {modeSelectorProps} />
{/if}
