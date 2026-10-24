<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let label: IntlString
  export let value: string
  // Allows clearing the color (transparent)
  export let optional: boolean = false

  const dispatch = createEventDispatcher<{ change: string }>()

  $: hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'

  function onText (e: Event): void {
    dispatch('change', (e.target as HTMLInputElement).value.trim())
  }
</script>

<div class="field">
  <span class="caption"><Label {label} /></span>
  <span class="input">
    <input
      class="swatch"
      class:none={value === ''}
      type="color"
      value={hex}
      on:input={(e) => dispatch('change', e.currentTarget.value)}
    />
    <input class="text" type="text" {value} placeholder="—" on:change={onText} />
    {#if optional && value !== ''}
      <button class="clear" type="button" on:click={() => dispatch('change', '')}>×</button>
    {/if}
  </span>
</div>

<style lang="scss">
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }
  .caption {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .input {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    padding: 0.125rem 0.375rem;
  }
  .swatch {
    width: 1.25rem;
    height: 1.25rem;
    padding: 0;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    background: none;
    cursor: pointer;

    &.none {
      opacity: 0.4;
    }
  }
  .text {
    flex-grow: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--theme-caption-color);
    font-size: 0.8125rem;
    font-family: monospace;
  }
  .clear {
    border: none;
    background: none;
    color: var(--theme-dark-color);
    cursor: pointer;
  }
</style>
