<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { permissionsStore } from '@hcengineering/contact-resources'
  import core, { AccountRole, getCurrentAccount, type FindOptions, type Ref } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient, ObjectPopup } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import { type Issue } from '@hcengineering/tracker'
  import { statusStore } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'
  import { getEditableDuplicateProjectIds, markIssueDuplicate } from '../duplicate-issue'
  import {
    createDuplicatePickerQuery,
    createDuplicateTargetFilter,
    DUPLICATE_PICKER_LIST_OPTIONS
  } from '../duplicate-issue-utils'
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
  const creatorQuery = createQuery()
  const socialIds = Array.isArray(account.socialIds) ? account.socialIds : []
  let loading = false
  let createdIssues: Array<Ref<Issue>> = []
  let collaboratorOf = new Set<Ref<Issue>>()

  if (isGuest) {
    const collaboratorQuery = createQuery()
    collaboratorQuery.query(core.class.Collaborator, { collaborator: account.uuid }, (result) => {
      collaboratorOf = new Set(result.map((collaborator) => collaborator.attachedTo as Ref<Issue>))
    })
  }

  $: editableProjects = getEditableDuplicateProjectIds(Array.from($activeProjects.values()), $permissionsStore)
  $: baseQuery = createDuplicatePickerQuery($statusStore.array, editableProjects, task.statusCategory.Lost, {
    source: value._id
  })
  $: if (isGuest && socialIds.length > 0) {
    creatorQuery.query(
      tracker.class.Issue,
      createDuplicatePickerQuery($statusStore.array, editableProjects, task.statusCategory.Lost, {
        source: value._id,
        creators: socialIds
      }),
      (result) => {
        createdIssues = result.map((issue) => issue._id)
      },
      { ...DUPLICATE_PICKER_LIST_OPTIONS, projection: { _id: 1 } }
    )
  }
  // Restrict the default list before its limit. Spotlight supplies its own IDs, so also filter its results.
  $: docQuery = isGuest
    ? createDuplicatePickerQuery($statusStore.array, editableProjects, task.statusCategory.Lost, {
        source: value._id,
        eligible: Array.from(new Set([...createdIssues, ...collaboratorOf]))
      })
    : baseQuery
  $: targetFilter = createDuplicateTargetFilter(
    baseQuery,
    getClient().getHierarchy(),
    isGuest ? { socialIds, collaboratorOf } : undefined
  )
  const options: FindOptions<Issue> = {
    ...DUPLICATE_PICKER_LIST_OPTIONS,
    lookup: { status: [tracker.class.IssueStatus, { category: core.class.StatusCategory }] }
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
