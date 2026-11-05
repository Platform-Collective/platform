<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let label: IntlString
  export let checked: boolean
  export let hint: IntlString | undefined = undefined
  export let labelParams: Record<string, any> | undefined = undefined

  const dispatch = createEventDispatcher<{ change: boolean }>()
</script>

<label class="check">
  <input type="checkbox" {checked} on:change={(e) => dispatch('change', e.currentTarget.checked)} />
  <span class="text">
    <Label {label} params={labelParams} />
    {#if hint !== undefined}
      <span class="hint"><Label label={hint} /></span>
    {/if}
  </span>
</label>

<style lang="scss">
  .check {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--theme-caption-color);
  }
  input {
    margin-top: 0.125rem;
    accent-color: var(--primary-button-default);
  }
  .text {
    display: flex;
    flex-direction: column;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
</style>
