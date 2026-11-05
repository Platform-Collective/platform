<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let label: IntlString | undefined = undefined
  export let short: string | undefined = undefined
  export let value: number
  export let step: number = 0.5
  export let min: number | undefined = undefined
  export let max: number | undefined = undefined
  export let unit: string = ''
  export let disabled: boolean = false

  const dispatch = createEventDispatcher<{ change: number }>()

  function onChange (e: Event): void {
    const raw = parseFloat((e.target as HTMLInputElement).value)
    if (Number.isNaN(raw)) return
    let next = raw
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    dispatch('change', next)
  }
</script>

<label class="field">
  {#if label !== undefined}
    <span class="caption"><Label {label} /></span>
  {:else if short !== undefined}
    <span class="caption short">{short}</span>
  {/if}
  <span class="input">
    <input type="number" {step} {min} {max} {disabled} value={Math.round(value * 100) / 100} on:change={onChange} />
    {#if unit !== ''}<span class="unit">{unit}</span>{/if}
  </span>
</label>

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

    &.short {
      text-transform: uppercase;
    }
  }
  .input {
    display: flex;
    align-items: center;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    padding: 0 0.375rem;

    &:focus-within {
      border-color: var(--primary-button-default);
    }
  }
  input {
    width: 100%;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--theme-caption-color);
    padding: 0.25rem 0;
    font-size: 0.8125rem;
  }
  .unit {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    margin-left: 0.25rem;
  }
</style>
