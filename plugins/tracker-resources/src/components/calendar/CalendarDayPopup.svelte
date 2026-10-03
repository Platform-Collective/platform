<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import type { Issue, Project } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import type { BuildModelKey } from '@hcengineering/view'
  import { showMenu } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import CardFieldRenderer from '../board/CardFieldRenderer.svelte'

  // The popup of "+N more": every item of a day as a card (the fields of the view)
  export let issues: Issue[]
  // Long date of the day, already formatted
  export let dateLabel: string
  export let config: Array<string | BuildModelKey>
  export let space: Ref<Project> | undefined = undefined

  const dispatch = createEventDispatcher()
</script>

<div class="antiPopup day-popup" data-id="calendar-day-popup">
  <div class="header">
    <Label label={tracker.string.CalendarDayItems} params={{ date: dateLabel }} />
  </div>
  <div class="ap-scroll">
    <div class="ap-box list">
      {#each issues as issue (issue._id)}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="entry"
          data-id="calendar-day-popup-item"
          on:contextmenu={(ev) => {
            showMenu(ev, { object: issue })
          }}
          on:click={() => {
            // The card opens the issue, the popup is not needed any more
            dispatch('close')
          }}
        >
          <CardFieldRenderer {issue} {config} {space} />
        </div>
      {/each}
    </div>
  </div>
</div>

<style lang="scss">
  .day-popup {
    width: 22rem;
    max-width: 90vw;
    max-height: 28rem;
  }
  .header {
    padding: 0.75rem 1rem 0.25rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem 0.75rem;
  }
  .entry {
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-bg-color);
    cursor: pointer;

    &:hover {
      background: var(--theme-table-row-hover, var(--theme-bg-accent-color));
    }
  }
</style>
