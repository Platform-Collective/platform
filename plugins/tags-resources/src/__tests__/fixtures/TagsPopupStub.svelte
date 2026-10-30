<!-- SPDX-License-Identifier: EPL-2.0 -->
<!-- Synthetic handler harness: permanent controls do not implement TagsPopup selection toggling. -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let targetClass: string
  export let selected: string[] = []

  const dispatch = createEventDispatcher()
  const tag = { _id: 'tag', title: 'Bug', color: 1 }
</script>

<div data-target-class={targetClass} data-selected={selected.join(',')}>
  <button on:click={() => dispatch('update', { action: 'add', tag })}>Add</button>
  <button on:click={() => dispatch('update', { action: 'remove', tag })}>Remove</button>
  <button on:click={() => dispatch('update', { action: 'selected', selected })}>Selection</button>
</div>
