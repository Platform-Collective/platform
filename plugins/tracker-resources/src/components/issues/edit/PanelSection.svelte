<!--
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { IconChevronDown, IconChevronRight, Label } from '@hcengineering/ui'
  import { isPanelSectionCollapsed, setPanelSectionCollapsed } from './control-panel-sections'

  /** Stable id; the collapse state is remembered per browser under this id. */
  export let id: string
  export let label: IntlString
  export let divider: boolean = true

  let collapsed = isPanelSectionCollapsed(id)

  function toggle(): void {
    collapsed = !collapsed
    setPanelSectionCollapsed(id, collapsed)
  }
</script>

{#if divider}
  <div class="divider" />
{/if}
<div class="panel-section-header-container">
  <button
    type="button"
    class="panel-section-header"
    class:collapsed
    aria-expanded={!collapsed}
    data-panel-section={id}
    on:click={toggle}
  >
    <span class="panel-section-chevron">
      {#if collapsed}
        <IconChevronRight size="small" />
      {:else}
        <IconChevronDown size="small" />
      {/if}
    </span>
    <span class="panel-section-label"><Label {label} /></span>
  </button>
</div>
{#if !collapsed}
  <slot />
{/if}

<style lang="scss">
  .panel-section-header-container {
    display: contents;
  }
  .panel-section-header {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    margin: 0;
    padding: 0.25rem 0;
    border: none;
    background: none;
    color: var(--theme-caption-color);
    font-weight: 500;
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;

    &:hover .panel-section-label {
      color: var(--theme-content-color);
    }
    &:focus-visible {
      outline: 1px solid var(--global-focus-BorderColor, var(--primary-button-outline));
      outline-offset: 2px;
    }
  }
  .panel-section-chevron {
    display: flex;
    flex-shrink: 0;
    color: var(--theme-dark-color);
  }
  .panel-section-label {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
