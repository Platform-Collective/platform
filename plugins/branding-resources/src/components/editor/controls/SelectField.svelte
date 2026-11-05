<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type IntlString, translate } from '@hcengineering/platform'
  import { Label, languageStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  interface Option {
    id: string
    label: IntlString | string
    intl?: boolean
  }

  export let label: IntlString | undefined = undefined
  export let value: string
  export let options: Option[]

  const dispatch = createEventDispatcher<{ change: string }>()

  let labels: Record<string, string> = {}
  $: void translateOptions(options, $languageStore)

  async function translateOptions (opts: Option[], lang: string): Promise<void> {
    const result: Record<string, string> = {}
    for (const o of opts) {
      result[o.id] = o.intl === true ? await translate(o.label as IntlString, {}, lang) : o.label
    }
    labels = result
  }
</script>

<label class="field">
  {#if label !== undefined}
    <span class="caption"><Label {label} /></span>
  {/if}
  <select {value} on:change={(e) => dispatch('change', e.currentTarget.value)}>
    {#if !options.some((o) => o.id === value)}
      <option value={value}>{value}</option>
    {/if}
    {#each options as option (option.id)}
      <option value={option.id}>{labels[option.id] ?? option.label}</option>
    {/each}
  </select>
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
  }
  select {
    width: 100%;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    color: var(--theme-caption-color);
    padding: 0.25rem 0.25rem;
    font-size: 0.8125rem;
    outline: none;

    &:focus {
      border-color: var(--primary-button-default);
    }
  }
</style>
