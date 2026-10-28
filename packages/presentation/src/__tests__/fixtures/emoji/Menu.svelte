<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let items: Array<{ id: string, label: string }> = []
  export let disabled: boolean = false

  const dispatch = createEventDispatcher()
</script>

{#each items as item}
  <button {disabled} data-menu-item={item.id} on:click={() => dispatch('selected', item.id)}>{item.label}</button>
{/each}
