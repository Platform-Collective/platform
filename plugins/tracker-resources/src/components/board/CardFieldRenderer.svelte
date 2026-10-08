<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { AttachmentsPresenter } from '@hcengineering/attachment-resources'
  import { ChatMessagesPresenter } from '@hcengineering/chunter-resources'
  import type { Doc, Ref, WithLookup } from '@hcengineering/core'
  import notification from '@hcengineering/notification'
  import { getClient } from '@hcengineering/presentation'
  import tags from '@hcengineering/tags'
  import { getFieldValue, type Issue, type Project, type ProjectField } from '@hcengineering/tracker'
  import { Component, tooltip } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import type { BuildModelKey } from '@hcengineering/view'
  import { openDoc } from '@hcengineering/view-resources'

  import { hasCardFooter, planCardFields, type CardChip } from '../../board/cardFields'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import CustomFieldPresenter from '../../projectFields/CustomFieldPresenter.svelte'
  import ComponentEditor from '../components/ComponentEditor.svelte'
  import MilestoneEditor from '../milestones/MilestoneEditor.svelte'
  import AssigneeEditor from '../issues/AssigneeEditor.svelte'
  import DueDatePresenter from '../issues/DueDatePresenter.svelte'
  import SubIssuesSelector from '../issues/edit/SubIssuesSelector.svelte'
  import IssuePresenter from '../issues/IssuePresenter.svelte'
  import ParentNamesPresenter from '../issues/ParentNamesPresenter.svelte'
  import PriorityEditor from '../issues/PriorityEditor.svelte'
  import StatusEditor from '../issues/StatusEditor.svelte'
  import EstimationEditor from '../issues/timereport/EstimationEditor.svelte'

  // Body of a card of the board. The title, the identifier and the status marker are always shown; the other
  // fields follow the field list of the view (see `planCardFields`).
  export let issue: WithLookup<Issue>
  export let config: Array<string | BuildModelKey>
  export let space: Ref<Project> | undefined = undefined
  export let currentProject: Project | undefined = undefined

  const client = getClient()

  $: plan = planCardFields(config)
  $: registry = sharedProjectFieldsStore(issue.space)

  // Labels render compressed until they are known to fit; once they are full the card keeps it
  let labelsFull = false

  $: reports =
    issue.reportedTime + (issue.childInfo ?? []).map((it) => it.reportedTime).reduce((a, b) => a + b, 0)
  $: childEstimation = (issue.childInfo ?? []).map((it) => it.estimation).reduce((a, b) => a + b, 0)
  $: withFooter = hasCardFooter(plan, {
    reportedTime: reports,
    childEstimation,
    comments: issue.comments ?? 0,
    parentComments: issue.$lookup?.attachedTo?.comments ?? 0,
    attachments: issue.attachments ?? 0
  })

  // The parent issue of a sub-issue, whose comments are shown on the card as well
  $: parent = issue.$lookup?.attachedTo as Doc

  // A custom field chip is shown for the fields the issue has a value for, like GitHub does
  function customChip (chip: CardChip): { key: string, field: ProjectField } | undefined {
    if (chip.kind !== 'custom') return undefined
    const field = $registry.byKey.get(chip.fieldKey)
    if (field === undefined || getFieldValue(issue.customFields, field) === null) return undefined
    return { key: chip.fieldKey, field }
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="tracker-card"
  data-id="board-card"
  on:click={() => {
    void openDoc(client.getHierarchy(), issue)
  }}
>
  <div class="card-header flex-between">
    <div class="flex-row-center text-sm">
      <div class="mr-1">
        <StatusEditor value={issue} kind="list" isEditable={false} />
      </div>
      <div class="flex-no-shrink">
        <IssuePresenter value={issue} />
      </div>
      <ParentNamesPresenter value={issue} />
    </div>
    <div class="flex-row-center gap-2 reverse flex-no-shrink">
      <Component is={notification.component.NotificationPresenter} props={{ value: issue }} />
      {#if plan.assignee}
        <AssigneeEditor object={issue} avatarSize={'card'} shouldShowName={false} />
      {/if}
    </div>
  </div>
  <div class="card-content text-md caption-color lines-limit-2">
    {issue.title}
  </div>
  <div class="card-labels">
    {#each plan.chips as chip (chip.kind === 'custom' ? `c:${chip.fieldKey}` : `b:${chip.id}`)}
      {#if chip.kind === 'custom'}
        {@const custom = customChip(chip)}
        {#if custom !== undefined}
          <span
            class="field-chip"
            data-id="board-card-field"
            use:tooltip={{ label: getEmbeddedLabel(custom.field.label) }}
          >
            <CustomFieldPresenter field={custom.field} customFields={issue.customFields} />
          </span>
        {/if}
      {:else if chip.id === 'subIssues'}
        {#if issue.subIssues > 0}
          <SubIssuesSelector value={issue} {currentProject} size={'small'} />
        {/if}
      {:else if chip.id === 'priority'}
        <PriorityEditor value={issue} isEditable={true} kind={'link-bordered'} size={'small'} justify={'center'} />
      {:else if chip.id === 'component'}
        <ComponentEditor
          value={issue}
          {space}
          isEditable={true}
          kind={'link-bordered'}
          size={'small'}
          justify={'center'}
        />
      {:else if chip.id === 'milestone'}
        <MilestoneEditor
          value={issue}
          {space}
          isEditable={true}
          kind={'link-bordered'}
          size={'small'}
          justify={'center'}
        />
      {:else if chip.id === 'dueDate'}
        <DueDatePresenter value={issue} size={'small'} kind={'link-bordered'} />
      {/if}
    {/each}
  </div>
  {#if plan.labels}
    <div class="card-labels labels">
      <Component
        is={tags.component.LabelsPresenter}
        props={{
          value: issue.labels,
          object: issue,
          ckeckFilled: labelsFull,
          kind: 'link',
          compression: true
        }}
        on:change={(res) => {
          if (res.detail.full) labelsFull = true
        }}
      />
    </div>
  {/if}
  {#if withFooter}
    <div class="card-footer flex-between">
      {#if plan.estimation}
        <EstimationEditor kind={'list'} size={'small'} value={issue} />
      {/if}
      <div class="flex-row-center gap-3 reverse">
        {#if plan.attachments && (issue.attachments ?? 0) > 0}
          <AttachmentsPresenter value={issue.attachments} object={issue} />
        {/if}
        {#if plan.comments}
          <ChatMessagesPresenter value={issue.comments} object={issue} />
          <ChatMessagesPresenter object={parent} value={issue.$lookup?.attachedTo?.comments} withInput={false} />
        {/if}
      </div>
    </div>
  {:else}
    <div class="min-h-4 max-h-4 h-4" />
  {/if}
</div>

<style lang="scss">
  .tracker-card {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 6.5rem;
    border-radius: 0.25rem;

    .card-header {
      padding: 0.75rem 1rem 0;
    }
    .card-content {
      margin: 0.5rem 1rem;
    }
    /* Global styles in components.scss */
    .card-labels {
      display: flex;
      flex-wrap: nowrap;
      margin: 0 0.75rem 0 1rem;
      min-width: 0;

      &.labels {
        overflow: hidden;
        flex-shrink: 1;
        margin: 0 1rem;
        width: calc(100% - 2rem);
        border-radius: 0 0.24rem 0.24rem 0;
      }
    }
    .field-chip {
      display: inline-flex;
      align-items: center;
      flex-shrink: 1;
      min-width: 0;
      max-width: 10rem;
      height: 1.5rem;
      margin-right: 0.25rem;
      padding: 0 0.5rem;
      font-size: 0.75rem;
      color: var(--theme-caption-color);
      border: 1px solid var(--theme-button-border);
      border-radius: 0.25rem;
      overflow: hidden;
    }
    .card-footer {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background-color: var(--theme-kanban-card-footer);
      border-radius: 0 0 0.25rem 0.25rem;
    }
  }
</style>
