<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  // The legend of a grouped chart: one swatch and label per series
  export let items: Array<{ label: string, color: string }> = []
</script>

{#if items.length > 0}
  <ul class="legend" data-id="insight-legend">
    {#each items as item}
      <li class="item" title={item.label}>
        <span class="swatch" style:background={item.color} />
        <span class="label">{item.label}</span>
      </li>
    {/each}
  </ul>
{/if}

<style lang="scss">
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0;
    padding: 0.5rem 1rem 0.75rem;
    list-style: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    max-width: 14rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);
  }
  .swatch {
    flex-shrink: 0;
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 0.125rem;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
