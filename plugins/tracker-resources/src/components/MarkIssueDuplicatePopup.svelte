<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { permissionsStore } from '@hcengineering/contact-resources'
  import core, {
    AccountRole,
    getCurrentAccount,
    type Doc,
    type FindOptions,
    type Ref,
    SortingOrder
  } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient, ObjectPopup } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import { type Issue } from '@hcengineering/tracker'
  import { statusStore } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'
  import { getEditableDuplicateProjectIds, markIssueDuplicate } from '../duplicate-issue'
  import { createDuplicatePickerQuery, createDuplicateTargetFilter } from '../duplicate-issue-utils'
  import tracker from '../plugin'
  import { activeProjects } from '../utils'
  import IssueStatusIcon from './issues/IssueStatusIcon.svelte'

  export let value: Issue

  const dispatch = createEventDispatcher<{ close: Issue | undefined | null }>()
  const account = getCurrentAccount()
  const isGuest =
    account.role === AccountRole.Guest ||
    account.role === AccountRole.DocGuest ||
    account.role === AccountRole.ReadOnlyGuest
  let loading = false
  let collaboratorOf = new Set<Ref<Doc>>()

  if (isGuest) {
    const collaboratorQuery = createQuery()
    collaboratorQuery.query(core.class.Collaborator, { collaborator: account.uuid }, (result) => {
      collaboratorOf = new Set(result.map((collaborator) => collaborator.attachedTo))
    })
  }

  $: editableProjects = getEditableDuplicateProjectIds(Array.from($activeProjects.values()), $permissionsStore)
  $: docQuery = createDuplicatePickerQuery($statusStore.array, editableProjects, task.statusCategory.Lost)
  $: targetFilter = createDuplicateTargetFilter(
    docQuery,
    getClient().getHierarchy(),
    isGuest ? { socialIds: account.socialIds, collaboratorOf } : undefined
  )
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
  filter={targetFilter}
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
