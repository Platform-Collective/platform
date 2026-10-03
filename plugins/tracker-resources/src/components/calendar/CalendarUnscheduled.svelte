<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { isIssueDraft, type Issue } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import { showMenu } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import DraftBadge from '../issues/DraftBadge.svelte'

  // The items that have no day in the date fields of the view. A row is dragged onto a day to schedule it.
  export let issues: Issue[]
  // Whether the viewer can schedule (not read only, and a date field that can be written)
  export let editable: boolean
  export let colorOf: (issue: Issue) => string
  // The item that is dragged right now
  export let draggingId: string | undefined = undefined
  // Rows that are drawn; the rest is counted
  export let limit: number = 300

  const dispatch = createEventDispatcher<{
    press: { issue: Issue, event: PointerEvent }
    open: { issue: Issue }
    dates: { issue: Issue, event: MouseEvent }
  }>()

  $: shown = issues.slice(0, limit)
  $: rest = issues.length - shown.length
</script>

<aside class="unscheduled" data-id="calendar-unscheduled-panel">
  <div class="header">
    <span class="title"><Label label={tracker.string.RoadmapUnscheduled} /></span>
    <span class="count">{issues.length}</span>
  </div>
  {#if editable}
    <div class="hint"><Label label={tracker.string.CalendarUnscheduledHint} /></div>
  {/if}
  <div class="list">
    {#each shown as issue (issue._id)}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="row"
        class:dragging={draggingId === issue._id}
        class:draggable={editable}
        style:--item-color={colorOf(issue)}
        title={issue.title}
        role="button"
        tabindex="0"
        data-id="calendar-unscheduled-item"
        on:pointerdown={(ev) => {
          if (ev.button === 0) dispatch('press', { issue, event: ev })
        }}
        on:keydown={(ev) => {
          if (ev.key === 'Enter') dispatch('open', { issue })
        }}
        on:contextmenu={(ev) => {
          showMenu(ev, { object: issue })
        }}
      >
        {#if isIssueDraft(issue)}
          <DraftBadge />
        {:else}
          <span class="identifier">{issue.identifier}</span>
        {/if}
        <span class="name">{issue.title}</span>
        {#if editable}
          <button
            class="set-dates"
            type="button"
            data-id="calendar-set-dates"
            on:pointerdown|stopPropagation
            on:click|stopPropagation={(ev) => {
              dispatch('dates', { issue, event: ev })
            }}
          >
            <Label label={tracker.string.RoadmapSetDates} />
          </button>
        {/if}
      </div>
    {/each}
    {#if rest > 0}
      <div class="rest" data-id="calendar-unscheduled-more">
        <Label label={tracker.string.CalendarUnscheduledMore} params={{ count: rest }} />
      </div>
    {/if}
  </div>
</aside>

<style lang="scss">
  .unscheduled {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 17rem;
    min-height: 0;
    border-left: 1px solid var(--theme-divider-color);
    background: var(--theme-bg-color);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem 0.25rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .count {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--theme-dark-color);
  }
  .hint {
    padding: 0 0.75rem 0.5rem;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .list {
    flex-grow: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0.5rem 0.75rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    height: 1.75rem;
    margin-bottom: 0.25rem;
    padding: 0 0.375rem;
    font-size: 0.75rem;
    color: var(--theme-caption-color);
    border-left: 3px solid var(--item-color);
    border-radius: 0.25rem;
    background: var(--theme-button-default, rgba(128, 128, 128, 0.15));
    cursor: pointer;
    user-select: none;
    touch-action: none;

    &.draggable {
      cursor: grab;
    }
    &.dragging {
      opacity: 0.5;
    }
    &:focus-visible {
      outline: 2px solid var(--primary-button-focused-border, var(--theme-caption-color));
    }
  }
  .identifier {
    flex-shrink: 0;
    color: var(--theme-dark-color);
  }
  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .set-dates {
    flex-shrink: 0;
    padding: 0 0.375rem;
    font-size: 0.6875rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    background: transparent;
    color: var(--theme-content-color);
    cursor: pointer;

    &:hover {
      color: var(--theme-caption-color);
      background: var(--theme-button-hovered);
    }
  }
  .rest {
    padding: 0.5rem 0.25rem;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
</style>
