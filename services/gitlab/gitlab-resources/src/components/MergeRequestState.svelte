<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { getClient } from '@hcengineering/presentation'
  import { type Issue } from '@hcengineering/tracker'
  import { Icon, Label } from '@hcengineering/ui'
  import { asMergeRequest } from '../issue-header'
  import { mergeStatusLabel } from '../merge-status'
  import gitlab from '../plugin'

  export let value: Issue | undefined
  export let small = false

  $: mr = value !== undefined ? asMergeRequest(getClient().getHierarchy(), value) : undefined
  $: status = mr !== undefined ? mergeStatusLabel(mr.mergeStatus, mr.hasConflicts) : undefined
</script>

{#if mr !== undefined}
  {#if mr.state === 'merged' || mr.state === 'closed'}
    <div class="flex-row-center" class:ml-4={!small} class:flex-no-shrink={small}>
      <Icon
        icon={mr.state === 'merged' ? gitlab.icon.MergeRequestMerged : gitlab.icon.MergeRequestClosed}
        size={'small'}
      />
      {#if !small}
        <span class="ml-1">
          <Label label={mr.state === 'merged' ? gitlab.string.StateMerged : gitlab.string.StateClosed} />
        </span>
      {/if}
    </div>
  {:else}
    {#if mr.draft}
      <div class:ml-4={!small}><Label label={gitlab.string.Draft} /></div>
    {/if}
    <!-- In lists only a conflict is worth the space -->
    {#if status !== undefined && (!small || status === gitlab.string.Conflict)}
      <div class:ml-4={!small}><Label label={status} /></div>
    {/if}
  {/if}
{/if}
