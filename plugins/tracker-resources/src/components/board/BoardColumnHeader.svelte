<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { getEmbeddedLabel, translate } from '@hcengineering/platform'
  import {
    Button,
    IconAdd,
    IconMoreH,
    Menu,
    eventToHTMLElement,
    showPopup,
    themeStore,
    tooltip,
    type Action
  } from '@hcengineering/ui'
  import { EditBoxPopup } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import { formatColumnCount, limitState, parseLimitInput } from '../../board/limits'
  import tracker from '../../plugin'

  // Header of a column of the board: the title (the default slot), the number of items against the limit of the
  // column, and the menu of the column.
  export let background: string | undefined = undefined
  // Color of the title
  export let titleColor: string | undefined = undefined
  // Items of the column, all swimlanes together
  export let count: number
  // Advisory limit of the column, if it has one
  export let limit: number | undefined = undefined
  export let canAdd: boolean = true
  // Text that goes after the count, e.g. the sums of the number fields of the items of the column
  export let total: string | undefined = undefined
  // Whether the board is read only for the user: the menu is then not offered
  export let readonly: boolean = false

  const dispatch = createEventDispatcher<{ add: undefined, hide: undefined, limit: number | undefined }>()

  $: state = limitState(count, limit)

  let exceededText = ''
  $: if (state === 'exceeded') {
    void translate(tracker.string.BoardColumnLimitExceeded, { count, limit }, $themeStore.language).then((res) => {
      exceededText = res
    })
  }

  function editLimit (el: HTMLElement): void {
    showPopup(
      EditBoxPopup,
      {
        value: limit,
        format: 'number',
        placeholder: tracker.string.BoardColumnLimitPlaceholder,
        minValue: 1,
        maxDigitsAfterPoint: 0
      },
      el,
      (res: unknown) => {
        // Closing the popup without a number (Esc, a click outside, an emptied input) leaves the limit alone;
        // the limit is removed by the menu item or by typing 0
        if (res === undefined || res === null) return
        const parsed = parseLimitInput(res)
        if (parsed.ok === true) dispatch('limit', parsed.limit)
      }
    )
  }

  function showMenu (ev: MouseEvent): void {
    const el = eventToHTMLElement(ev)
    const actions: Action[] = [
      {
        label: tracker.string.BoardHideColumn,
        action: async () => {
          dispatch('hide')
        }
      },
      {
        label: limit === undefined ? tracker.string.BoardSetColumnLimit : tracker.string.BoardEditColumnLimit,
        action: async () => {
          editLimit(el)
        }
      }
    ]
    if (limit !== undefined) {
      actions.push({
        label: tracker.string.BoardRemoveColumnLimit,
        action: async () => {
          dispatch('limit', undefined)
        }
      })
    }
    showPopup(Menu, { actions }, el)
  }
</script>

<div
  style:background
  class="header flex-between"
  class:exceeded={state === 'exceeded'}
  data-id="board-column-header"
  data-limit-state={state}
>
  <div class="flex-row-center gap-1">
    <span class="clear-mins fs-bold overflow-label pointer-events-none" style:color={titleColor}>
      <slot />
    </span>
    <span
      class="counter ml-1"
      class:over={state === 'exceeded'}
      data-id="board-column-count"
      use:tooltip={state === 'exceeded' && exceededText !== '' ? { label: getEmbeddedLabel(exceededText) } : undefined}
    >
      {formatColumnCount(count, limit)}
    </span>
    {#if total !== undefined}
      <span class="counter overflow-label" data-id="board-column-total" title={total}>{total}</span>
    {/if}
  </div>
  <div class="tools gap-1">
    {#if canAdd}
      <Button
        icon={IconAdd}
        kind={'ghost'}
        showTooltip={{ label: tracker.string.AddIssueTooltip, direction: 'left' }}
        on:click={() => {
          dispatch('add')
        }}
      />
    {/if}
    {#if !readonly}
      <Button icon={IconMoreH} kind={'ghost'} dataId={'board-column-menu'} on:click={showMenu} />
    {/if}
  </div>
</div>

<style lang="scss">
  .header {
    margin: 0 0.75rem 0.5rem;
    padding: 0 0.5rem 0 1.25rem;
    height: 2.5rem;
    min-height: 2.5rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;

    .counter {
      color: var(--theme-dark-color);

      &.over {
        padding: 0 0.375rem;
        font-weight: 500;
        color: var(--theme-error-color, #d73a49);
        background-color: color-mix(in srgb, var(--theme-error-color, #d73a49) 16%, transparent);
        border-radius: 0.75rem;
      }
    }
    // A column over its limit is tinted so that it is noticed while scrolling the board
    &.exceeded {
      border-color: var(--theme-error-color, #d73a49);
      box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--theme-error-color, #d73a49) 8%, transparent);
    }
    .tools {
      display: flex;
      opacity: 0;
    }
    &:hover .tools,
    &:focus-within .tools {
      opacity: 1;
    }
  }
</style>
