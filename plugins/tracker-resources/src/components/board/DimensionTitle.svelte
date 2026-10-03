<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref, Space } from '@hcengineering/core'
  import { themeStore } from '@hcengineering/ui'

  import type { DimensionInfo } from './types'

  // Title of a column or of a swimlane: what the category stands for, shown by the presenter of its field
  export let info: DimensionInfo
  export let category: any
  export let space: Ref<Space> | undefined = undefined
  export let accent: boolean = true
</script>

{#if info.custom}
  {#if category === undefined}
    <span class="overflow-label pointer-events-none">{info.emptyLabel ?? ''}</span>
  {:else if info.customHeader !== undefined}
    <svelte:component this={info.customHeader} value={category} />
  {/if}
{:else if info.presenter !== undefined}
  <svelte:component
    this={info.presenter.presenter}
    value={category}
    {space}
    size={'small'}
    kind={'list-header'}
    display={'kanban'}
    colorInherit={!$themeStore.dark}
    {accent}
    on:accent-color
  />
{/if}
