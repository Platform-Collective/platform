<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type DocumentQuery, type Ref } from '@hcengineering/core'
  import { type GitlabMergeRequest, type GitlabProject } from '@hcengineering/gitlab'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import tracker, { type IssueStatus, type Project } from '@hcengineering/tracker'
  import { type IModeSelector, resolvedLocationStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import MergeRequestsView from './MergeRequestsView.svelte'

  export let currentSpace: Ref<GitlabProject> | undefined = undefined
  export let title: IntlString
  export let config: Array<[string, IntlString, object]>

  const dispatch = createEventDispatcher()
  const closedCategories = [task.statusCategory.Won, task.statusCategory.Lost]

  let archived: Array<Ref<Project>> = []
  const archivedQuery = createQuery()
  archivedQuery.query(
    tracker.class.Project,
    { archived: true },
    (res) => {
      archived = res.map((it) => it._id)
    },
    { projection: { _id: 1 } }
  )

  let openStatuses: Array<Ref<IssueStatus>> = []
  let closedStatuses: Array<Ref<IssueStatus>> = []
  const statusQuery = createQuery()
  statusQuery.query(tracker.class.IssueStatus, {}, (res) => {
    const isClosed = (it: IssueStatus): boolean => it.category !== undefined && closedCategories.includes(it.category)
    openStatuses = res.filter((it) => !isClosed(it)).map((it) => it._id)
    closedStatuses = res.filter(isClosed).map((it) => it._id)
  })

  $: spaceQuery =
    currentSpace !== undefined ? { space: currentSpace } : { space: { $nin: archived as Array<Ref<GitlabProject>> } }
  $: queries = {
    all: { ...spaceQuery },
    active: { ...spaceQuery, status: { $in: openStatuses } },
    closed: { ...spaceQuery, status: { $in: closedStatuses } }
  } as Record<string, DocumentQuery<GitlabMergeRequest>>

  let mode: string | undefined
  $: mode = $resolvedLocationStore.query?.mode ?? undefined
  $: if (mode === undefined || queries[mode] === undefined) {
    ;[[mode]] = config
  }
  $: query = mode !== undefined ? queries[mode] : undefined
  let modeSelectorProps: IModeSelector | undefined
  $: modeSelectorProps =
    mode !== undefined
      ? { config, mode, onChange: (newMode: string) => dispatch('action', { mode: newMode }) }
      : undefined
</script>

{#if query !== undefined && modeSelectorProps !== undefined}
  {#key `${mode}:${currentSpace}`}
    <MergeRequestsView {query} space={currentSpace} {title} {modeSelectorProps} />
  {/key}
{/if}
