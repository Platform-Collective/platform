<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Button, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'

  // Side area at the end of the board that lists the hidden columns, so that they can be shown again
  export let columns: Array<{ key: string, category: unknown, count: number }>

  const dispatch = createEventDispatcher<{ show: string }>()
</script>

{#if columns.length > 0}
  <div class="hidden-columns" data-id="board-hidden-columns">
    <div class="title">
      <Label label={tracker.string.BoardHiddenColumns} />
      <span class="count">{columns.length}</span>
    </div>
    {#each columns as column (column.key)}
      <div class="item" data-id="board-hidden-column">
        <span class="name overflow-label">
          <slot name="title" category={column.category} />
        </span>
        <span class="count">{column.count}</span>
        <Button
          size={'small'}
          kind={'ghost'}
          label={tracker.string.BoardShowColumn}
          dataId={'board-show-column'}
          on:click={() => {
            dispatch('show', column.key)
          }}
        />
      </div>
    {/each}
  </div>
{/if}

<style lang="scss">
  .hidden-columns {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    align-self: flex-start;
    gap: 0.25rem;
    width: 16rem;
    min-width: 16rem;
    padding: 0.5rem;
    margin-left: 0.5rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.25rem;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
    padding: 0 0.25rem 0 0.5rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;

    .name {
      flex-grow: 1;
      min-width: 0;
    }
  }
  .count {
    color: var(--theme-dark-color);
  }
</style>
