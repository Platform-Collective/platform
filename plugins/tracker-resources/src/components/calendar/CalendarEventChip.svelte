<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { isIssueDraft, type Issue } from '@hcengineering/tracker'
  import { createEventDispatcher } from 'svelte'

  import AssigneeEditor from '../issues/AssigneeEditor.svelte'
  import DraftBadge from '../issues/DraftBadge.svelte'
  import PriorityEditor from '../issues/PriorityEditor.svelte'
  import type { RescheduleMode } from '../../roadmap/reschedule'

  // An item in a day cell: a bar when it spans days, a chip for a single day. The fields follow the field list of the view:
  // the assignee avatar and the priority; the identifier and the title are always shown.
  export let issue: Issue
  export let color: string
  // Tooltip: the label of the item and its dates
  export let label: string = ''
  export let showAssignee: boolean = false
  export let showPriority: boolean = false
  export let multiDay: boolean = false
  export let continuesBefore: boolean = false
  export let continuesAfter: boolean = false
  export let inverted: boolean = false
  export let draggable: boolean = false
  export let resizeStart: boolean = false
  export let resizeEnd: boolean = false
  export let dragging: boolean = false

  const dispatch = createEventDispatcher<{
    press: { mode: RescheduleMode, event: PointerEvent }
    open: undefined
    menu: MouseEvent
  }>()
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="calendar-chip"
  class:bar={multiDay}
  class:chip={!multiDay}
  class:inverted
  class:draggable
  class:dragging
  class:continues-before={continuesBefore}
  class:continues-after={continuesAfter}
  style:--item-color={color}
  title={label}
  role="button"
  tabindex="0"
  data-id="calendar-item"
  on:pointerdown={(ev) => {
    dispatch('press', { mode: 'move', event: ev })
  }}
  on:keydown={(ev) => {
    if (ev.key === 'Enter') dispatch('open')
  }}
  on:contextmenu={(ev) => {
    dispatch('menu', ev)
  }}
>
  {#if resizeStart && !continuesBefore}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="handle start"
      data-id="calendar-resize-start"
      on:pointerdown={(ev) => {
        dispatch('press', { mode: 'resize-start', event: ev })
      }}
    />
  {/if}
  {#if continuesBefore}<span class="arrow">‹</span>{/if}
  {#if showAssignee && issue.assignee != null}
    <span class="assignee">
      <AssigneeEditor object={issue} readonly shouldShowName={false} avatarSize={'inline'} kind={'link'} size={'small'} />
    </span>
  {/if}
  {#if isIssueDraft(issue)}
    <DraftBadge />
  {:else}
    <span class="identifier">{issue.identifier}</span>
  {/if}
  <span class="title">{issue.title}</span>
  {#if showPriority && issue.priority !== 0}
    <span class="priority">
      <PriorityEditor value={issue} isEditable={false} kind={'link'} size={'small'} />
    </span>
  {/if}
  {#if continuesAfter}<span class="arrow">›</span>{/if}
  {#if resizeEnd && !continuesAfter}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="handle end"
      data-id="calendar-resize-end"
      on:pointerdown={(ev) => {
        dispatch('press', { mode: 'resize-end', event: ev })
      }}
    />
  {/if}
</div>

<style lang="scss">
  .calendar-chip {
    position: relative;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    height: 100%;
    min-width: 0;
    padding: 0 0.375rem;
    overflow: hidden;
    font-size: 0.75rem;
    line-height: 1;
    white-space: nowrap;
    border-radius: 0.25rem;
    cursor: pointer;
    user-select: none;
    touch-action: none;

    &.bar {
      color: #fff;
      background: var(--item-color);
    }
    &.chip {
      color: var(--theme-caption-color);
      background: var(--theme-button-default, rgba(128, 128, 128, 0.15));
      border-left: 3px solid var(--item-color);
      border-radius: 0.1875rem 0.25rem 0.25rem 0.1875rem;
    }
    &.continues-before {
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
    }
    &.continues-after {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    &.draggable {
      cursor: grab;
    }
    &.dragging {
      opacity: 0.85;
      cursor: grabbing;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
    &.inverted.bar {
      background-image: repeating-linear-gradient(
        135deg,
        transparent 0,
        transparent 4px,
        rgba(255, 255, 255, 0.25) 4px,
        rgba(255, 255, 255, 0.25) 8px
      );
    }
    &:hover:not(.dragging) {
      filter: brightness(1.08);
    }
    &:focus-visible {
      outline: 2px solid var(--primary-button-focused-border, var(--theme-caption-color));
      outline-offset: 1px;
    }
  }
  .identifier {
    flex-shrink: 0;
    opacity: 0.75;
  }
  .title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .assignee,
  .priority {
    display: flex;
    flex-shrink: 0;
    pointer-events: none;
  }
  .arrow {
    flex-shrink: 0;
    opacity: 0.8;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0.375rem;
    cursor: ew-resize;

    &:hover {
      background: rgba(255, 255, 255, 0.35);
    }
    &.start {
      left: 0;
    }
    &.end {
      right: 0;
    }
  }
</style>
