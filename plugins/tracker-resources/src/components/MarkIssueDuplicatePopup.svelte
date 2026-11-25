<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { permissionsStore } from '@hcengineering/contact-resources'
  import core, { type FindOptions, SortingOrder } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { ObjectPopup } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import { joinedProjectsStore } from '@hcengineering/task-resources'
  import { type Issue } from '@hcengineering/tracker'
  import { statusStore } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'
  import { getEditableDuplicateProjectIds, markIssueDuplicate } from '../duplicate-issue'
  import { createDuplicatePickerQuery } from '../duplicate-issue-utils'
  import tracker from '../plugin'
  import IssueStatusIcon from './issues/IssueStatusIcon.svelte'

  export let value: Issue

  const dispatch = createEventDispatcher<{ close: Issue | undefined | null }>()
  let loading = false
  $: editableProjects = getEditableDuplicateProjectIds($joinedProjectsStore ?? [], $permissionsStore)
  $: docQuery = createDuplicatePickerQuery($statusStore.array, editableProjects, task.statusCategory.Lost)
  const options: FindOptions<Issue> = {
    lookup: { status: [tracker.class.IssueStatus, { category: core.class.StatusCategory }] },
    sort: { modifiedOn: SortingOrder.Descending }
  }

  async function onClose({ detail: original }: CustomEvent<Issue | undefined | null>): Promise<void> {
    if (loading) return
    if (original == null) {
      dispatch('close')
      return
    }
    loading = true
    try {
      await markIssueDuplicate(value._id, original._id)
      dispatch('close', original)
    } catch (error) {
      await setPlatformStatus(unknownError(error))
    } finally {
      loading = false
    }
  }
</script>

<ObjectPopup
  _class={tracker.class.Issue}
  {options}
  {docQuery}
  ignoreObjects={[value._id]}
  category={tracker.completion.IssueCategory}
  placeholder={tracker.string.MarkAsDuplicate}
  searchMode="spotlight"
  multiSelect={false}
  allowDeselect={false}
  shadows={true}
  width="resizable"
  {loading}
  on:close={onClose}
>
  <svelte:fragment slot="item" let:item={issue}>
    <div class="flex-center clear-mins w-full h-9">
      {#if issue?.$lookup?.status}
        <div class="icon mr-4 h-8">
          <IssueStatusIcon value={issue.$lookup.status} taskType={issue.kind} space={issue.space} size="small" />
        </div>
      {/if}
      <span class="overflow-label flex-no-shrink mr-3">{issue.identifier}</span>
      <span class="overflow-label w-full content-color">{issue.title}</span>
    </div>
  </svelte:fragment>
</ObjectPopup>
