<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { ButtonIcon, DropdownLabels, IconClose, Label, type DropdownTextItem } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { SLICE_NONE, type SliceConfig } from '../../slice/config'
  import { SLICE_ALL } from '../../slice/sums'
  import type { SliceValues } from '../../slice/values'
  import tracker from '../../plugin'

  // The slice-by panel (GitHub Projects): the values of one field with their counts. A click chooses the value,
  // Cmd/Ctrl-click adds it to the chosen ones, "All" clears the choice.
  // The fields that can be sliced by, with translated labels
  export let fields: DropdownTextItem[]
  export let config: SliceConfig
  // Translated label of the field being sliced, for "No <field>"
  export let fieldLabel: string
  // Undefined while the values are being loaded or cannot be counted (see `overLimit`)
  export let data: SliceValues | undefined = undefined
  // Sums of the chosen number fields by value id (see `collectSliceSums`); empty without chosen fields
  export let sums: ReadonlyMap<string, string> = new Map()
  // The view has more issues than the scan limit: the values cannot be counted, the slice is off
  export let overLimit: boolean = false
  export let scanLimit: number = 0

  const dispatch = createEventDispatcher<{
    field: string
    select: { id: string | undefined, multi: boolean }
    close: undefined
  }>()

  $: chosen = new Set(config.value)
  $: allSelected = config.value.length === 0

  function click (id: string | undefined, ev: MouseEvent): void {
    dispatch('select', { id, multi: ev.metaKey || ev.ctrlKey })
  }
</script>

<div class="slice-panel" data-id="slice-panel">
  <div class="header">
    <span class="title"><Label label={tracker.string.SliceBy} /></span>
    <ButtonIcon
      icon={IconClose}
      size={'small'}
      kind={'tertiary'}
      tooltip={{ label: tracker.string.SliceClose }}
      dataId={'slice-close'}
      on:click={() => {
        dispatch('close')
      }}
    />
  </div>
  <div class="field">
    <DropdownLabels
      kind={'regular'}
      size={'medium'}
      items={fields}
      selected={config.field}
      enableSearch={false}
      width="100%"
      justify="left"
      on:selected={(e) => {
        if (e.detail !== config.field) dispatch('field', e.detail)
      }}
    />
  </div>
  <div class="values" role="listbox" aria-multiselectable="true">
    {#if overLimit}
      <div class="message" role="alert">
        <Label label={tracker.string.SliceScanLimitExceeded} params={{ limit: scanLimit }} />
      </div>
    {:else if data === undefined}
      <div class="message">…</div>
    {:else}
      <button
        class="value"
        class:selected={allSelected}
        type="button"
        role="option"
        aria-selected={allSelected}
        data-id="slice-all"
        on:click={(ev) => {
          click(undefined, ev)
        }}
      >
        <span class="label"><Label label={tracker.string.SliceAll} /></span>
        <span class="count">{data.total}</span>
        {#if sums.has(SLICE_ALL)}
          <span class="sums" title={sums.get(SLICE_ALL)}>Σ {sums.get(SLICE_ALL)}</span>
        {/if}
      </button>
      {#each data.values as value (value.id)}
        <button
          class="value"
          class:selected={chosen.has(value.id)}
          class:empty={value.count === 0}
          type="button"
          role="option"
          aria-selected={chosen.has(value.id)}
          data-id="slice-value"
          on:click={(ev) => {
            click(value.id, ev)
          }}
        >
          <span class="label" title={value.label}>{value.label}</span>
          <span class="count">{value.count}</span>
          {#if sums.has(value.id)}
            <span class="sums" title={sums.get(value.id)}>Σ {sums.get(value.id)}</span>
          {/if}
        </button>
      {/each}
      {#if data.none > 0 || chosen.has(SLICE_NONE)}
        <button
          class="value"
          class:selected={chosen.has(SLICE_NONE)}
          class:empty={data.none === 0}
          type="button"
          role="option"
          aria-selected={chosen.has(SLICE_NONE)}
          data-id="slice-none"
          on:click={(ev) => {
            click(SLICE_NONE, ev)
          }}
        >
          <span class="label"><Label label={tracker.string.NoFieldValue} params={{ field: fieldLabel }} /></span>
          <span class="count">{data.none}</span>
          {#if sums.has(SLICE_NONE)}
            <span class="sums" title={sums.get(SLICE_NONE)}>Σ {sums.get(SLICE_NONE)}</span>
          {/if}
        </button>
      {/if}
    {/if}
  </div>
</div>

<style lang="scss">
  .slice-panel {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 15rem;
    min-height: 0;
    border-right: 1px solid var(--theme-divider-color);
    background: var(--theme-bg-color);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem 0.25rem 1rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .field {
    padding: 0.25rem 0.75rem 0.5rem 1rem;
  }
  .values {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0.5rem 0.75rem 0.5rem;
  }
  .value {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--theme-caption-color);
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--theme-popup-hover);
    }
    &.selected {
      background: var(--highlight-select, var(--theme-popup-hover));
      font-weight: 500;
    }
    &.empty:not(.selected) {
      color: var(--theme-dark-color);
    }
  }
  .label {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  /* The sums go on their own line under the label, so that a long label keeps its room */
  .sums {
    flex-basis: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .message {
    padding: 0.5rem;
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
  }
</style>
