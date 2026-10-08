<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { isIssueDraft, type Issue } from '@hcengineering/tracker'
  import { Button, IconClose, Label } from '@hcengineering/ui'
  import { showMenu } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import type { LoadMeasure } from '../../workload/config'
  import { formatLoadValue } from '../../workload/format'
  import DraftBadge from '../issues/DraftBadge.svelte'
  import type { PanelItem } from './types'

  // The items behind a cell: who and when (already translated), the items with their share of the load
  export let title: string
  export let items: PanelItem[]
  export let measure: LoadMeasure
  export let locale: string | undefined = undefined
  // Whether the viewer can reassign (not read only)
  export let editable: boolean
  export let colorOf: (issue: Issue) => string
  // The item that is dragged right now
  export let draggingId: string | undefined = undefined
  // Rows that are drawn; the rest is counted
  export let limit: number = 300

  const dispatch = createEventDispatcher<{
    press: { issue: Issue, event: PointerEvent }
    open: { issue: Issue }
    reassign: { issue: Issue, event: MouseEvent }
    close: undefined
  }>()

  $: shown = items.slice(0, limit)
  $: rest = items.length - shown.length
</script>

<aside class="panel" data-id="workload-panel">
  <div class="header">
    <span class="title" title={title} data-id="workload-panel-title">{title}</span>
    <span class="count">{items.length}</span>
    <Button
      kind={'ghost'}
      size={'small'}
      icon={IconClose}
      showTooltip={{ label: tracker.string.WorkloadPanelClose }}
      dataId={'workload-panel-close'}
      on:click={() => {
        dispatch('close')
      }}
    />
  </div>
  {#if editable}
    <div class="hint"><Label label={tracker.string.WorkloadPanelHint} /></div>
  {/if}
  <div class="list">
    {#each shown as item (item.issue._id)}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="row"
        class:dragging={draggingId === item.issue._id}
        class:draggable={editable}
        style:--item-color={colorOf(item.issue)}
        title={item.issue.title}
        role="button"
        tabindex="0"
        data-id="workload-panel-item"
        on:pointerdown={(ev) => {
          if (ev.button === 0) dispatch('press', { issue: item.issue, event: ev })
        }}
        on:keydown={(ev) => {
          if (ev.key === 'Enter') dispatch('open', { issue: item.issue })
        }}
        on:contextmenu={(ev) => {
          showMenu(ev, { object: item.issue })
        }}
      >
        {#if isIssueDraft(item.issue)}
          <DraftBadge />
        {:else}
          <span class="identifier">{item.issue.identifier}</span>
        {/if}
        <span class="name">{item.issue.title}</span>
        <span class="share" data-id="workload-panel-share">{formatLoadValue(item.share, measure, locale, 2)}</span>
        {#if editable}
          <button
            class="reassign"
            type="button"
            data-id="workload-reassign"
            on:pointerdown|stopPropagation
            on:click|stopPropagation={(ev) => {
              dispatch('reassign', { issue: item.issue, event: ev })
            }}
          >
            <Label label={tracker.string.WorkloadReassign} />
          </button>
        {/if}
      </div>
    {/each}
    {#if items.length === 0}
      <div class="rest" data-id="workload-panel-empty">
        <Label label={tracker.string.CalendarAgendaEmpty} />
      </div>
    {/if}
    {#if rest > 0}
      <div class="rest" data-id="workload-panel-more">
        <Label label={tracker.string.CalendarUnscheduledMore} params={{ count: rest }} />
      </div>
    {/if}
  </div>
</aside>

<style lang="scss">
  .panel {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 20rem;
    min-height: 0;
    border-left: 1px solid var(--theme-divider-color);
    background: var(--theme-bg-color);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.5rem 0.25rem 0.75rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .title {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .share {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    color: var(--theme-content-color);
  }
  .reassign {
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
