<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import core, { type DocumentQuery, type FindOptions, type Ref, SortingOrder } from '@hcengineering/core'
  import { ObjectPopup } from '@hcengineering/presentation'
  import type { Issue } from '@hcengineering/tracker'
  import tracker from '../../plugin'
  import IssueStatusIcon from './IssueStatusIcon.svelte'

  export let docQuery: DocumentQuery<Issue> = {}
  export let ignoreObjects: Ref<Issue>[] = []

  const options: FindOptions<Issue> = {
    lookup: {
      status: [tracker.class.IssueStatus, { category: core.class.StatusCategory }]
    },
    sort: { modifiedOn: SortingOrder.Descending }
  }
</script>

<ObjectPopup
  _class={tracker.class.Issue}
  {docQuery}
  {options}
  {ignoreObjects}
  placeholder={tracker.string.SelectIssue}
  category={tracker.completion.IssueCategory}
  searchMode="spotlight"
  multiSelect={false}
  allowDeselect={false}
  shadows={true}
  width="resizable"
  on:update
  on:close
>
  <svelte:fragment slot="item" let:item={target}>
    <div class="flex-center clear-mins w-full h-9">
      {#if target?.$lookup?.status}
        <div class="icon mr-4 h-8">
          <IssueStatusIcon value={target.$lookup.status} taskType={target.kind} space={target.space} size="small" />
        </div>
      {/if}
      <span class="overflow-label flex-no-shrink mr-3">{target.identifier}</span>
      <span class="overflow-label w-full content-color">{target.title}</span>
    </div>
  </svelte:fragment>
</ObjectPopup>
